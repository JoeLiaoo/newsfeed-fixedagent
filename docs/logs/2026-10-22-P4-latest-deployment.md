# 2026-10-22 · P4 最新主线部署

## 目标与结果

- 目标：将本地已对齐的 GitHub `main` 提交 `5031e2c04dec382263d05b38484b0cfaabeaa15b` 部署到火山云 `ai-work`（`115.190.114.65`）。
- 结果：已发布到 `/opt/citic-newsfeed/releases/5031e2c04dec382263d05b38484b0cfaabeaa15b`。web、API、worker 使用镜像 `citic-newsfeed:5031e2c04dec382263d05b38484b0cfaabeaa15b`；PostgreSQL、Nginx、Hermes 网关、Workbench 及旧应用归档均保留。
- 代码包由 `git archive` 生成并传输；本机归档 SHA-256 为 `ea03de923c8afa31417c430d51fef1c3fad29efee8911a479eea19adc3aaafbdb`。`.config/`、密钥与 `.env` 不在代码包中。

## 数据安全与迁移

- 迁移前备份 `/opt/citic-newsfeed/shared/backups/db-before-5031e2c-20261022.dump`，大小 3,322,815 字节，权限 `0600`，SHA-256 `9a419e80e7790006bfae6b5bfcf496ac17c3a04dd774bafa3a1f24c7b32dd6df`。用运行中的 PostgreSQL 17 容器执行 `pg_restore --list` 成功；未做完整恢复演练。
- 迁移前 `member_weixin_challenges`、`member_bridge_nonces` 各 0 行；迁移 `0152`、`0153` 删除这两个废弃临时表，`0154`、`0155` 创建新的 iLink 登录与账号表。四项迁移均成功并已记录在 `schema_migrations`。
- 迁移/种子步骤报告 4 个迁移已应用、26 个来源已存在且未重复新增。
- 为更新健康接口 release 标识，先将服务器 `/opt/citic-newsfeed/shared/.env` 备份为 `.env.before-release-5031e2c-20261022`，再将 `AIHOT_RELEASE` 更新为目标提交；`.env` 权限保持 `0600`。没有读取或记录供应商凭据。

## 检查结果

- 火山云本机 `http://127.0.0.1:3000/api/health`：`ok=true`、`db=ok`、release 为目标提交。
- 公网 `https://115.190.114.65/api/health`：`ok=true`、`db=ok`、release 为目标提交；`/login` 返回 HTTP 200。
- web、API、worker 容器均运行目标镜像；PostgreSQL 容器健康；`hermes-agent-gateway.service` 保持 active。
- 三个生产开关 `P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED` 仍为 `false`。
- 当前有 3 个 active 平台账号；为避免未限定的生产扫码开放，`P3_ILINK_BINDING_ENABLED` 保持默认关闭，`P3_ILINK_CREDENTIAL_KEY` 未配置。扫码新流程代码虽已部署，员工扫码暂不可用；需明确两名受控试用账号、备份密钥后再开启。
- 未改变 Nginx、外部端口、Hermes 通道、其他 Compose 项目或旧版归档。未运行全量测试。

## 回退边界与后续

- 上一平台镜像 `d7f515e-p3wechat-20261022` 与旧手动绑定表结构不兼容性尚未验证。若要回退应用，先审查 `0152`/`0153` 删表后的旧版本行为；不直接恢复旧镜像或回滚数据库。
- 数据库转储结构可读不等于已证明可恢复；P4 新平台备份恢复验收仍未完成。
- 后续由管理员明确两名试用账号后，生成并安全备份 `P3_ILINK_CREDENTIAL_KEY`，再仅开启 `P3_ILINK_BINDING_ENABLED`；三项数据同步/通知/投递开关继续关闭，直到业务和微信真实端到端验收通过。
