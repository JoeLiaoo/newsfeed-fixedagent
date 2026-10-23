# P4 · PR #29 合并与火山云发布（2026-10-23）

## 合并与目标

- [PR #29](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/29) 已合并；提交 `bd53dcbb8a46b83712160409b9424a2ff7061f62`。
- 发布前 web、API、worker 使用 `8a84319f8787078c8e321deeabad5bb2b503af6a`；本轮只增加注册页提示及文档，不改变接口或数据库结构。

## 发布操作

- 从固定合并提交创建源码归档，排除 `.config/`、`.env` 与密钥文件；发布目录为 `/opt/citic-newsfeed/releases/bd53dcbb8a46b83712160409b9424a2ff7061f62`。
- 先备份共享配置到 `/opt/citic-newsfeed/shared/.env.before-release-bd53dcb-20261023`，数据库转储到 `/opt/citic-newsfeed/shared/backups/db-before-bd53dcb-20261023.dump`；两文件权限均为 `0600`。转储大小 6,669,747 字节，`pg_restore --list` 检查通过，未做完整恢复演练。
- 目标机 Docker Hub 基础镜像访问受限，发布目录中的 `Dockerfile.volcengine` 临时改用已验证的 `docker.m.daocloud.io/library/node:24-trixie-slim`；仓库源码不变。构建镜像 `citic-newsfeed:bd53dcbb8a46b83712160409b9424a2ff7061f62` 成功。
- 更新共享 `.env` 中的 `AIHOT_RELEASE`；setup 退出码 0，输出数据库已是最新、26 个信源已存在。重建 web、API、worker；数据库、Nginx、Hermes 网关和旧应用资源未切换或清理。

## 发布核对与回退

- web、API、worker 均运行目标镜像；数据库容器健康。本机及公网 `/api/health` 返回 `ok=true`、`db=ok`，release 为目标提交。
- 公网 `/register` 返回 HTTP 200；服务端及公网 HTML 均包含用户名规则、密码提醒和对应的 `aria-describedby`。
- 需要回退时使用上一个新平台镜像 `citic-newsfeed:8a84319f8787078c8e321deeabad5bb2b503af6a` 和本轮配置备份，保留数据库卷与转储；本轮没有 schema 迁移。未进行实际回退演练。
- 员工浏览器中的视觉及辅助技术体验尚未人工验收；P4-02～P4-04 状态不因本次发布而改变。
