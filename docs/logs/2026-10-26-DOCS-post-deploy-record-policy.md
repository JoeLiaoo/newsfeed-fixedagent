# 2026-10-26 · DOCS：生产发布记录规则调整

- 任务：落实 2026-10-26 决定，取消每次生产部署后单开记录型 Docs PR 或仓库部署日志的要求；本项为仓库治理维护，不改变 P0～P5 的业务验收勾选。

## 修改与决定

- `AGENTS.md` 明确：生产当前 release SHA 以服务器 `/api/health` 和部署结果文件为准；部署结果可留在仓库外的本地/Mac 文件或简短聊天消息；不因一次发布新增 `docs/logs/` 或 record-only Docs PR。开发任务日志和实际运维、业务验收要求仍适用。
- `CONTRIBUTING.md` 同步贡献者的日志与合并后状态同步规则；`docs/DEPLOY-VOLCENGINE.md` 将“发布日志”改为仓库外结果文件或聊天说明。
- `docs/README.md` 增加本次治理工作索引。`docs/PLAN.md` 与 `docs/IMPLEMENTATION.md` 没有逐次发布后开 Docs PR 的要求，且本次不改变产品范围或验收状态，故未修改。
- 保留所有历史部署日志；本日志只记录本次规则修改，不是一次生产发布的记录。

## 验证、风险与下一步

- `node scripts/check-doc-links.ts`：通过，511 个本地 Markdown 链接有效。
- `git diff --check`：通过。
- 未执行应用测试或生产部署；本次只有文档变更。由 PR 评审核对文字，再合并生效。
