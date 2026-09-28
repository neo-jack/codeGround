// Server-maintained configuration only. Never import a repository's install scripts.
export function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('导入路径超出项目');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

export function resolveAlias(path, aliases = []) {
  for (const { find, replacement } of aliases) {
    if (path === find || path.startsWith(find + '/')) return replacement + path.slice(find.length);
  }
  return null;
}

export function runtimeConfig(project) {
  return { root: '.', dependencies: { vite: '5.4.21' }, aliases: [], virtualFiles: {}, define: {}, ...project.runtime };
}

export function viteConfig(project) {
  const options = runtimeConfig(project);
  return `import { defineConfig } from 'vite';
import path from 'node:path';
const workspace = process.cwd();
const options = ${JSON.stringify(options)};
const aliases = options.aliases.map(item => ({find:item.find,replacement:path.resolve(workspace,item.replacement)}));
for (const name of Object.keys(options.dependencies)) {
  if (name !== 'vite') aliases.push({find:name,replacement:path.resolve(workspace,'.codeground/node_modules',name)});
}
export default defineConfig({
  root:path.resolve(workspace,options.root),
  define:options.define,
  esbuild:options.jsxImportSource ? {jsx:'automatic',jsxDev:true,jsxImportSource:options.jsxImportSource} : {},
  server:{host:'0.0.0.0',port:5173,strictPort:true,fs:{allow:[workspace]}},
  resolve:{alias:aliases}
});`;
}

export function fileTree(files, project) {
  const options = runtimeConfig(project);
  const all = { ...files, ...options.virtualFiles,
    '.codeground/package.json': JSON.stringify({name:'codeground-runtime',private:true,type:'module',dependencies:options.dependencies}),
    '.codeground/vite.config.mjs': viteConfig(project),
  };
  const root = Object.create(null);
  for (const [path, contents] of Object.entries(all)) {
    const parts = path.split('/');
    if (parts.some(p => !p || ['..','.','__proto__','constructor','prototype'].includes(p))) throw new Error('源码路径不合法');
    let parent = root;
    for (const part of parts.slice(0,-1)) {
      parent[part] ??= {directory:Object.create(null)};
      parent = parent[part].directory;
    }
    parent[parts.at(-1)] = {file:{contents}};
  }
  return root;
}
