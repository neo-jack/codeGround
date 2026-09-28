import { WebContainer } from '@webcontainer/api';

import { fileTree } from './project-runtime';

export class BrowserRuntime {
  constructor({ onLog, onState, onReady, onError }) {
    Object.assign(this, { onLog, onState, onReady, onError });
    this.instance = null;
    this.stopped = false;
  }

  async start(files, project) {
    if (!window.isSecureContext || !window.crossOriginIsolated) {
      throw new Error('运行预览需要 HTTPS 和浏览器隔离支持，请使用最新版 Chrome 或 Edge。');
    }
    this.onState('正在创建你的独立运行环境…');
    this.instance = await WebContainer.boot({ coep: 'credentialless', workdirName: 'codeground' });
    if (this.stopped) return this.instance.teardown();
    this.instance.on('error', error => this.onError(new Error(error.message)));
    this.instance.on('server-ready', (port, url) => {
      if (port !== 5173 || this.stopped) return;
      this.onState('预览已就绪');
      this.onReady(url);
    });
    await this.instance.mount(fileTree(files, project));
    this.onState('正在安装浏览器运行依赖…');
    const install = await this.instance.spawn('npm', ['install', '--prefix', '.codeground', '--no-audit', '--no-fund', '--ignore-scripts']);
    this.pipe(install);
    const code = await install.exit;
    if (this.stopped) return;
    if (code !== 0) throw new Error('依赖安装失败。请检查 npm 网络连接后重试。');
    this.onState('正在启动预览…');
    this.server = await this.instance.spawn('node', ['.codeground/node_modules/vite/bin/vite.js', '--config', '.codeground/vite.config.mjs']);
    this.pipe(this.server);
    this.server.exit.then(code => {
      if (!this.stopped) this.onError(new Error(`预览进程已退出（${code}），可点击“重新运行”。`));
    });
  }

  pipe(process) {
    process.output.pipeTo(new WritableStream({ write: text => {
      if (!this.stopped) this.onLog(text);
    } })).catch(() => {});
  }

  async write(path, value) {
    if (this.instance && !this.stopped) await this.instance.fs.writeFile(path, value);
  }

  stop() {
    this.stopped = true;
    this.server?.kill();
    this.instance?.teardown();
    this.instance = null;
  }
}
