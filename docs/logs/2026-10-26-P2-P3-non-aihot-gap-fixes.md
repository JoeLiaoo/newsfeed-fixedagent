# 2026-10-26 · 非 AIHOT 会员路径缺口维护

- Agent：Codex
- 对应任务：P2-03／P2-05 与 P3-03 的代码维护；不改变真实业务验收勾选。
- 完成状态：代码与本地验证完成；PR、发布和真实员工验收另行记录。

## 本次改动

- 修改文件：`modules/membership/experts/routes.ts`、`worker.ts`、`modules/membership/notifications/outbox.ts`、`packages/backend/src/providers/receipts.ts`、三个会员集成测试、`AGENTS.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/P3-OPERATIONS.md`、`docs/README.md` 及本日志。
- 目录按八项平台工具优先判断 `xinhua_panorama`，再按三项基础工具判断 `xinhua_trial`；与导入响应、任务提交和 worker 分支一致。隐藏的旧内置入口不变。
- 成功任务在写入产物的同一事务中把任务到期时间延至产物到期时间。旧任务读取时取任务与产物到期时间的较晚者，清理时不级联删除仍有效的产物；材料仍按上传后七天清理，模型响应正文按任务创建后七天脱敏。尝试在发布迁移中直接回填旧任务曾触发仓库的在线迁移安全门禁，最终采用读取与清理兼容路径，没有新增迁移。
- GP 通知生成和发送前重验都使用员工清单现有的 `employeeSource` 规则，演示域名不再作为可核对 URL 发送；同时与员工清单对齐有效 GP 和排除战略配售的过滤条件。来源仍须管理员独立核实。
- 更新当前三项可运行内置专家与需求版本说明；旧实施段落保留为历史记录。

## 最小验证

- `npm run typecheck`：通过。
- 四个定向 PostgreSQL 集成文件：4/4 通过，覆盖八工具目录、完成任务产物到期、旧任务有效产物、GP 演示地址的生成与重验，以及项目清单可见范围。
- `node scripts/check-doc-links.ts`：522 个本地 Markdown 链接有效；`git diff --check`：通过。
- 未运行全量测试、真实新华财经/模型/iLink 调用或生产部署；真实 GP 事件、产物质量、跨日投递及手机端效果仍待用户验收。

## 风险与交接

- 已经被旧清理级联删除的产物无法恢复；此改动保护仍在库中的产物与后续新产物。
- 任务成功后，任务记录可能保留至创建后十四天以内，以保证后生成的产物有完整七天；材料与模型响应仍各自按七天规则处理。
- PR 评审及 CI 通过后可合并；发布须遵守现有运维闸门。本次不部署，不改变 P2-05、P3-01～P3-04 或其他真实业务验收状态。
