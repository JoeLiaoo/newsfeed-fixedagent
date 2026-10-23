# P4 · PR #19 合并与火山云发布（2026-10-23）

## 审查与合并

- [PR #19](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/19) 的导航和二维码跳转改动已审查；Docs checks、P3 checks 均通过，未发现阻碍合并的问题。
- 合并提交：`a2d67e9a36e2980b55f51a3d1a3c6e231fb89a17`。本地 `main` 已快进至该提交；由该提交生成部署归档，SHA-256 为 `426121c10df50cf00aec6cc280ec6b4bc287faaea6633bff6feb86af01c706c8`。

## 发布操作

- 发布目录：`/opt/citic-newsfeed/releases/a2d67e9a36e2980b55f51a3d1a3c6e231fb89a17`；沿用 `/opt/citic-newsfeed/shared/.env` 的受保护配置。
- 发布前备份 `.env.before-release-a2d67e9-20261023`（`0600`）和 `backups/db-before-a2d67e9-20261023.dump`（5,494,431 字节，`0600`），在 PostgreSQL 17 容器中执行 `pg_restore --list` 成功；未做完整恢复演练。
- 直接向 Docker Hub 查询基础镜像元数据停滞，改用服务器已缓存、镜像 ID 相同的 `docker.m.daocloud.io/library/node:24-trixie-slim` 构建。仅调整服务器发布目录的 Dockerfile，仓库文件和应用源码未改。
- 构建镜像 `citic-newsfeed:a2d67e9a36e2980b55f51a3d1a3c6e231fb89a17`；迁移/种子输出为“database is up to date”“sources: 0 added, 26 already there”。重建 web、API、worker；数据库、Nginx、Hermes 网关和其他项目未切换。

## 检查与剩余事项

- web、API、worker 均运行新镜像；数据库容器健康。
- 本机及公网 `/api/health` 均返回 `ok=true`、`db=ok`、release 为合并提交；公网 `/login` 返回 HTTP 200。
- API、worker 的 `P3_ILINK_BINDING_ENABLED`、`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED` 均为 `true`；API 中密钥长度格式检查通过，未输出密钥。
- 尚未以真实个人微信验证官方二维码页面、绑定回执、返回平台后的状态与后续定向投递；P3-04 仍未完成。
