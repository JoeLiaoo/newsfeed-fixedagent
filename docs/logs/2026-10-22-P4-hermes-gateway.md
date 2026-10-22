# 2026-10-22 · P4 Hermes Weixin/iLink 网关部署

- Agent：Codex
- 对应任务：P4-02 部署；同时记录 P0-03/P3-04 微信渠道进展，不代表相关业务验收完成
- 完成状态：Hermes 独立网关已部署并连接一个 Weixin/iLink bot 身份；双用户试投及平台 bridge 未完成

## 本次改动

- 修改文件：`docs/DEPLOY-VOLCENGINE.md`、`docs/P0-03-04-OPERATIONS.md`、`docs/P0-STATUS.md`、`docs/P3-OPERATIONS.md`、`docs/IMPLEMENTATION.md`、`docs/PROGRESS-REPORT.md`、`docs/README.md`、根目录 `README.md`、本日志。
- 实际完成：在火山云实例 `/opt/hermes-agent` 部署锁定上游提交 `ebc9960b9d42e11e35ddbb6f0918cc163f739eb1` 的 Hermes Agent；使用独立 `hermes` 系统用户和 `hermes-agent-gateway.service`。DeepSeek Flash 已设为 Hermes 默认模型；Weixin/iLink 登录通过二维码完成，systemd 网关连接成功。
- 渠道策略：`WEIXIN_DM_POLICY=pairing`，`WEIXIN_GROUP_POLICY=disabled`。凭据与账号文件权限为 `0600`；未在日志或文档记录账号 ID、用户 ID、token 或二维码。Weixin 使用 iLink 长轮询，没有新增公网监听端口。
- 首次扫码返回成功后，网关收到会话过期响应；重新扫码取得新会话后重启网关，连接成功并持续运行。向导没有安装第二个服务，使用原有 systemd unit。
- 关键边界：当前仅验证一个 bot 身份连接；没有验证两位员工分别私聊、定向收到消息或 D+1 跨日投递。网页账号绑定 bridge 也未接入 Hermes。新平台三个 `P3_*_ENABLED` 开关保持关闭。

## 最小验证

- `systemctl is-active hermes-agent-gateway.service` 返回 `active`。
- Hermes 日志确认 `[Weixin] Connected account=...` 与 `weixin connected`；重新登录后的启动窗口未见会话过期错误。
- `.env` 与 iLink 账号文件均为 `0600`、属主为 `hermes:hermes`；日志只检查了 DM/group 策略名，未读取或输出凭据值。
- 未执行两名员工的 D0/D+1 送达试投、网页绑定流程、微信与业务用户映射核验或 P3 outbox 联调。

## 风险与交接

- 已知限制／缺失依赖：单个 iLink bot 登录不是员工个人微信绑定；平台 bridge 合同仍需实现并联调。iLink 会话可过期，遇到过期需重新扫码；凭据轮换后应确认 systemd 读取最新 `.env`。
- 下一步：在用户同意的隔离试用窗口，按[双用户微信试用手册](../P0-03-04-OPERATIONS.md#p0-03双用户绑定主动投递与跨日送达)完成两用户 D0/D+1 原生投递；随后按[P3 运维手册](../P3-OPERATIONS.md)完成网页绑定 bridge 与端到端验收。保持三个 P3 开关关闭，直至对应闸门满足。
