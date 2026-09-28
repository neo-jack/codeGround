## 107my-codeground 自动化

本目录只属于当前独立仓库，工作流以本仓库根目录安装、测试、构建与发布，不读取相邻项目。

**Important:** Secrets 配置在对应远程仓库。原站点容器、网络和证书名称作为兼容部署保留；本地改动不表示已上线。

### Important files

- `workflows/` — 当前项目 CI/CD，master/main push、手动触发与 PR 执行检查；仅 DEPLOY_ENABLED=true 时允许部署。
- `deploy/` — 原站点兼容镜像、代理或事务脚本，各脚本只替换目标容器，不删除持久卷。

### Implementation notes

- 不恢复原父仓库路径过滤或跨目录 working-directory。每个仓库独立配置远程和 Secrets，不自动继承旧仓库远程。
- 保留项目单独回滚及服务器锁；通用独立部署使用本仓库根或 deploy 下的 Docker/Compose 入口。
- Windows 脚本回归设置 DEPLOY_TEST_SHELL 为 Git Bash；Docker 容器集成需要已运行的 Linux Docker 引擎。

- 部署门禁为仓库 Actions variable `DEPLOY_ENABLED=true`；默认只运行 CI，不发布镜像或连接服务器。开启前在本仓库配置 SERVER_HOST / SERVER_USER / SERVER_PASSWORD。

- GitHub 仓库名称为 neo-jack/codeground；本地编号目录仅用于排序，不作为远程仓库名。
