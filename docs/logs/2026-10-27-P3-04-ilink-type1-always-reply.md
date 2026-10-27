# 2026-10-27 · P3-04 iLink inbound type=1 与必回帮助修复

- 任务：P3-04 的入站解析热修与员工微信回复体验维护；P3-04 的真实双员工、跨日、GP 与手机端业务验收未完成，保持 `[ ]`。
- 状态：本分支待 PR 评审；未部署、未合并、未 SSH 生产。

## 做了什么与文件

- `modules/membership/notifications/ilink.ts` 的文字入站只接受绑定员工发往其 Bot 的 `message_type=1`、`message_state=2` 消息，出站仍为 type 2；渠道恢复用的上下文与首次入站确认另按方向接受无类型信封（context-only）。数字 ID 接受有限值并截为整数字符串，`message_id` 缺失时回退 `seq`、`client_id`。
- `modules/membership/conversation/{help,replies,agent-worker,authorization}.ts` 按阅读、知识库、专家任务、Agent 开关及有效员工 grant 生成帮助与兜底提示。空消息、过长消息直接获得提示；有效自由文本继续进入 Hermes 队列。与已合并的 WX-C2 专家路由集成时沿用其授权核查。
- 更新 `modules/membership/tests/{ilink-protocol.standalone,wx-help.standalone,wx-reading,wx-knowledge,wx-experts}.test.ts` 的现场形状、出站反例、帮助开关和近似 KB 指令覆盖；同步 `docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P3-OPERATIONS.md`、`docs/README.md`、根 README 与员工端待发布变更条目。

## 关键决定与风险

- 现场 type 1 是用户入站，type 2 是 Bot 出站；不接受两者混用。JSON number 超过 `Number.MAX_SAFE_INTEGER` 时解析可能已失去低位，ID 字符串用于幂等去重，不能声称仍保留上游原始精度。
- 帮助仅显示员工当前有权使用的能力。知识库须 KB、阅读、Agent、投递、模型开关与有效 grant；专家须专家开关、阅读、投递与有效 grant；自由聊须 Agent、投递、模型开关与有效 grant。现有阅读 → KB → 专家 → Agent 路由不变。
- 代码层保证已解析、在有效绑定和回复开关下的消息生成对应回复或队列任务；iLink `accepted`、渠道窗口和手机送达仍须真实验收，不能把本地合成验证写成逐条手机送达保证。

## PR #160 CI 修复（postgres-integration 两项失败）

- 失败：`modules/membership/tests/ilink-binding.test.ts` 断言 `recovered===2` 失败、`modules/membership/tests/ilink-scan.test.ts:303` 断言 `recovered/greeted===1` 失败。原因是 `pollIlinkInbox` 把 `hadInbound` 与 `contextToken` 一并收紧到 `message_type=1` 且 `message_state=2`，而现场 context-only 信封（只有 `from_user_id`、`to_user_id`、`context_token`）不带类型与状态，渠道恢复与首条入站确认因此不再触发。
- 修复：`pollIlinkInbox` 的 `hadInbound` 恢复为“绑定员工发往本 Bot 的任意消息”，`contextToken` 恢复为“同方向消息中最新的非空 `context_token`”，类型与状态筛选仍只留在 `parseIlinkInbound`；type 2 是 Bot 出站形状，不覆盖员工上下文，只有在没有任何其它同方向消息时才作为兜底。
- 未验证：未重新调用生产 iLink；未核手机端投递、会话窗口、跨日或 GP 业务。

## 最小验证

- `npm run typecheck`：通过。
- 协议、帮助、WX-B 与 WX-C2 standalone：7/7 通过；现场形状含 type 1、state 2、知识库文字和 19 位 JSON number，type 2 不作为入站。
- 隔离 PostgreSQL 17 的 `wx-reading`、`wx-agent`、`wx-knowledge`、`wx-experts`：4/4 通过；覆盖 KB／专家 flag 开关、帮助文本、近似 KB 指令和原有队列隔离。
- `node scripts/check-doc-links.ts`：586 条本地链接通过；`git diff --check`：通过。员工更新条目按仓库流程保留在 `pending/`，因此 `npm run changelog:check` 会在归档／构建前提示尚未应用，本 PR 不执行发布应用步骤。
- CI 修复后：本地 PostgreSQL 16 上的 `ilink-binding`、`ilink-scan` 5/5 通过（修复前 2 项失败）；CI 的 postgres-integration 文件清单 41/41 通过，standalone 清单 192/192 通过；`npm run typecheck` 通过。

## 未验证事项与下一步

未重新调用生产 iLink；未核手机端投递、会话窗口、跨日或 GP 业务。PR 评审后按 P3 运维闸门安排发布和 Joe 手机端复测，P3-04 继续未勾选。
