## 实验室服务器部署

本目录负责只读源码服务和独立 HTTPS 网关。前端必须在 项目根目录 本地构建，服务器不执行访客代码。

**Important:** 不挂载宿主源码、编辑器数据、SSH 或 Docker socket；运行环境内没有 GitHub 写入凭据。不得为了访客预览恢复 code-server 或提供服务端 shell。

### Important files

- `Dockerfile` — 打包 `server.py`、`projects.json`、`dist/` 和 Caddyfile；git 只用于注册公共仓库 HEAD 查询，进程以 UID 10001 运行。
- `compose.yaml` — 128MiB 只读应用容器与 96MiB Caddy，只有网关发布 443；专属 Docker 网络与证书卷由 Compose 管理。
- `Caddyfile.site` — 通过 `PLAYGROUND_HOSTS` 配置入口，TLS-ALPN-01 签发/续期证书，保持原主页 80 端口独立；COOP/COEP 只由应用设置，不能重复添加。

### Implementation notes

- 服务器根目录 `/opt/react-playground`，在根目录执行 `docker compose -f deploy/compose.yaml config --quiet`、`docker compose -f deploy/compose.yaml up -d --build`。
- 服务器 `deploy/.env` 维护 `PLAYGROUND_HOSTS`，不上传到 Git。独立入口配置自己的域名，默认 localhost。
- HTTP `/React` 入口的长期事实源为本仓库 `.github/deploy/nginx.conf`；变更后验证 `nginx -t`、重定向、主页及已有 API，保留该仓库的容器集成回归。
- 实验室健康检查 `/healthz`，匿名源码接口 `/React/api/source`；写入方法必须返回 405，未知路径返回 404。
- 证书卷持久保留，普通发布不得删除；卸载 code-server 的数据、凭据和交换文件不涉及本服务。

- 自动发布入口为本仓库 `.github/workflows/codeground-cicd.yml` 和 `.github/deploy/codeground.sh`，镜像版本由 `CODEGROUND_IMAGE` 控制；自动更新不会覆盖服务器 `.env` 中的 PLAYGROUND_HOSTS。
- `/opt/react-playground`、`102my-react-playground`、`react-playground-https` 及 `deploy_playground` 为线上兼容名称，保留现有证书与连接，事实源已迁至 本独立仓库。
- 自动发布只消费 CI 已构建镜像；脚本要求首次部署的运行环境已存在，遇到未处理 previous 容器停止操作，健康失败回滚应用与网关配置。

- Caddyfile 与 compose.yaml 是通用独立入口，所有流量转发 playground；没有 homepage 外部网络。Caddyfile.site 仅由兼容 CI 镜像供原站点网关使用，不用于通用 Compose。

- 根 .dockerignore 必须允许 deploy/Caddyfile.site，确保兼容发布镜像可构建；通用 Compose 挂载普通 Caddyfile。
