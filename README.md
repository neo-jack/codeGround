# Codeground

免登录的浏览器代码编辑与预览工具：Monaco 文件树/编辑器、WebContainers，以及外部运行服务无法连接时的本地 WASM 编译回退。访客代码不在服务器执行，刷新即清除改动。

## 地址与源码归属

- `/React/`：保留原有 React 示例地址。
- `/codeground/react/`：同一示例的通用地址。
- `/codeground/`：跳转到 `projects.json` 的 `defaultProject`。
- 编辑器源码位于 本独立仓库。React 示例仍从 `neo-jack/102my-react` 的 `master` 最新提交读取；两者不相互覆盖。

## 添加项目

在 `projects.json` 的 `projects` 中增加一项，例如下面的配置结构（`owner/repository` 请替换为自己的公开仓库）：

```json
{
  "demo": {
    "label": "TypeScript Demo",
    "repository": "owner/repository",
    "branch": "main",
    "routes": [],
    "includeRoots": ["src"],
    "includeFiles": ["index.html", "package.json"],
    "entryHtml": "index.html",
    "defaultFile": "src/main.ts",
    "runtime": {
      "root": ".",
      "dependencies": {"vite": "5.4.21"},
      "aliases": [],
      "define": {},
      "virtualFiles": {}
    }
  }
}
```

HTML 入口应包含项目内的 `<script type="module" src="/src/main.ts"></script>`。发布后地址为 `/codeground/demo/`，无需改编辑器页面。手写 React 的特殊别名与 JSX 适配全部配置在现有 `react` 项中；可按需设置 `jsxImportSource`。

支持 HTML module 入口与 JS/TS/JSX/TSX 源码。WebContainers 在浏览器安装配置中的依赖（禁用 install scripts），不执行远程仓库的 package scripts。WASM 回退只支持项目内模块、配置别名和内置 scheduler；新增框架/第三方库可能需要额外适配，不支持服务端语言。

只有维护者可修改注册表。访客无法指定任意仓库 URL、访问服务器目录或获得 GitHub 写入凭据。源码白名单仍排除隐藏文件、依赖、凭据与部署资料。

## 开发与验证

在本目录运行：

```sh
npm ci
python -m unittest test_server.py
node --test test_runtime.mjs
npm run build
```

本地后端：`python server.py --host 127.0.0.1 --port 8091`；另一个终端运行 `npm run dev`，访问 `/React/` 或 `/codeground/react/`。生产必须 HTTPS，并使用 COOP/COEP。

## GitHub 自动更新

`.github/workflows/codeground-cicd.yml` 是独立工作流：

1. PR 检查；`master` / `main` 上本仓库的 push 独立部署，也可手动触发。
2. 检查 Python 读取边界、浏览器适配、部署回滚，构建前端并验证受限容器。
3. 发布 `ghcr.io/<owner>/codeground:<提交 SHA>`，通过 SSH 更新编辑器服务。
4. 健康失败回滚旧容器及 Caddy 配置，不清理其他网站或 TLS 证书。

复用主页仓库 Secrets：`SERVER_HOST`、`SERVER_USER`、`SERVER_PASSWORD`。`GITHUB_TOKEN` 的包写权限只赋予发布 job。**只迁移/修改本地目录不会触发更新，必须提交并推送到 GitHub。** 工作流文件本身不会自动改写。

既有服务器路径 `/opt/react-playground` 和容器名 `102my-react-playground`、`react-playground-https` 为兼容保留；实际事实源已迁移，避免变更网络别名和证书卷导致停机。HTTPS 配置来自本目录 `deploy/Caddyfile`，域名与证书仍由服务器维护。首次安装可使用 `deploy/compose.yaml`；日常 CI 使用 `.github/deploy/codeground.sh` 拉取已构建镜像，不在服务器重新编译前端。

## 独立使用

Node.js 构建与 Python 只读服务都在本仓库。修改 projects.json 即可配置自己的公共仓库、分支、入口和运行依赖；也可通过进程环境 CODEGROUND_PROJECTS_FILE 指定外部 JSON，默认读取本目录注册表。

`npm ci`、`npm run build`，然后 `python server.py --host 127.0.0.1 --port 8091`。开发运行 `npm run dev`，源码服务单独运行。测试 `python -m unittest test_server.py`、`node --test test_runtime.mjs`。

独立 HTTPS 部署：配置 deploy/.env 的 PLAYGROUND_HOSTS，运行 `docker compose -f deploy/compose.yaml up -d --build`；只需要自己的网络和证书卷，不依赖 3D 页面容器。通用 Caddyfile 将流量交给实验室；Caddyfile.site 仅保留原个人站点的网关兼容路由，由原站点发布脚本使用。

## GitHub 与提交历史

仓库：<https://github.com/neo-jack/codeground>（私有）。独立仓库主分支为 master，从整理后的项目初始提交开始维护；拆分前历史保存在本机项目归档中。CI 自动检查，只有仓库变量 `DEPLOY_ENABLED=true` 才执行镜像发布及服务器部署。npm 包发布仍单独维护。
