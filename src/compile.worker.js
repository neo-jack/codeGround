import { normalizePath as normalize, resolveAlias, runtimeConfig } from './project-runtime';
import * as esbuild from 'esbuild-wasm';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import schedulerIndex from 'scheduler/index.js?raw';
import schedulerDev from 'scheduler/cjs/scheduler.development.js?raw';
import schedulerProd from 'scheduler/cjs/scheduler.production.min.js?raw';

const ready = esbuild.initialize({ wasmURL, worker: false });
self.onmessage = async ({ data: { files, entry, id, project } }) => {
  try {
    await ready;
    const options = runtimeConfig(project);
    const virtual = { ...files, ...options.virtualFiles,
      '.runtime/scheduler/index.js': schedulerIndex,
      '.runtime/scheduler/cjs/scheduler.development.js': schedulerDev,
      '.runtime/scheduler/cjs/scheduler.production.min.js': schedulerProd,
    };
    const resolve = path => {
      for (const candidate of [path, ...['.ts','.tsx','.js','.jsx','.json','/index.ts','/index.tsx','/index.js'].map(x=>path+x)]) {
        if (Object.hasOwn(virtual, candidate)) return candidate;
      }
      throw new Error('找不到模块：' + path);
    };
    const result = await esbuild.build({
      entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
      jsx: 'automatic', jsxDev: true, ...(options.jsxImportSource ? { jsxImportSource: options.jsxImportSource } : {}), outfile: 'out.js',
      define: { ...options.define, 'process.env.NODE_ENV': '"development"' },
      plugins: [{ name: 'isolated-memory-files', setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          let path = args.path;
          if (args.kind === 'entry-point') path = normalize(path);
          else if (path.startsWith('.')) path = normalize(args.importer.split('/').slice(0,-1).join('/') + '/' + path);
          else if (path.startsWith('/')) path = normalize(path);
          else if (resolveAlias(path, options.aliases)) path = resolveAlias(path, options.aliases);
          else if (path === 'scheduler') path = '.runtime/scheduler/index.js';
          else throw new Error('轻量预览暂不支持这个外部依赖：' + path);
          return { path: resolve(path), namespace: 'project' };
        });
        build.onLoad({ filter: /.*/, namespace: 'project' }, args => {
          const ext = args.path.split('.').at(-1);
          return { contents: virtual[args.path], loader: ['ts','tsx','jsx','json','css'].includes(ext) ? ext : 'js' };
        });
      } }],
    });
    self.postMessage({ id, js: result.outputFiles.find(f=>f.path.endsWith('.js'))?.text || '', css: result.outputFiles.find(f=>f.path.endsWith('.css'))?.text || '' });
  } catch (error) {
    self.postMessage({ id, error: error.message, diagnostics: (error.errors || []).map(item => ({
      text: item.text, file: item.location?.file, line: item.location?.line,
      column: item.location?.column, length: item.location?.length,
    })) });
  }
};
