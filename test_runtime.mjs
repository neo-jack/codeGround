import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileTree, normalizePath, resolveAlias, viteConfig } from './src/project-runtime.js';

const registry = JSON.parse(await readFile(new URL('./projects.json', import.meta.url)));
test('handwritten React adapters remain configured outside the editor', () => {
  const project = registry.projects.react;
  assert.equal(resolveAlias('react-dom/client', project.runtime.aliases), 'packages/react-dom/index.ts');
  assert.equal(resolveAlias('react/src/jsx', project.runtime.aliases), 'packages/react/src/jsx');
  assert.equal(resolveAlias('react-other', project.runtime.aliases), null);
  const tree = fileTree({'demos/main.tsx':'initial'}, project);
  assert.match(tree['.codeground'].directory['jsx-runtime.ts'].file.contents, /jsxDEV/);
});

test('a plain TypeScript project uses its own root and leaves no React-specific adapter', () => {
  const project = {entryHtml:'index.html', defaultFile:'src/main.ts', runtime:{root:'.'}};
  const tree = fileTree({'src/main.ts':'document.body.textContent="Hello"'}, project);
  assert.equal(tree.src.directory['main.ts'].file.contents, 'document.body.textContent="Hello"');
  assert.equal(tree['.codeground'].directory['jsx-runtime.ts'], undefined);
  const config = viteConfig(project);
  assert.doesNotMatch(config, /packages\/react|demos|neo-jack/);
  assert.match(config, /"root":"\."/);
});

test('source virtual files reject prototype mutation and traversal', () => {
  for (const path of ['../outside.js','__proto__/polluted','a/constructor/x']) {
    assert.throws(() => fileTree({[path]:'bad'}, {}));
  }
  assert.throws(() => normalizePath('../../private'));
  assert.equal(normalizePath('src/components/../main.ts'), 'src/main.ts');
  assert.equal({}.polluted, undefined);
});

test('visitor trees are independent copies and do not mutate the source snapshot', () => {
  const files = {'index.html':'initial'};
  const a = fileTree(files, {}), b = fileTree(files, {});
  a['index.html'].file.contents = 'changed';
  assert.equal(b['index.html'].file.contents, 'initial');
  assert.equal(files['index.html'], 'initial');
});
