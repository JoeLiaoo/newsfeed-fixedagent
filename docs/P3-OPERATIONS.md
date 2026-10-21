# P3 GP 监测与微信联调

## 安全启动

运行 npm run member:seed-gp（在数据库迁移后）导入候选。初始 9 个候选主体来自 `reference/母基金已投子基金管理人.md`，均为 `candidate`，不自动认定基金管理人等于直接投资 GP。在 `/settings/admin-gps` 确认主体名称、唯一实体 ID、GP/管理人/基金角色及公开证据后，才允许启用监测。首次完整快照作为历史基线；以后新增的投资关系标为 `observed`，不能凭新华财经入库日期或更新时间判定为“当日投资”。管理员提供**独立事实证据 URL + 真实事件日期 + 赛道**后，才可标记为 `verified`，进入每日 GP 汇总。

三个功能开关默认关闭：`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`。逐项确认外部联调后再开启，避免未核验的数据触发通知。模型 `MODEL_CALLS_ENABLED=true` 时可建议四大产业细分赛道，结果仅供管理员复核；不允许战略配售标签参与 GP 匹配。

## Hermes 桥接层合同（需在目标版本实现）

Hermes 端只启动一个 Weixin/iLink 网关，并在收到用户给机器人私聊的绑定码时，从真实渠道事件提取真实收件人 ID 和机器人账号 ID；不得信任网页登录传入的收件人。平台负责业务用户、偏好与消息 outbox，Hermes 只负责渠道收发。

**入站确认**：用户先在 `/settings/notifications` 获取 10 分钟有效的随机绑定码，私聊机器人发送。可信的 Hermes 适配器请求：

- URL：`POST /api/v1/membership/bridge/claim`
- JSON：`{"code":"绑定码","recipientId":"网关收件人 ID","channelAccountId":"机器人账号 ID"}`
- Headers：`x-p3-timestamp` 为 Unix 毫秒；`x-p3-nonce` 为至少 16 位的一次性随机串；`x-p3-signature` 为十六进制小写 HMAC-SHA256。
- 待签名字符串由 timestamp、nonce、code、recipientId、channelAccountId 按顺序用真实换行符连接，密钥为双方配置的 `P3_BINDING_HMAC_SECRET`（至少 32 字符）。

服务端校验签名、时间漂移、nonce 重放、绑定码和过期状态；只存绑定码哈希。网页用户再点击确认绑定。一个微信收件人不能同时绑定多个网页账号。

**出站发送**：平台 worker 通过固定地址 `P3_HERMES_BRIDGE_URL` 向部署在 ai-work 的适配 sidecar 发送 HTTPS 请求（或同主机 loopback HTTP），并使用 `P3_HERMES_BRIDGE_TOKEN` 作为 Bearer 授权。body 为 `{"recipientId":"...","channelAccountId":"...","text":"...","idempotencyKey":"outbox-id"}`，HTTP header `x-idempotency-key` 同步携带该 ID。bridge 必须持久化此幂等键、调用真正的 Hermes Weixin 发送接口，并在渠道已受理时返回 2xx JSON `{"accepted":true,"messageId":"渠道消息 ID"}`。当会话过期，返回 410；确认的渠道限流返回 429。平台仅把 `accepted` 当作接口受理，不代表已送达。超时或模糊故障转 `unknown`，不盲目重发。

**注意：** 上述是平台定义的 sidecar 对接协议，不代表 Hermes 官方已经提供同名 HTTP API。还需对锁定版本的 Hermes adapter 编写并测试 sidecar，不能宣称真实微信已打通。

## 日历与调度

平台 worker 北京时间每小时轮询经核准的 GP（仅开启后），每天按工作日资讯 09:00 / GP 10:00、休息日资讯 11:00 / GP 12:00 分别生成两类消息，按用户兴趣过滤并去重，超长正文分片发送，空内容仍发“今日无更新”。每 5 分钟领取 outbox 发送。首次推送从绑定时刻起算；不补发历史基线。

必须由运维根据官方节假日、补班表设置 `P3_CN_HOLIDAYS` 和 `P3_CN_MAKEUP_WORKDAYS`（均为半角逗号分隔 YYYY-MM-DD）。若未配置，系统只能识别通常周末，不能准确覆盖国家法定假期。

## 验收清单

1. 真实新华财经：主体唯一 ID 核实、完整分页/上限及数据授权；至少一组已知 GP 关系快照复查。
2. 真实 DeepSeek：四类细分赛道准确率、低证据时空分类、费用、限流及人工修订。
3. 同意参与的两个真实微信用户：扫码建会话、双向绑定、独立偏好和内容、解绑即时失效；至少连续 3 天跨日主动投递，包含普通日和可核验的休息日。
4. 渠道故障：401/410、429、超时、accepted 与未知回执；检查是否会重复投递或越权读取。
5. 上线前先完成 ai-work-mvp 同事备份确认及只读盘点，禁止因 P3 联调提前清理服务器。

## 合并后的上线限制与恢复原则

P3 的数据表、服务端接口和后台管线可以与主分支共同发布，但 **PG 同步、通知生成、渠道发送全部保持默认关闭**。
代码合并不代表已接入实际新华财经/DeepSeek/Hermes，不得启用三个 P3 feature flags，直到渠道授权、真实环境联调与双用户跨日验收完成。

- GP 实体一旦产生任意抓取快照，`entity_id` 和 `entity_role` 即被冻结；核验纠错须新建候选并重新建基线，不得将另一实体历史关系误判为新投资。
- `baseline` 与撤回记录不得直接核准为新增；已核准记录的分类/来源修改不会刷新首次核准时间。
- `member_gp_snapshot_evidence` 保留不可变的每期原始响应（包括不完整快照），`member_gp_review_audit.before_state/after_state` 保留人工核准历史。上线前核实数据保留期限、访问权限与敏感字段。
- 每期通知在读取来源前固定数据截止时间，持久化 `window_end_at`；用户+类型+来源键存入 `member_notification_seen`，同一次事务写入 outbox。额外回扫最多 48 小时的变更来覆盖晚提交事务，旧版发布日期不直接用作增量游标。
- GP 分类每 5 分钟从持久待办选择最多 20 条；失败最多重试 3 次。通知生成按北京时间 09–23 点每小时恢复，若错过正常时点，同一天晚些时候仍可生成当期消息。
- 目前仅识别第一次新增的 **GP－被投企业关系**，不声称监控同一企业的所有后续融资轮次。
