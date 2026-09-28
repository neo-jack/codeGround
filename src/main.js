import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// Language services do not register the Monarch syntax tokenizers.
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import { SessionRuntime } from './session-runtime';
import './style.css';

self.MonacoEnvironment = { getWorker(_, label) {
  if (['javascript', 'typescript'].includes(label)) return new TsWorker();
  if (label === 'json') return new JsonWorker();
  if (label === 'html') return new HtmlWorker();
  if (label === 'css') return new CssWorker();
  return new EditorWorker();
} };

document.querySelector('#app').innerHTML = `
  <main class="workspace">
    <aside class="explorer" aria-label="资源管理器">
      <button id="project-toggle" class="project-label" aria-expanded="true" aria-controls="files"><span class="chevron" aria-hidden="true"></span><span id="project-name"></span></button>
      <ul id="files" role="tree" aria-label="项目文件"></ul>
    </aside>
    <section class="code-panel" aria-label="源码编辑器">
      <div class="code-tabs"><span id="tab-icon" class="file-icon" aria-hidden="true"></span><span id="file-tab"></span><span id="change-dot" hidden aria-label="本次会话已修改"></span></div>
      <div id="editor"></div>
    </section>
    <div class="resize-handle" role="separator" aria-label="调整代码与预览宽度" aria-orientation="vertical" tabindex="0"></div>
    <section class="preview-panel" aria-label="实时预览">
      <div class="preview-toolbar"><span>预览</span><span class="preview-file" id="preview-file"></span><span id="preview-error" hidden role="status" aria-label="代码存在错误">!</span><button id="refresh" disabled aria-label="刷新预览" title="刷新预览">↻</button></div>
      <div class="preview-body">
        <iframe id="preview" title="代码实时预览" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" allow="cross-origin-isolated"></iframe>
        <div id="preview-overlay" class="preview-overlay"><div id="loader" class="loader" role="status" aria-label="正在加载预览"></div><p id="load-error" hidden>加载失败</p><button id="retry" hidden title="重新加载" aria-label="重新加载">↻</button></div>
      </div>
    </section>
  </main>
`;

const $ = id => document.getElementById(id);
const models = new Map();
const treeItems = new Map();
let project, files = {}, original = {}, activePath = '', runtime, previewURL = '', generation = 0, booting = false;
let loadController, watchdog, writeChain = Promise.resolve();
const pendingWrites = new Map();
const markerOwner = 'preview-compiler';

monaco.editor.defineTheme('react-lab', { base: 'vs-dark', inherit: true, rules: [
  { token: 'keyword', foreground: 'C586C0' },
  { token: 'keyword.flow', foreground: 'C586C0' },
  { token: 'type', foreground: '4EC9B0' },
  { token: 'type.identifier', foreground: '4EC9B0' },
  { token: 'identifier', foreground: '9CDCFE' },
  { token: 'string', foreground: 'CE9178' },
  { token: 'number', foreground: 'B5CEA8' },
  { token: 'comment', foreground: '6A9955' },
  { token: 'delimiter', foreground: 'D4D4D4' },
  { token: 'tag', foreground: '569CD6' },
  { token: 'attribute.name', foreground: '9CDCFE' },
  { token: 'attribute.value', foreground: 'CE9178' },
], colors: {
  'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4', 'editorLineNumber.foreground': '#858585',
  'editorLineNumber.activeForeground': '#c6c6c6', 'editor.lineHighlightBackground': '#242424',
  'editorCursor.foreground': '#aeafad', 'editor.selectionBackground': '#264f78', 'editorWidget.background': '#252526',
  'editorBracketHighlight.foreground1': '#FFD700',
  'editorBracketHighlight.foreground2': '#DA70D6',
  'editorBracketHighlight.foreground3': '#179FFF',
} });
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.languages.typescript.ScriptTarget.ESNext,
  module: monaco.languages.typescript.ModuleKind.ESNext,
  jsx: monaco.languages.typescript.JsxEmit.ReactJSXDev,
  allowNonTsExtensions: true,
});
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
const editor = monaco.editor.create($('editor'), {
  theme: 'react-lab', automaticLayout: true, fontSize: 14, lineHeight: 23,
  fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
  minimap: { enabled: false }, padding: { top: 12 }, scrollBeyondLastLine: false,
  tabSize: 2, wordWrap: 'off', renderLineHighlight: 'line', smoothScrolling: true,
  bracketPairColorization: { enabled: true }, fixedOverflowWidgets: true,
});
// Browser edits are already saved to the visitor's in-memory model.
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});

const fileTypes = {
  js: ['JS', 'javascript', 'JavaScript 文件'], jsx: ['JSX', 'jsx', 'JavaScript JSX 文件'],
  ts: ['TS', 'typescript', 'TypeScript 文件'], tsx: ['TSX', 'tsx', 'TypeScript JSX 文件'],
  mjs: ['JS', 'javascript', 'JavaScript 模块'], cjs: ['JS', 'javascript', 'CommonJS 模块'],
  json: ['{}', 'json', 'JSON 配置'], html: ['<>', 'html', 'HTML 页面'],
  css: ['#', 'css', 'CSS 样式'], md: ['M↓', 'markdown', 'Markdown 文档'],
  yaml: ['Y', 'yaml', 'YAML 配置'], yml: ['Y', 'yaml', 'YAML 配置'],
};
function fileType(path) { return fileTypes[path.split('.').at(-1)] || ['◇', 'file', '文件']; }
function language(path) {
  const type = fileType(path)[1];
  return ({ jsx: 'javascript', tsx: 'typescript', file: 'plaintext' })[type] || type;
}
function setIcon(element, path) {
  const [label, type, description] = fileType(path);
  element.className = 'file-icon type-' + type;
  element.textContent = label;
  element.title = description;
}
function clearErrors() {
  models.forEach(model => monaco.editor.setModelMarkers(model, markerOwner, []));
  $('preview-error').hidden = true;
  $('preview-error').removeAttribute('title');
}
function fail(error) {
  clearTimeout(watchdog); booting = false;
  const message = error instanceof Error ? error.message : String(error);
  clearErrors();
  const byFile = new Map();
  for (const diagnostic of error.diagnostics || []) {
    const path = diagnostic.file?.replace(/^project:/, '');
    const model = models.get(path);
    if (!model) continue;
    const line = Math.max(1, Math.min(model.getLineCount(), diagnostic.line || 1));
    const column = Math.max(1, Math.min(model.getLineMaxColumn(line), (diagnostic.column || 0) + 1));
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path).push({
      severity: monaco.MarkerSeverity.Error, message: diagnostic.text,
      startLineNumber: line, endLineNumber: line,
      startColumn: column, endColumn: Math.min(model.getLineMaxColumn(line), column + Math.max(1, diagnostic.length || 1)),
    });
  }
  byFile.forEach((markers, path) => monaco.editor.setModelMarkers(models.get(path), markerOwner, markers));
  $('preview-error').hidden = false;
  $('preview-error').title = byFile.size ? '代码存在错误，请查看编辑器中的红色标记。' : message;
  // Keep the last valid preview visible while the visitor fixes a syntax error.
  $('preview-overlay').hidden = !!previewURL;
  $('loader').hidden = true;
  $('load-error').hidden = !!previewURL;
  $('load-error').title = message;
  $('retry').hidden = !!previewURL;
}

function focusItem(item) {
  $('files').querySelectorAll('[role="treeitem"]').forEach(node => { node.tabIndex = node === item ? 0 : -1; });
  item.focus({ preventScroll: true });
}
function toggleFolder(item, expanded = item.getAttribute('aria-expanded') !== 'true') {
  item.setAttribute('aria-expanded', String(expanded));
  item.querySelector(':scope > [role="group"]').hidden = !expanded;
}
function openFile(path, focusTree = false) {
  activePath = path;
  editor.setModel(models.get(path));
  setIcon($('tab-icon'), path);
  $('file-tab').textContent = path.split('/').at(-1);
  $('file-tab').title = path;
  $('change-dot').hidden = files[path] === original[path];
  treeItems.forEach((item, filePath) => {
    if (item.dataset.kind === 'file') item.setAttribute('aria-selected', String(filePath === path));
  });
  const item = treeItems.get(path);
  if (item) {
    let parent = item.parentElement.closest('[role="treeitem"]');
    while (parent) { toggleFolder(parent, true); parent = parent.parentElement.closest('[role="treeitem"]'); }
    $('files').querySelectorAll('[role="treeitem"]').forEach(node => { node.tabIndex = node === item ? 0 : -1; });
    if (focusTree) focusItem(item);
  }
}
function renderTree() {
  const tree = Object.create(null);
  for (const path of Object.keys(files).sort()) {
    let branch = tree;
    path.split('/').forEach((part, i, parts) => {
      if (i === parts.length - 1) branch[part] = path;
      else branch = branch[part] ??= Object.create(null);
    });
  }
  treeItems.clear();
  const append = (branch, target, depth, prefix = '') => {
    const entries = Object.entries(branch).sort((a,b) => (typeof a[1] === 'string') - (typeof b[1] === 'string') || a[0].localeCompare(b[0]));
    for (const [name, value] of entries) {
      const isFile = typeof value === 'string';
      const path = prefix + name;
      const item = document.createElement('li');
      item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', String(depth + 1));
      item.setAttribute('aria-label', isFile ? `${name}，${fileType(path)[2]}` : name);
      item.dataset.kind = isFile ? 'file' : 'folder'; item.dataset.path = path; item.tabIndex = -1;
      const row = document.createElement('div'); row.className = 'tree-row'; row.style.setProperty('--depth', depth);
      const arrow = document.createElement('span'); arrow.className = 'chevron'; arrow.setAttribute('aria-hidden', 'true');
      if (isFile) arrow.classList.add('empty');
      const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true');
      if (isFile) { setIcon(icon, path); item.setAttribute('aria-selected', 'false'); }
      else { icon.className = 'folder-icon'; icon.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M1.5 4V2.5h4l1.5 1.5h7.5v9.5h-13z" stroke="currentColor" stroke-linejoin="round"/><path d="M1.5 5.5h13" stroke="currentColor"/></svg>'; }
      const label = document.createElement('span'); label.className = 'file-name'; label.textContent = name;
      row.append(arrow, icon, label); row.title = isFile ? `${path} · ${fileType(path)[2]}` : path;
      item.append(row); treeItems.set(path, item);
      if (!isFile) {
        const group = document.createElement('ul'); group.setAttribute('role', 'group');
        item.append(group); append(value, group, depth + 1, path + '/');
        toggleFolder(item, path === project.defaultFile.split('/')[0]);
      }
      row.onclick = () => { focusItem(item); if (isFile) openFile(path); else toggleFolder(item); };
      item.onkeydown = event => {
        if (event.target !== item) return;
        const visible = [...$('files').querySelectorAll('[role="treeitem"]')].filter(node => node.getClientRects().length);
        const index = visible.indexOf(item);
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
        if (event.key === 'ArrowDown') focusItem(visible[Math.min(visible.length - 1, index + 1)]);
        else if (event.key === 'ArrowUp') focusItem(visible[Math.max(0, index - 1)]);
        else if (event.key === 'Home') focusItem(visible[0]);
        else if (event.key === 'End') focusItem(visible.at(-1));
        else if (event.key === 'ArrowRight' && !isFile) {
          if (item.getAttribute('aria-expanded') === 'false') toggleFolder(item, true);
          else { const child = item.querySelector('[role="group"] > [role="treeitem"]'); if (child) focusItem(child); }
        } else if (event.key === 'ArrowLeft') {
          if (!isFile && item.getAttribute('aria-expanded') === 'true') toggleFolder(item, false);
          else { const parent = item.parentElement.closest('[role="treeitem"]'); if (parent) focusItem(parent); }
        } else if (event.key === 'Enter' || event.key === ' ') {
          if (isFile) openFile(path); else toggleFolder(item);
        }
      };
      target.append(item);
    }
  };
  $('files').replaceChildren(); append(tree, $('files'), 0);
}
function loadModels() {
  editor.setModel(null); models.forEach(model => model.dispose()); models.clear();
  for (const [path, text] of Object.entries(files)) {
    const model = monaco.editor.createModel(text, language(path), monaco.Uri.parse('file:///project/' + path));
    model.onDidChangeContent(() => {
      files[path] = model.getValue();
      if (activePath === path) $('change-dot').hidden = files[path] === original[path];
      clearTimeout(pendingWrites.get(path));
      const current = generation;
      pendingWrites.set(path, setTimeout(() => {
        writeChain = writeChain.then(() => current === generation ? runtime?.write(path, files[path]) : undefined)
          .catch(error => { if (current === generation) fail(error); });
      }, 350));
    });
    models.set(path, model);
  }
  renderTree();
  openFile(files[project.defaultFile] !== undefined ? project.defaultFile : Object.keys(files)[0]);
}

async function runPreview() {
  if (booting) return;
  booting = true; runtime?.stop(); clearErrors();
  previewURL = ''; $('preview').removeAttribute('src'); $('preview').removeAttribute('srcdoc'); $('refresh').disabled = true;
  $('preview-overlay').hidden = false; $('loader').hidden = false; $('retry').hidden = true; $('load-error').hidden = true;
  const current = ++generation;
  for (const timer of pendingWrites.values()) clearTimeout(timer);
  pendingWrites.clear();
  runtime = new SessionRuntime({
    onLog: () => {},
    onState: () => {},
    onError: error => current === generation && fail(error),
    onReady: result => {
      if (current !== generation) return;
      clearTimeout(watchdog); booting = false; clearErrors(); previewURL = result;
      if (typeof result === 'string') {
        $('preview').removeAttribute('srcdoc');
        $('preview').setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
        $('preview').src = result;
      } else {
        $('preview').removeAttribute('src'); $('preview').setAttribute('sandbox', 'allow-scripts'); $('preview').srcdoc = result.html;
      }
      $('preview-overlay').hidden = true; $('refresh').disabled = false;
    },
  });
  watchdog = setTimeout(() => {
    if (current === generation) { runtime.stop(); fail(new Error('预览加载超时，请重试。')); }
  }, 150000);
  try {
    await runtime.start(files, project);
    if (current === generation) await Promise.all(Object.entries(files).map(([path, content]) => runtime.write(path, content)));
  } catch (error) { if (current === generation) fail(error); }
}

async function loadLatest() {
  generation++; booting = false; clearTimeout(watchdog);
  runtime?.stop(); runtime = null; loadController?.abort(); loadController = new AbortController();
  $('retry').hidden = true; $('loader').hidden = false; $('load-error').hidden = true;
  $('preview-overlay').hidden = false; $('preview').removeAttribute('src'); $('preview').removeAttribute('srcdoc');
  const controller = loadController;
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(new URL('api/source', location.href), { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '源码加载失败');
    project = data.project;
    $('project-name').textContent = project.label;
    $('preview-file').textContent = project.entryHtml.split('/').at(-1);
    $('project-toggle').title = `${data.repository} · ${data.branch}`;
    files = { ...data.files }; original = { ...data.files };
    $('app').dataset.commit = data.commit;
    loadModels();
    clearTimeout(timeout);
    await runPreview();
  } catch (error) {
    if (error.name === 'AbortError') error = new Error('源码加载超时，请重试。');
    fail(error);
  } finally { clearTimeout(timeout); }
}
$('retry').onclick = () => Object.keys(files).length ? runPreview() : loadLatest();
$('refresh').onclick = () => {
  if (typeof previewURL === 'string' && previewURL) $('preview').src = previewURL;
  else if (previewURL) $('preview').srcdoc = previewURL.html;
};
$('project-toggle').onclick = () => {
  const expanded = $('project-toggle').getAttribute('aria-expanded') !== 'true';
  $('project-toggle').setAttribute('aria-expanded', String(expanded)); $('files').hidden = !expanded;
};
const divider = document.querySelector('.resize-handle');
function resize(x) {
  const workspace = document.querySelector('.workspace').getBoundingClientRect();
  const explorer = document.querySelector('.explorer').getBoundingClientRect().width;
  const available = workspace.width - explorer - 4;
  const width = Math.max(available * .3, Math.min(available * .75, x - workspace.left - explorer));
  document.documentElement.style.setProperty('--editor-width', `${width}px`);
}
function stopResize() { divider.onpointermove = null; document.body.classList.remove('resizing'); }
divider.onpointerdown = event => {
  divider.setPointerCapture(event.pointerId); document.body.classList.add('resizing');
  divider.onpointermove = e => resize(e.clientX); divider.onpointerup = stopResize; divider.onpointercancel = stopResize;
};
divider.onkeydown = event => {
  if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); resize(divider.getBoundingClientRect().left + (event.key === 'ArrowRight' ? 30 : -30)); }
};
window.addEventListener('pagehide', () => runtime?.stop());
loadLatest();
