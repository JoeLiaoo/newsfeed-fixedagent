# WX-C2 微信专家任务 · 2026-10-27

任务：外部方案 §7.1–7.2、§7.4–7.6、§8 的 WX-C2；P3-04 仍未完成真实业务验收。本分支只施工，不部署、不合并、不更改生产开关。

## 实施

- `experts/service.ts` 提供 web／iLink 受信 actor、active／grant／绑定复核、available 目录、本人任务读取、创建准入与幂等内容冲突检查、确认主体及取消。网页创建、详情、确认、取消改用共用服务；保留自定义专家及原网页任务额度。微信创建和 watch 在同一事务。
- `conversation/experts.ts` 采用确定性有限语法，不额外调用 Hermes。五种动作：列专家、创建、状态、候选确认、取消；状态动作支持明确停止提醒。首批只允许全景、同业、播客。未命中仍走既有 A／C1／B 路由。
- `conversation/task-events.ts` 每分钟补扫本人 watch，按任务状态版本入事件表和回复 outbox；发送前复核授权、绑定版本和 watch。`task-summary.ts` 只用 worker 写入的有界结构化摘要，拒绝把 HTML 结果直接发微信。成功不等于全量覆盖。
- `0212`–`0217` 迁移增加输入哈希、watch、事件和回复关联；新增默认关闭的 `P3_ILINK_EXPERTS_ENABLED`。修改 `.env.example`、README、P2/P3 运维文档、实施状态、文档索引和待发布员工 changelog。

## 验证与边界

- `npm run typecheck` 通过。
- 临时 PostgreSQL 的 `wx-experts.test.ts`、`experts-access.test.ts`、`expert-admission-stages.test.ts`、`wx-knowledge.test.ts`、`wx-reading.test.ts`、`wx-agent.test.ts` 共 7 个用例通过；`wx-experts.standalone.test.ts` 通过。覆盖关开关、重放一次创建、两员工归属、候选真实 ID、裸数字不确认、额度、取消、恢复扫描去重、停止提醒与撤权后无新事件、网页旧行为。
- `node scripts/check-migrations.ts --base b2f1b42057f5bcdb8ea0230438f3544ca3da0808` 与 `node scripts/check-doc-links.ts` 通过。全部使用合成 fixture，无生产凭据。
- 未验证：真实微信收件与跨日窗口、真实全景候选和报告质量、供应商持续可用性、线上队列容量。需要人工在灰度环境按 P3 手册复核，P3-04 仍 `[ ]`。

下一步：PR 评审；发布时按顺序应用迁移，人工确认授权与开关，随后两员工真机验收。回退先关闭 C2 开关，保留任务与 outbox 记录。
