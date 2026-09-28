import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const shell = process.env.DEPLOY_TEST_SHELL || 'sh';
function shellPath(value) {
  if (process.platform !== 'win32') return value;
  const r = spawnSync(shell, ['-c','cygpath -u "$1"','probe',value], {encoding:'utf8'});
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
async function scenario(t, failure = '', backup = false) {
  const root = await mkdtemp(path.join(os.tmpdir(),'codeground-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^codeground-test-/);await rm(root,{recursive:true,force:true});});
  await mkdir(path.join(root,'state'));
  await mkdir(path.join(root,'deploy'));
  await writeFile(path.join(root,'state','102my-react-playground'),'old');
  if (backup) await writeFile(path.join(root,'state','102my-react-playground-previous'),'backup');
  await writeFile(path.join(root,'deploy','Caddyfile'),'old-gateway');
  await writeFile(path.join(root,'deploy','.env'),'PLAYGROUND_HOSTS=example.test\n');
  await writeFile(path.join(root,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  await writeFile(path.join(root,'docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_ROOT/commands"
if [ "$1" = --config ]; then shift 2; fi
state="$MOCK_ROOT/state"
case "$1" in
 container) if [ "$3" = react-playground-https ]; then exit 0; fi; test -f "$state/$3" ;;
 network) exit 0 ;;
 login) cat >/dev/null ;;
 pull) [ "$FAILURE" != pull ] ;;
 run) [ "$FAILURE" != validate ] ;;
 create) shift; while [ "$1" != --name ]; do shift; done; printf new > "$state/$2" ;;
 cp) case "$2" in *:/app/deploy/Caddyfile) printf new-gateway > "$3" ;; esac ;;
 exec) case "$*" in
   *caddy\\ validate*) [ "$FAILURE" != gateway-config ] ;;
   *wget*) [ "$FAILURE" != gateway-health ] ;;
   *) [ "$FAILURE" != route-check ] ;;
 esac ;;
 inspect) if [ "$FAILURE" = health ]; then printf unhealthy; else printf healthy; fi ;;
 rename) mv "$state/$2" "$state/$3" ;;
 stop) exit 0 ;;
 start) [ "$FAILURE" != start ] || [ "$(cat "$state/$2")" = old ] ;;
 restart) if [ "$FAILURE" = gateway-start ] && [ "$(cat "$MOCK_ROOT/deploy/Caddyfile")" = new-gateway ]; then exit 1; fi ;;
 rm) shift; [ "$1" != -f ] || shift; rm -f "$state/$1" ;;
 *) exit 98 ;;
esac
`,{mode:0o755});
  const script=fileURLToPath(new URL('codeground.sh',import.meta.url));
  const r=spawnSync(shell,['-c','PATH="$1:$PATH"; export PATH; [ "$(command -v docker)" = "$1/docker" ] || exit 99; exec sh "$2"','probe',shellPath(root),shellPath(script)],{
    encoding:'utf8',timeout:15000,env:{...process.env,MOCK_ROOT:shellPath(root),CODEGROUND_ROOT:shellPath(root),FAILURE:failure,GHCR_USER:'test',GHCR_TOKEN:'test',CODEGROUND_IMAGE:'example.test/codeground:sha'},
  });
  assert.equal(r.error,undefined,String(r.error));assert.notEqual(r.status,99);
  const state=Object.fromEntries(await Promise.all((await readdir(path.join(root,'state'))).map(async name=>[name,await readFile(path.join(root,'state',name),'utf8')])));
  return {...r,state,gateway:await readFile(path.join(root,'deploy','Caddyfile'),'utf8'),env:await readFile(path.join(root,'deploy','.env'),'utf8'),commands:await readFile(path.join(root,'commands'),'utf8')};
}
test('publishes only Codeground and keeps TLS host settings',async t=>{
  const r=await scenario(t);assert.equal(r.status,0,r.stderr);assert.deepEqual(r.state,{'102my-react-playground':'new'});assert.equal(r.gateway,'new-gateway');
  assert.match(r.env,/PLAYGROUND_HOSTS=example.test/);assert.match(r.env,/CODEGROUND_IMAGE=example.test\/codeground:sha/);
  assert.match(r.commands,/--read-only --cap-drop ALL/);assert.doesNotMatch(r.commands,/stop 100my-page|rm .*tls/);
});
for(const failure of ['pull','validate','gateway-config','start','health','route-check','gateway-start','gateway-health']) {
  test('restores application and gateway after '+failure,async t=>{
    const r=await scenario(t,failure);assert.notEqual(r.status,0);assert.deepEqual(r.state,{'102my-react-playground':'old'});assert.equal(r.gateway,'old-gateway');
  });
}
test('does not overwrite an unresolved rollback',async t=>{
  const r=await scenario(t,'',true);assert.notEqual(r.status,0);assert.equal(r.state['102my-react-playground-previous'],'backup');assert.doesNotMatch(r.commands,/rename|stop/);
});
