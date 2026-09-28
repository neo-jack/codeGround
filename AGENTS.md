## Codeground 浏览器实验室

独立 Git 仓库中的 Vite 应用，使用 Monaco、WebContainers 与 WASM 回退在访客浏览器中运行公开代码。源码从 `projects.json` 注册的仓库读取，默认项目是 `neo-jack/102my-react`；不属于 React 库工作区，独立安装构建。

**Important:** 服务器只提供前端文件与固定公共仓库的只读快照；不执行访客代码，不接收文件写入，不持有 GitHub 凭据，不暴露宿主目录、Docker socket 或终端。访客修改只在当前页面内存及其 WebContainer 中存在。

### Important files

- `README.md` — GitHub 项目入口，沿用 miniReact 的简洁结构：项目简介、在线体验、快速开始、构建与验证；标题使用 GitHub 仓库名，只保留必要接入配置，不混入本机目录编号、迁移记录或提交历史说明。

- `src/main.js` / `src/style.css` — 极简三栏文件树、Monaco 与右侧预览；文件树参考 VS Code 的紧凑层级、折叠与键盘导航，JS/TS/TSX 等使用彩色类型标识和说明 tooltip。
- `src/runtime.js` — 浏览器隔离运行时，使用最小 Vite 依赖和自研 React 的路径映射；不执行仓库安装脚本。
- `src/session-runtime.js` / `src/local-runtime.js` / `src/compile.worker.js` — WebContainers 网络失败时，自动切换到同浏览器的 esbuild WASM 编译；预览使用无同源权限的 sandbox srcdoc，并通过 CSP 禁止联网、导航和表单提交。
- `projects.json` — 项目注册表：仓库、分支、路由别名、允许文件边界、HTML/默认文件及运行依赖/别名/虚拟模块；新增项目不改 UI。
- `src/project-runtime.js` / `test_runtime.mjs` — 通用内存文件树、模块别名和 Vite 配置生成，以及普通 TS 项目/React 兼容/路径隔离测试。
- `server.py` — 按注册项目查询 HEAD、获取归档、文件白名单和只读 HTTP 服务；未知项目与任意 URL 查询一律拒绝。
- `test_server.py` — 归档路径、隐藏文件、链接、体积限制和 HTTP 只读边界回归。
- `deploy/` — 容器与 HTTPS 入口配置；数据服务内网运行，Caddy 管理证书，仅注册项目的页面与资源添加跨源隔离头。

### Implementation notes

- Monaco 按需引入时，语言服务 `language/*/monaco.contribution` 不代替语法分词模块；`src/main.js` 必须保留 JS/TS、HTML、CSS、Markdown、YAML 的 `basic-languages` 注册（JSON 由语言服务提供分词）。`react-lab` 主题统一维护 token 配色和括号层级颜色，JSX/TSX 分别复用 JavaScript/TypeScript。
- `npm ci`、`npm run build`、`npm run dev` 在本目录执行；后端开发使用 `python server.py --host 127.0.0.1 --port 8091`，Vite 代理 `/React/api/` 与 `/codeground/<项目>/api/`。
- Python 回归：`python -m unittest test_server.py`。发布时构建本地静态产物，再以 `deploy/Dockerfile` 打包，不在小内存服务器构建前端。
- 每个页面加载请求对应注册仓库及分支的最新 SHA，服务端只缓存相同 SHA 的文件内容，错误时明确显示，不悄悄降级旧源码；刷新页面销毁本次修改并获取最新源码。
- 仓库源码只读获取，允许编辑的内容只有响应白名单文件。禁止挂载 `.git`、环境文件、部署目录、服务器数据；不能添加提交、推送、服务端保存或任意 URL 代理接口。
- 浏览器必须使用 HTTPS 和 COOP `same-origin`、COEP `credentialless`。响应头只在 `server.py` 设置，Caddy 不重复添加；重复的 COOP/COEP 值会让浏览器隔离失效。WebContainer 与预览独立于站点源；iframe 不允许顶层导航、弹窗和下载。
- HTML 和源码 API 使用 no-store；内容哈希 assets 使用长期 immutable 缓存，避免每次重置重新下载编辑器和 WASM。
- WebContainers 初次加载依赖其服务和 npm 网络。失败时保留源码编辑器并显示明确错误及重试入口，不能冒充运行成功。
- 若 12 秒内外部 WebContainers 启动未完成，使用浏览器本地编译回退。回退只支持项目内模块与自带 scheduler，不执行 package scripts；不支持的外部依赖显示编译错误。
- 页面不展示品牌横幅、宣传说明、帮助入口、重置按钮、运行日志、会话说明或底部状态栏。正常运行只保留文件树、活动文件标签和预览；需要重置时刷新浏览器。
- 本地编译诊断通过 worker 返回文件/行/列，映射为 Monaco 红色标记；错误时保留最后有效预览，预览工具栏仅显示简短错误图标。初次加载失败保留重试按钮，不展示原始日志；编译恢复后清除标记。
- 开源个人演示使用 WebContainer API；商业化前核对 WebContainers 商业授权。

- 前端构建 base 为 `./`，同一产物服务 `/React/` 和 `/codeground/<项目>/`；项目显示名和入口来自匿名只读响应，不再硬编码 React 路径。每个项目有独立快照缓存。
- 支持 module script 入口的 HTML/JS/TS/JSX/TSX；WebContainers 支持配置中的依赖，本地 WASM 回退只支持项目模块、配置别名和内置 scheduler。不承诺任意框架、后端或未适配第三方库即插即用。
- `.github/workflows/codeground-cicd.yml` 在 master 对相关路径的 push 后运行 Python、JS、部署回滚与受限镜像验证，构建并发布独立镜像；本地变更必须先提交推送。服务器 Secrets 与主页一致。
- 新项目使用标准 `/codeground/<id>/` 无需改代理；新增顶层 routes 别名必须同步 Caddy/Nginx 规则。项目注册结构以 projects.json 为准，部署边界见 deploy/AGENTS.md。

- CODEGROUND_PROJECTS_FILE 可指定外部 JSON 注册表；默认使用本仓库 projects.json。deploy/compose.yaml 为独立网络，不依赖主页；Caddyfile.site 仅供原站点兼容发布。

- GitHub 远程为 `neo-jack/codeground`，公开仓库、master 主分支；主分支以独立项目初始提交重建，旧历史保存在本机归档。上传默认仅 CI，部署需仓库变量 DEPLOY_ENABLED=true。
