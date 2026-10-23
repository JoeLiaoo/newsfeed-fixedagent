# P4 · PR #22 合并与火山云发布（2026-10-23）

## 合并

- PR #22「改进微信扫码绑定反馈与消息状态」已通过 Docs checks、P3 checks 并合并。
- 合并提交：`8a84319f8787078c8e321deeabad5bb2b503af6a`。

## 发布操作

- 发布目录：`/opt/citic-newsfeed/releases/8a84319f8787078c8e321deeabad5bb2b503af6a`；沿用 `/opt/citic-newsfeed/shared/.env`。
- 发布前备份 `.env.before-release-8a84319-20261023` 与 `backups/db-before-8a84319-20261023.dump`，权限均为 `0600`；转储大小 6,021,463 字节，PostgreSQL 容器中 `pg_restore --list` 检查成功。未执行完整恢复演练。
- Docker Hub 基础镜像元数据请求停滞，使用上次发布已验证的 `docker.m.daocloud.io/library/node:24-trixie-slim`。只在本次发布目录调整 `Dockerfile.volcengine`，仓库源码未改。
- 镜像 `citic-newsfeed:8a84319f8787078c8e321deeabad5bb2b503af6a` 构建成功；setup 输出“database is up to date”“sources: 0 added, 26 already there”。重建 web、API、worker；数据库、Nginx、Hermes 网关和其他 Compose 项目未切换。

## 检查与剩余事项

- web、API、worker 均运行新镜像；数据库容器健康。
- 本机和公网 `/api/health` 返回 `ok=true`、`db=ok`、release 为合并提交；公网 `/login` 返回 HTTP 200。
- 新标签页打开官方二维码、扫码完成提示、入站消息复选框及通道互动状态需由用户真机验证。P3-04 保持未完成。
