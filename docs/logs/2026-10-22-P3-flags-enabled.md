# 火山云 P3 功能开关启用记录（2026-10-22）

## 操作

按用户指示启用扫码入口、GP 同步、通知生成和投递。生产配置 `/opt/citic-newsfeed/shared/.env` 中的以下开关均设置为 `true`：

- `P3_ILINK_BINDING_ENABLED`
- `P3_GP_SYNC_ENABLED`
- `P3_NOTIFICATIONS_ENABLED`
- `P3_DELIVERY_ENABLED`

为 iLink 凭据加密生成了 32 字节随机 `P3_ILINK_CREDENTIAL_KEY`。API 和 worker 容器已强制重建。两个容器运行环境均核验四项开关为 `true`，密钥有效性检查通过；没有读取、输出或写入本记录密钥值。

## 配置备份与权限

- 操作前 `.env` 备份：`/opt/citic-newsfeed/shared/.env.before-p3-enable-20261022`
- 启用后受保护备份：`/opt/citic-newsfeed/shared/backups/.env-p3-enabled-20261022`
- `.env` 与备份文件权限为 `0600`；备份目录权限为 `0700`。

## 启用时的数据状态

- active 平台账号：3
- active 微信绑定：0
- iLink 账号：0
- 通知 outbox：0 条
- GP watchlist：0；active GP：0

因此扫码入口已对 active 平台账号开放，但没有已绑定微信收件人、GP 监测对象或待投递通知。此次启用没有产生实际微信投递或 GP 同步目标。

## 检查与验收边界

- API 与 worker 环境变量核验通过。
- API 健康检查：`ok=true`、`db=ok`，release 为 `5031e2c04dec382263d05b38484b0cfaabeaa15b`。
- 公网 `/login` 返回 HTTP 200；相关容器运行中。
- 本次未运行测试，也未执行真实微信扫码、新华财经 GP 同步或用户侧送达验收。
- 开关启用不代表业务验收完成；P3-04 及 P3 的四项交付验收继续保持未完成。

## 回退

如需恢复启用前配置，可由有权限的运维人员使用 `.env.before-p3-enable-20261022` 核对并恢复，再重建 API 与 worker。不要删除启用后备份或轮换加密密钥；更换密钥前必须先制定已有 iLink 凭据的迁移方案。
