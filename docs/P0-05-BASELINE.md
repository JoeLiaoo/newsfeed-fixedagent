# P0-05 上游基线、接口边界与施工顺序

核对日期：2026-10-22（Asia/Shanghai）

本文锁定进入首版范围的上游版本与许可，并记录业务模块目录、迁移顺序和 Hermes 对接合同。锁定版本不代表 Hermes 已部署或微信已联调。

## 上游基线

| 项目 | 固定版本 | 许可 | 首版用途 |
|---|---|---|---|
| AIHOT | `47531faa635c7f4313e526dd0b56312c1a23ba30` | MIT；保留仓库 `LICENSE`、`NOTICE`，第三方字体按各自许可 | 新闻采集、处理、发布、搜索及公共阅读引擎 |
| Hermes Agent | `ebc9960b9d42e11e35ddbb6f0918cc163f739eb1` | MIT；保留上游版权与许可文本 | 目标机上的微信 iLink 网关、定向私聊与定时发送；以官方 Weixin、MCP、cron 文档为接口依据 |

AIHOT 固定版本、已引入目录及改动见 [上游适配记录](UPSTREAM.md)。Hermes 固定提交的 [官方代码记录](https://github.com/NousResearch/hermes-agent/commit/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1)与[该提交的 LICENSE](https://github.com/NousResearch/hermes-agent/blob/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1/LICENSE)已核对为 MIT。渠道行为合同参考该提交的[Weixin/iLink 适配器](https://github.com/NousResearch/hermes-agent/blob/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1/website/docs/user-guide/messaging/weixin.md)和[cron 定向目标](https://github.com/NousResearch/hermes-agent/blob/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1/website/docs/developer-guide/cron-internals.md)。升级 Hermes 时重新核对文档和接口，不使用浮动 `main` 作为生产版本。

## 产品内接口合同

- 平台后端拥有网页用户、关注偏好和持久化通知 outbox；Hermes 拥有渠道登录态、收件人和 iLink 消息收发。用户须先主动私聊机器人以取得可信会话身份。
- P0 试投直接用 Hermes 原生适配器和 `weixin:<收件人>` 定向目标；P3 网页绑定/投递使用[平台 bridge 合同](P3-OPERATIONS.md#hermes-桥接层合同需在目标版本实现)。该 HTTP bridge 是待实现的薄适配层，不宣称为 Hermes 官方 API，也不自建 iLink 协议。
- 身份只从已验证的 Hermes 入站事件取得；平台绑定挑战通过短时随机码、HMAC、时间戳与一次性 nonce 校验。出站 body 携带 recipient、channel account、文本和幂等键；`accepted` 只表示 bridge 受理，超时记 `unknown`，不得盲目重发。
- 微信联系人同意、账号扫码、双用户定向、跨日主动送达以及解绑失效均需在真实渠道验收；当前三个 P3 功能开关默认关闭。

## 本仓库代码目录与迁移顺序

| 阶段 | 主要目录 | 数据迁移 | 交付边界 |
|---|---|---|---|
| P1 账号与资讯 | `apps/web/`、`apps/api/`、`apps/worker/`、`packages/backend/`、`packages/contracts/`、`site/`、`industry/`、`modules/membership/` | `0093`–`0100`：员工账号、会话、兴趣标签与日报 | 用户/内容基础链路；运行仓库全部递增迁移，不手工跳过版本 |
| P2 专家 | `modules/membership/experts/`、`apps/worker/`、`packages/backend/src/providers/` | `0101`–`0115`：专家目录、任务、产物、幂等与租约 | 受限 MCP、异步任务及七天产物生命周期 |
| P3 GP 与通知 | `modules/membership/gp/`、`modules/membership/notifications/`、`modules/membership/pages/gp-admin.tsx` 与 `notifications.tsx` | `0116`–`0151`：GP 快照/审核、绑定、outbox、分类与发送幂等 | 先部署 schema 和默认关闭的管线；外部验收通过后按闸门逐项启用 |
| P4 部署 | `deploy/`、`docker-compose.yml`、`database/migrations/` | 以固定 release 执行所有待应用的递增迁移 | 先隔离部署、健康检查与恢复证明，再核准入口切换；不因迁移成功删除旧数据 |

迁移文件在 `database/migrations/`，迁移记录存于数据库 `_migrations`。执行器按文件名顺序应用尚未执行的迁移；新增迁移必须递增命名并通过仓库迁移安全检查。当前线上 release 已执行至迁移 `0151`，部署日志记录了本次迁移/种子容器退出码为 0；此信息不代替后续版本迁移检查。

## 实际 Hermes 状态

截至本核对日期，目标服务器新应用 Compose 项目不包含 Hermes sidecar，也未确认现有 Hermes 网关及 iLink 账号。P0 原生双用户 D0/D+1 试投和 P3 bridge 均未验收。必须完成用户同意、受控隔离环境与单网关核对，才进入微信实投；不能由 P0-05 的静态合同视为渠道验收。
