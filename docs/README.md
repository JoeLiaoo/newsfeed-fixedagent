# 文档索引

## 从这里开始

- [项目 README](../README.md)：本地启动、各阶段代码与上线状态。
- [产品需求基线](PLAN.md)：v0.65；需求讨论与确认范围，不代表功能已验收。
- [实施状态](IMPLEMENTATION.md)：P0–P4 唯一任务勾选来源，按对应验收条件完成后才标记 `[x]`。
- [贡献与仓库治理](../CONTRIBUTING.md) / [Agent 开发约定](../AGENTS.md)：分支、PR、设计系统、日志、保密与验证规则。
- [全仓架构与实现审查（2026-10-22）](REPO-REVIEW-2026-10-22.md)：基于 `13a89a5` 的风险、复现证据及建议演进顺序。
- [2026-10-22 审查问题修复记录](logs/2026-10-22-repo-review-remediation.md)：R01–R14 及通知投递复审的实现、验证和剩余边界；[PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 已合并。
- [文档治理更新记录](logs/2026-10-22-repo-docs-governance.md)：文档状态、索引去重及合并后同步规则。

## 阶段文档

| 阶段 | 说明 | 状态依据 |
|---|---|---|
| P0 | [材料、凭据与外部阻碍](P0-STATUS.md) | 待真实凭据及服务器、微信核验 |
| P1 | [实施状态](IMPLEMENTATION.md#p1--账号与资讯) | 代码完成，待真实员工试用 |
| P2 | [专家适配矩阵](P2-EXPERT-ADAPTER.md) | 一层直接投资适配版，真实 MCP／模型尚未联调 |
| P3 | [GP 监测与微信运维手册](P3-OPERATIONS.md) | 基础管线 [PR #4](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/4) 和投递整改 [PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 已合并；三项运行开关默认关闭，外部验收未完成 |
| P4 | [部署与试运行任务](IMPLEMENTATION.md#p4--部署与试运行) | 旧环境备份与可恢复性尚未确认，禁止提前清理 |
| 上游 | [AIHOT 来源、许可证与适配](UPSTREAM.md) | 保留来源归属及边界 |

**注意：** P3 合并的是可供联调的代码链路，不等于微信、新华财经和 DeepSeek 已在真实环境验证。P3-01～P3-04 的任务仍保持未完成，详情以实施状态表为准。

## 实施日志

日志位于 [`logs/`](logs/)，命名为 `YYYY-MM-DD-任务ID.md`，模板见 [`logs/TEMPLATE.md`](logs/TEMPLATE.md)。

- [仓库治理初版](logs/2026-10-21-repo-governance.md)；[2026-10-22 治理与文档同步](logs/2026-10-22-repository-governance.md)
- [P0 建立约定](logs/2026-10-21-P0-00.md)；[P0 预核与访问阻碍](logs/2026-10-21-P0-03-04-precheck.md)；[P0 凭据相关记录](logs/2026-10-21-P0-credentials.md)；[P0 云环境记录](logs/2026-10-21-P0-cloud-credentials.md)
- [P1 平台](logs/2026-10-21-P1-platform.md)；[PR #1 Review](logs/2026-10-21-PR1-review.md)；[P1/P2 UI](logs/2026-10-21-P1-P2-ui.md)
- [P2 专家](logs/2026-10-21-P2-expert.md)
- [P3 实施、Review 整改与剩余阻碍](logs/2026-10-22-P3-implementation.md)
- [全仓架构与实现审查日志](logs/2026-10-22-repo-review.md)
- [全仓审查问题修复日志](logs/2026-10-22-repo-review-remediation.md)
- [文档治理更新日志](logs/2026-10-22-repo-docs-governance.md)

状态表记录任务验收，日志记录代码、验证证据和未完成事项；如有冲突，以明确的验收标准为准并立即修正文档。
