import { normalizePath } from './project-runtime';
import CompileWorker from './compile.worker?worker';

export class LocalRuntime {
  constructor(callbacks) { Object.assign(this, callbacks); this.serial = 0; }

  async start(files, project) {
    this.project = project;
    this.files = { ...files };
    this.worker = new CompileWorker();
    this.onLog('\n已切换到浏览器本地编译，代码仍只在你的设备中运行。\n');
    this.worker.onmessage = ({ data }) => {
      if (data.id !== this.serial) return;
      if (data.error) {
        const error = new Error(data.error);
        error.diagnostics = data.diagnostics || [];
        return this.onError(error);
      }
      const doc = new DOMParser().parseFromString(this.files[this.project.entryHtml], 'text/html');
      // Isolated opaque-origin preview: no host origin, storage, network or navigation.
      doc.querySelectorAll('script,base,meta[http-equiv],link').forEach(node=>node.remove());
      const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
      csp.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
      doc.head.prepend(csp);
      const style = doc.createElement('style'); style.textContent = data.css; doc.head.append(style);
      const script = doc.createElement('script'); script.textContent = data.js.replace(/<\/script/gi, '<\\/script');
      doc.body.append(script);
      this.onState('运行中 · 浏览器本地预览');
      this.onReady({ html: '<!doctype html>\n' + doc.documentElement.outerHTML, mode: 'local' });
    };
    this.worker.onerror = () => this.onError(new Error('浏览器本地编译启动失败，请刷新重试。'));
    this.compile();
  }

  compile() {
    this.onState('正在浏览器中编译…');
    const doc = new DOMParser().parseFromString(this.files[this.project.entryHtml], 'text/html');
    const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src');
    if (!src || /^(?:[a-z]+:|\/\/)/i.test(src)) return this.onError(new Error('演示入口需要使用项目内的 module script。'));
    const directory = this.project.entryHtml.split('/').slice(0, -1).join('/');
    const root = this.project.runtime?.root || directory || '.';
    const entry = normalizePath((src.startsWith('/') ? root : directory) + '/' + src.replace(/^\//, ''));
    this.worker.postMessage({ id: ++this.serial, files: this.files, entry, project: this.project });
  }

  async write(path, value) {
    if (this.files[path] === value) return;
    this.files[path] = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.compile(), 180);
  }
  stop() { clearTimeout(this.timer); this.worker?.terminate(); }
}
