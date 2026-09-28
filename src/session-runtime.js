import { BrowserRuntime } from './runtime';

export class SessionRuntime {
  constructor(callbacks) { this.callbacks = callbacks; this.closed = false; }
  async start(files, project) {
    this.project = project;
    this.files = { ...files };
    const callbacks = { ...this.callbacks, onError: error => {
      if (this.active === this.web) this.fallback(error);
      else this.callbacks.onError(error);
    } };
    this.web = new BrowserRuntime(callbacks); this.active = this.web;
    try {
      await Promise.race([
        this.web.start(this.files, project),
        new Promise((_, reject) => { this.timeout = setTimeout(() => reject(new Error('WebContainers 外部连接超时')), 12000); }),
      ]);
      clearTimeout(this.timeout);
    } catch (error) { await this.fallback(error); }
  }
  async fallback(error) {
    if (this.closed || this.switching) return;
    this.switching = true;
    clearTimeout(this.timeout); this.web?.stop();
    this.callbacks.onLog('\nWebContainers 暂不可用：' + error.message + '\n');
    const { LocalRuntime } = await import('./local-runtime');
    if (this.closed) return;
    this.active = new LocalRuntime(this.callbacks);
    await this.active.start(this.files, this.project);
  }
  async write(path, value) { this.files[path] = value; await this.active?.write(path, value); }
  stop() { this.closed = true; clearTimeout(this.timeout); this.active?.stop(); }
}
