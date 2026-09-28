# codeground

使用 Monaco 和 WebContainers 构建的浏览器代码实验室，支持在线查看、编辑与预览项目，并提供基于 esbuild WASM 的本地编译回退。

项目来源通过配置注册。访客代码在浏览器中运行，刷新页面后清除修改。

## 在线体验

[打开 Codeground 在线编辑与预览](https://www.lanbinquan.top/codeground/react/)

## 快速开始

建议使用 Node.js 24、Python 3.12 和 Git。

```bash
git clone https://github.com/neo-jack/codeground.git
cd codeground
npm ci

# 启动只读源码服务
python server.py --host 127.0.0.1 --port 8091
```

另一个终端进入仓库目录，启动前端：

```bash
npm run dev
```

在 Vite 提供的本地地址访问 `/codeground/react/`。修改 `projects.json` 可配置自己的公开仓库、分支、入口文件和运行依赖；现有 React 示例可作为配置参考。

## 构建与验证

在仓库根目录执行：

```bash
# 验证源码读取边界与浏览器运行配置
python -m unittest test_server.py
node --test test_runtime.mjs

# 生成前端构建产物
npm run build
```
