# P3 GP 监测与微信联调

## 当前状态与启用权限

截至 2026-10-22，P3 基础管线经 [PR #4](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/4) 合并，审查整改和通知分片／并发投递修复经 [PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 合并；PR #6 的[质量及 PostgreSQL 17 集成 CI](https://github.com/JoeLiaoo/newsfeed-fixedagent/actions/runs/39697739947) 成功。Hermes Weixin/iLink 独立网关和平台网页绑定 bridge 已部署到火山云；私聊使用配对审批、群聊关闭。bridge 已通过本机端口与鉴权冒烟检查，实际新华财经 MCP、DeepSeek 持续业务链路、员工微信绑定及两名用户跨日送达仍未验收，P3-01～P3-04 **仍保持未完成**。部署证据见[bridge 日志](logs/2026-10-22-P3-wechat-flow.md)。

部署包含代码和迁移 **不等于允许激活**。未取得供应商接口及数据展示/转发授权、完成业务核对、微信 sidecar 联调和两名用户连续三天试投前，三个 `P3_*_ENABLED` 必须保持 `false`。部署与试运行还受 P4 的新平台备份和恢复运维要求约束；旧版 `ai-work-mvp` 已归档留存，不要求旧版恢复演练。

## 安全启动

运行 npm run member:seed-gp（在数据库迁移后）导入候选。初始 9 个候选主体来自 `reference/母基金已投子基金管理人.md`，均为 `candidate`，不自动认定基金管理人等于直接投资 GP。在 `/settings/admin-gps` 确认主体名称、唯一实体 ID、GP/管理人/基金角色及公开证据后，才允许启用监测。首次完整快照作为历史基线；以后新增的投资关系标为 `observed`，不能凭新华财经入库日期或更新时间判定为“当日投资”。管理员提供**独立事实证据 URL + 真实事件日期 + 赛道**后，才可标记为 `verified`，进入每日 GP 汇总。

三个功能开关默认关闭：`P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`。逐项确认外部联调后再开启，避免未核验的数据触发通知。模型 `MODEL_CALLS_ENABLED=true` 时可建议四大产业细分赛道，结果仅供管理员复核；不允许战略配售标签参与 GP 匹配。

## 员工扫码绑定与聊天

只有平台 `active` 状态（管理员已批准注册）的账号可以打开微信通知页和发起绑定。页面从 API 读取管理员配置的 `P3_HERMES_BOT_CONTACT_QR_URL` 并显示联系人二维码；该变量必须指向员工可用的 Hermes **机器人联系人二维码图片 HTTPS 地址**。只有管理员从 iLink 服务取得并核验了真正可供其他用户添加/联系 bot 的二维码后才能配置。锁定版本的 [Hermes 官方文档](https://github.com/NousResearch/hermes-agent/blob/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1/website/docs/user-guide/messaging/weixin.md)明确区分：`hermes gateway setup` 的扫码是把一个 iLink bot 身份连接到网关，其他员工不能扫描这张登录码来添加 bot；他们须在微信中主动联系已连接的 bot/contact。官方资料尚未证明当前 iLink 账号可生成可分享的 bot 联系二维码，因此此能力须在真实账号确认后配置。未配置或地址无效时页面明确提示二维码尚未配置，不展示登录二维码。

微信绑定与聊天权限彼此独立。用户从可用的 bot 联系入口进入微信后，在网页生成 10 分钟绑定码并发送；Hermes 入站桥必须在 pairing 管理员审批门之前识别绑定码，向平台核实，并只完成当前已批准网站账号的绑定，不触发普通 Agent 对话或工具。用户回网页确认后即可接收个人推送，不必等待聊天审批。绑定码必须由当前已登录网页账号生成，且从 Hermes 真实入站事件提取收件人身份；**扫码本身不会自动识别或绑定网页账号**。普通微信私聊仍按 `WEIXIN_DM_POLICY=pairing`，由管理员另行批准后才交给 Hermes Agent 处理。退订和解绑立即撤销对应推送授权。

新用户的 `member_notification_settings` 默认值为 `news_enabled=true`、`gp_enabled=true`、`paused_until=null`；两类推送在首次绑定后默认开启。员工可以在网页分别关闭，重新绑定不得重置已有偏好。此开关表示允许按已关注赛道推送，不代表已获得 Hermes 普通私聊权限。

接入前要求员工入口能让用户联系当前 bot；用户绑定事件在未获普通聊天审批时仍可被安全桥接识别；聊天获批前不能触发 Agent；推送只发给有效绑定且未退订的账号。二维码轮换或失效时由管理员更新服务端配置，不把二维码写入仓库或公开日志。

## Hermes 桥接层合同（已部署，尚待真实微信验收）

Hermes [官方 Weixin/iLink 适配器](https://github.com/NousResearch/hermes-agent/blob/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1/website/docs/user-guide/messaging/weixin.md)提供网关机器人身份登录、长轮询、私聊和定向主动发送；官方文档没有说明该登录二维码也能作为员工共享的 bot 联系二维码。[cron 定向目标](https://github.com/NousResearch/hermes-agent/blob/ebc9960b9d42e11e35ddbb6f0918cc163f739eb1/website/docs/developer-guide/cron-internals.md)可写为 `weixin:<wxid>`。平台 bridge 负责把网页用户、兴趣偏好和持久化 outbox 接到 Hermes；它不是另一套微信协议网关，也不要求额外购买云服务器。

Hermes 端只启动一个 Weixin/iLink 网关。在 DM pairing 策略中，bridge 必须能先于普通 Agent admission 收到未获聊天批准的绑定挑战；从真实渠道事件提取收件人 ID 和机器人账号 ID后调用平台 claim。挑战处理不得授予普通聊天权限，不得信任网页登录传入的收件人。只有独立的 Hermes 管理员 pairing 批准才允许普通聊天。平台负责业务用户、偏好与消息 outbox，Hermes 只负责渠道收发。

**入站确认**：用户先在 `/settings/notifications` 获取 10 分钟有效的随机绑定码，私聊机器人发送。可信的 Hermes 适配器请求：

- URL：`POST /api/v1/membership/bridge/claim`
- JSON：`{"code":"绑定码","recipientId":"网关收件人 ID","channelAccountId":"机器人账号 ID"}`
- Headers：`x-p3-timestamp` 为 Unix 毫秒；`x-p3-nonce` 为至少 16 位的一次性随机串；`x-p3-signature` 为十六进制小写 HMAC-SHA256。
- 待签名字符串由 timestamp、nonce、code、recipientId、channelAccountId 按顺序用真实换行符连接，密钥为双方配置的 `P3_BINDING_HMAC_SECRET`（至少 32 字符）。

服务端校验签名、时间漂移、nonce 重放、绑定码和过期状态；只存绑定码哈希。网页用户再点击确认绑定。一个微信收件人不能同时绑定多个网页账号。

**出站发送**：平台 worker 通过固定地址 `P3_HERMES_BRIDGE_URL` 向运行在 Hermes 网关进程内的插件发送请求；生产环境使用 `host.docker.internal` 映射到 Docker host gateway，仅 worker 容器配置此映射，并使用 `P3_HERMES_BRIDGE_TOKEN` 作为 Bearer 授权。body 为 `{"recipientId":"...","channelAccountId":"...","text":"...","idempotencyKey":"outbox-id"}`，HTTP header `x-idempotency-key` 同步携带该 ID。bridge 持久化幂等键并调用 Hermes 原生 Weixin 适配器；渠道受理后返回 2xx JSON `{"accepted":true,"messageId":"渠道消息 ID"}`，会话过期返回 410，模糊失败返回 503。平台仅把 `accepted` 当作接口受理，不代表已送达；超时或模糊故障转 `unknown`，不盲目重发。

**注意：** 上述是平台自定义的插件协议，并非 Hermes 官方 HTTP API。插件源码位于 `deploy/hermes-citic-bridge/`，生产副本位于 Hermes home 的 `plugins/citic-weixin-bridge/`；通过官方插件 hook 在普通聊天审批前消费绑定码，出站复用原生 Weixin 适配器，不另行实现 iLink 协议。生产配置使用 `deploy/configure-p3-bridge.py` 建立两端相同的随机凭据并备份原环境文件。三个 P3 运行开关仍为 `false`，真实网页绑定和微信投递仍须联调。

当前生产发布目录为 `/opt/citic-newsfeed/releases/d7f515e-p3wechat-20261022`；Hermes 插件须放入 `/opt/hermes-agent/home/plugins/citic-weixin-bridge/`、归属 `hermes` 用户并通过 `hermes plugins enable citic-weixin-bridge` 启用。检查 `hermes-agent-gateway.service` 正常运行、bridge 端口仅绑定 Docker host gateway；从 worker 发起不带 token 的请求应得到 401，平台 claim 不带签名应得到 403。环境文件备份保存在原目录的 `.before-p3-时间戳` 文件中。若桥接异常，先保持或恢复三个 P3 开关为 `false`，再禁用插件并重启 Hermes；网站容器可从上一发布目录用同一 Compose 项目名回退。不得删除数据库卷或其他项目。

## 日历与调度

平台 worker 北京时间每小时轮询经核准的 GP（仅开启后），每天按工作日资讯 09:00 / GP 10:00、休息日资讯 11:00 / GP 12:00 分别生成两类消息，按用户兴趣过滤并去重，超长正文按 1600 字符上限分片发送，空内容仍发“今日无更新”。outbox 为每个来源片段保存原文偏移；重验只更新并恢复该片段，不会将整条长资讯重复写入每个分片。每 5 分钟领取 outbox 发送。首次推送从绑定时刻起算；不补发历史基线。

必须由运维根据官方节假日、补班表设置 `P3_CN_HOLIDAYS` 和 `P3_CN_MAKEUP_WORKDAYS`（均为半角逗号分隔 YYYY-MM-DD）。若未配置，系统只能识别通常周末，不能准确覆盖国家法定假期。

## 验收清单

1. 真实新华财经：主体唯一 ID 核实、完整分页/上限及数据授权；至少一组已知 GP 关系快照复查。
2. 真实 DeepSeek：四类细分赛道准确率、低证据时空分类、费用、限流及人工修订。
3. 两个经管理员批准注册的平台账号：都可进入绑定页并绑定不同微信收件人；不批准 Hermes pairing 时仍能收到各自默认开启的赛道推送，但普通聊天不可用；只有单独批准 pairing 后才能聊天。选择不同兴趣后只收到各自匹配内容；退订/解绑即时生效。至少连续 3 天跨日主动投递，包含普通日和可核验的休息日。
4. 渠道故障：401/410、429、超时、accepted 与未知回执；检查是否会重复投递或越权读取。
5. P3 联调前确认不触碰旧版归档及服务器其他服务；旧版本无备份恢复前置要求。新平台正式运行仍按 P4 完成自身备份恢复方案。

## 合并后的上线限制与恢复原则

P3 的数据表、服务端接口和后台管线可以与主分支共同发布，但 **PG 同步、通知生成、渠道发送全部保持默认关闭**。
代码合并不代表已接入实际新华财经/DeepSeek/Hermes，不得启用三个 P3 feature flags，直到渠道授权、真实环境联调与双用户跨日验收完成。

- GP 实体一旦产生任意抓取快照，`entity_id` 和 `entity_role` 即被冻结；核验纠错须新建候选并重新建基线，不得将另一实体历史关系误判为新投资。
- `baseline` 与撤回记录不得直接核准为新增；已核准记录的分类/来源修改不会刷新首次核准时间。
- `member_gp_snapshot_evidence` 保留不可变的每期原始响应（包括不完整快照），`member_gp_review_audit.before_state/after_state` 保留人工核准历史。上线前核实数据保留期限、访问权限与敏感字段。
- 专家任务、产物和模型回执按业务用户及任务关联；七天任务到期清理会删除产物与模型回答正文，并保留用量、费用和哈希审计字段。
- 网页和新闻通知共用同一用户/日期日报版次、截止时间、偏好版本及来源集合。每期 outbox 持久化截止点和来源片段关系；发送前按当前新闻可见状态、GP 核验状态和用户兴趣重新核查，并在 1600 字符上限内更新文本。来源撤回时取消对应消息并释放未发送的去重预占。
- 通知设置原样保存不改变版次或待发消息；新闻与 GP 使用各自订阅版次，暂停、退订和绑定变更会取消相应的 `pending`、`failed`、`sending` 记录并释放来源预占。发送器在重验后再次检查用户、绑定和订阅版本，并通过与退订／解绑共用的用户事务锁串行化最终检查和桥接请求；请求已开始后，设置变更会等待该请求结束。用户+类型+来源键及 outbox 关联在同一事务写入；额外回扫最多 48 小时的变更来覆盖晚提交事务，旧版发布日期不直接用作增量游标。
- GP 分类每 5 分钟从持久待办选择最多 20 条；失败最多重试 3 次。通知生成按北京时间 09–23 点每小时恢复，若错过正常时点，同一天晚些时候仍可生成当期消息。
- 专家任务崩溃恢复在同一数据库事务内更新任务并写入 pg-boss 队列；最多执行三次，超过上限进入失败终态。
- 目前仅识别第一次新增的 **GP－被投企业关系**，不声称监控同一企业的所有后续融资轮次。

## 运维检查与失败处置（未来启用时）

1. **准备环境：** 先取得服务器所有人的备份与恢复确认，执行只读盘点；核对数据库迁移 `0116`–`0151`、用户权限、加密传输、后台登录、日志脱敏，以及 `.env` 中三个开关仍是 `false`。不要将任何密钥、绑定码、真实用户的原始响应贴入 PR 或公开日志。
2. **核准 GP：** 执行 `npm run member:seed-gp`（在迁移之后）；管理员进入 `/settings/admin-gps`，逐一核对 9 个候选角色、唯一 ID 和证据，并仅对真实 GP 设为 `active`。身份产生快照后即冻结，纠错需创建新主体并重新建立基线。检查完整/不完整快照及不可变证据，确认首次完整快照均为 `baseline`。
3. **核准事件：** 校验投资关系真实发生日期、独立 HTTPS 来源与赛道；`observed → verified` 必须由管理员完成。重复调整不会生成新的首次核准事件；`baseline`、`retracted` 不能升级为新增。AI 分类是建议，不是事实证明。本系统当前仅跟踪首次发现的 GP→企业关系，不跟踪同一家企业每一轮追加融资。
4. **联调微信：** 在取得个人同意及官方渠道授权后，使用已部署的 Hermes 插件核验绑定码 HMAC、nonce、收件人身份与桥接幂等键。先确认可供员工联系 bot 的入口；分别由两个测试用户绑定、选择不同兴趣、开启独立订阅，跨普通日和休息日连续三天核对定向性及撤销权限。**`accepted` 只表示桥接侧已受理，不能作为微信实际送达证据。**
5. **分阶段激活：** 服务商主体及快照验收后，才考虑打开 `P3_GP_SYNC_ENABLED`；人工核准与内容核验后再试运行 `P3_NOTIFICATIONS_ENABLED` 生成 outbox；只有真实 sidecar 的幂等协议和两个用户收件人验证完成，才考虑打开 `P3_DELIVERY_ENABLED`。每阶段先检查数据库记录和健康状态，再进入下一阶段。
6. **故障与回退：** 任一环节出现错收件人、重复发送、未授权数据、异常大量新增或不明送达结果，应立刻关停 `P3_DELIVERY_ENABLED`，必要时同步关闭另外两个开关；保留审计、outbox 与快照供复核，不盲目重发 `unknown`，也不删除数据库表。收件会话失效（410 / `requires_rebind`）走重新绑定；限流（429）按受控重试检查。

通知采用固定读取截止时间、48 小时回扫与用户级去重；这 **不保证** 任意长期延迟的历史数据都能自动补送。生成任务只在同一北京时间自然日内迟到恢复，跨日断服务需人工核对并决定是否补发。中国法定节假日和调休表必须按官方日历维护，未配置不能声称节假日时刻准确。生产验证前，保留 P3 四项未完成状态。
