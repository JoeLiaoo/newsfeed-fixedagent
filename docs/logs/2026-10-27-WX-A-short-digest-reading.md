# 2026-10-27 · WX-A 微信短摘要与阅读追问

- 对应任务：P3-04 中的 WX-A 代码阶段；P3-04 真实微信业务验收仍为 `[ ]`。
- 状态：本分支实现并完成本地合成测试；未部署、未合并、未使用生产凭据。

## 做了什么

- `notifications/presentation.ts` 从网页完整日报快照按 `timeline_at` 倒序、`source_key` 稳定排序取前三条，用既有标题和摘要渲染至多 700 个 UTF-16 code units 的微信首推；不增加 LLM/MCP 调用。
- `notifications/outbox.ts` 同时修改生成和发送前重验。紧凑版次保存日期、偏好版本、总数和展示来源映射；只预占实际展示的来源。撤回时移除展示项，全部撤回取消发送；被 iLink/受控桥接接受后才更新员工最近展示版次。GP 及开关关闭时的新闻继续旧分片路径，网页日报不变。
- `notifications/ilink.ts` 解析上游可靠消息 ID、顺序、文本，排除 Bot 回声、非私聊和未完成片段；非文本只给一次文字能力提示，不抓取媒体。不安全的数值 ID 不参与去重。`notifications/inbox.ts` 在 cursor 同一事务内按 Bot 与上游 ID 去重并入独立 pg-boss 队列；开关关闭时记录为 ignored，仍保留原有连接确认行为。
- `conversation/{intent,queue,replies}.ts` 将“深读 N／其他／全部／下一页／主题：…”路由到员工实际接受的版次。详情、目录和主题列表再次检查当前来源可见性和兴趣；未匹配自由文本返回可执行帮助。回复存独立 outbox，入站后立即发送；`P3_DELIVERY_ENABLED` 仍是总闸。回复到期、限流、未知发送结果、窗口失效、解绑及重绑都有明确状态。入站与回复正文最多保留七天，消息 ID 保留三十天供延迟去重。
- 新增 `0197`–`0202` 六个在线迁移，以及 `.env.example`、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P3-OPERATIONS.md`、README/索引和员工端待发布更新条目。PLAN 将旧新闻全文主动分片要求改为短摘要；GP 完整汇总要求不变。

## 关键决定与回退

- `P3_NEWS_COMPACT_ENABLED=false`、`P3_ILINK_READING_REPLIES_ENABLED=false` 均默认关闭。两者打开且总发送闸开启时显示并处理追问。只开紧凑格式时不展示不可用的追问。回退先关闭阅读开关，再关闭紧凑开关；已接受的短版次及去重审计保留，不重发成全文。
- 回复使用单独业务队列和回复 outbox，发送前与通知发送器共用用户级事务锁及绑定版本核验；轮询账号行锁事务只做入站保存、cursor 和入队，不执行阅读查询或发送。
- 通知 `accepted` 仅代表渠道受理，不能证明手机收件或阅读。iLink 请求超时／不明结果为 `unknown`，不自动重发。

## 最小验证

- `npm run typecheck`：通过。
- `node scripts/check-migrations.ts --base=origin/main`：通过。
- 针对性 standalone：`ilink-protocol`、`notifications-core`、`ilink-keepalive` 共 11/11 通过，覆盖百条长新闻一条短摘要、稳定排序、入站过滤、近失效提醒和旧分片。
- 隔离 PostgreSQL 17 测试库运行 `wx-reading.test.ts`、`notifications-access.test.ts`、`ilink-binding.test.ts`：3/3 通过，覆盖短版次生成与重验、网页完整数据、实际接受版次编号、重复入站、两员工隔离、重绑旧回复取消、旧行为及扫码绑定。iLink 和 bridge 均为合成 fixture。
- `node scripts/check-doc-links.ts`、`git diff --check`：通过。
- `npm run changelog:check`：按仓库待发布流程预期提示 `wx-a-short-digest.json` 尚未应用；功能 PR 保留该文件，发布负责人构建前应用。

## 未验证事项与风险

- 未在真实微信或生产环境测试；iLink 上游消息形状、窗口、限流与实际手机到达仍须用双员工、跨日和异常恢复验证。可靠 ID 缺失的入站被跳过，不能据此称所有微信消息已处理。
- 上游 `accepted` 之后来源若撤回，已发送的摘要无法收回；后续“深读”会拒绝提供已撤回内容。网页完整日报保持其既有快照语义。
- 现有入站轮询至多每轮 20 个账号、五并发和 39 秒网络等待；本阶段回复不等五分钟通知调度，但约 20 人的轮询等待仍须真实容量测量。Phase B 再评估公平轮转与并发。
- Phase B 的 Hermes CLI、聊天授权和成本边界，以及 Phase C 的知识库／专家微信动作均未实现。GP 主体、事件、跨日及业务真实验收未完成，P3-04 保持未勾选。

## 下一步

PR 评审与迁移审核 → 按运维闸门发布并启用开关 → Joe 使用两名员工的真实微信核对消息形状、短摘要、深读版次、限流、解绑／重绑和跨日恢复；再决定是否进入 B/C。
