# 文档索引

## 从这里开始

- [项目 README](../README.md)：本地启动、各阶段代码与上线状态。
- [产品需求基线](PLAN.md)：v0.65；需求讨论与确认范围，不代表功能已验收。
- [实施状态](IMPLEMENTATION.md)：P0–P4 唯一任务勾选来源，按对应验收条件完成后才标记 `[x]`。
- [P0 DeepSeek／新华财经配置与字段矩阵](P0-DATA-MATRIX.md)：服务端凭据边界、接口静态 schema、GP 标准事件时间语义和真实联调缺口。
- [P0 上游基线、接口边界与施工顺序](P0-05-BASELINE.md)：锁定 AIHOT/Hermes 版本与许可，说明产品接口合同、代码目录和迁移顺序。
- [P0-03/P0-04 外部验收手册](P0-03-04-OPERATIONS.md)：微信双用户跨日试投和 `ai-work` 只读盘点步骤；[PR #10](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/10) 已合并（`2cc14c3`），真实验收仍待完成。
- [贡献与仓库治理](../CONTRIBUTING.md) / [Agent 开发约定](../AGENTS.md)：分支、PR、设计系统、日志、保密与验证规则。
- [全仓架构与实现审查（2026-10-22）](REPO-REVIEW-2026-10-22.md)：基于 `13a89a5` 的风险、复现证据及建议演进顺序。
- [2026-10-22 审查问题修复记录](logs/2026-10-22-repo-review-remediation.md)：R01–R14 及通知投递复审的实现、验证和剩余边界；[PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 已合并。
- [文档治理更新记录](logs/2026-10-22-repo-docs-governance.md)：文档状态、索引去重及合并后同步规则；[PR #7](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/7) 已合并（`409a2a7`）。

## 阶段文档

| 阶段 | 说明 | 状态依据 |
|---|---|---|
| P0 | [材料、凭据与外部阻碍](P0-STATUS.md) | DeepSeek/Xinhua 已抽测；微信双用户与剩余服务边界待核验 |
| P1 | [实施状态](IMPLEMENTATION.md#p1--账号与资讯) | 代码完成，待真实员工试用 |
| P2 | [专家适配矩阵](P2-EXPERT-ADAPTER.md) | 一层直接投资适配版，真实 MCP／模型尚未联调 |
| P3 | [GP 监测与微信运维手册](P3-OPERATIONS.md) | 基础管线 [PR #4](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/4) 和投递整改 [PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 已合并；三项运行开关默认关闭，外部验收未完成 |
| P4 | [部署与试运行任务](IMPLEMENTATION.md#p4--部署与试运行) | 新平台 HTTPS 入口已切换，旧版本归档已完成（用户确认无需旧版异地备份/恢复演练）；新平台运维、旧组件处置和员工试用待完成 |
| 上游 | [AIHOT 来源、许可证与适配](UPSTREAM.md) | 保留来源归属及边界 |

**注意：** P3 合并的是可供联调的代码链路，不等于微信、新华财经和 DeepSeek 已在真实环境验证。P3-01～P3-04 的任务仍保持未完成，详情以实施状态表为准。

## 实施日志

日志位于 [`logs/`](logs/)，命名为 `YYYY-MM-DD-任务ID.md`，模板见 [`logs/TEMPLATE.md`](logs/TEMPLATE.md)。

- [仓库治理初版](logs/2026-10-21-repo-governance.md)；[2026-10-22 治理与文档同步](logs/2026-10-22-repository-governance.md)
- [P0 建立约定](logs/2026-10-21-P0-00.md)；[P0 预核与访问阻碍](logs/2026-10-21-P0-03-04-precheck.md)；[P0-03/P0-04 本轮状态](logs/2026-10-22-P0-03-04.md)；[P0 凭据相关记录](logs/2026-10-21-P0-credentials.md)；[P0 云环境记录](logs/2026-10-21-P0-cloud-credentials.md)
- [P0-01/P0-02 配置与数据字段对照](logs/2026-10-22-P0-01-02.md)
- [P0 DeepSeek／新华财经 MCP 实际连通抽测](logs/2026-10-22-P0-live-providers.md)
- [P1 平台](logs/2026-10-21-P1-platform.md)；[PR #1 Review](logs/2026-10-21-PR1-review.md)；[P1/P2 UI](logs/2026-10-21-P1-P2-ui.md)
- [P1 其他方向示范信源](logs/2026-10-22-P1-04-direction-sources.md)：新能源、新材料、先进制造与战略配售的公开 RSS 补充及线上采集核验。
- [P1 员工信源入口改进](logs/2026-10-22-P1-04-source-entry.md)：在主导航与关注赛道页增加员工添加公开信源的直达入口。
- [P2 专家](logs/2026-10-21-P2-expert.md)
- [P3 实施、Review 整改与剩余阻碍](logs/2026-10-22-P3-implementation.md)
- [全仓架构与实现审查日志](logs/2026-10-22-repo-review.md)
- [全仓审查问题修复日志](logs/2026-10-22-repo-review-remediation.md)
- [文档治理更新日志](logs/2026-10-22-repo-docs-governance.md)

状态表记录任务验收，日志记录代码、验证证据和未完成事项；如有冲突，以明确的验收标准为准并立即修正文档。

- [火山云部署准备清单](DEPLOY-VOLCENGINE.md)：复用 ai-work 的只读盘点、隔离预部署、入口切换与回退步骤。
- [P4 火山云部署准备日志](logs/2026-10-22-P4-volcengine-prep.md)。
- [P4 火山云隔离预部署日志](logs/2026-10-22-P4-volcengine-deploy.md)：独立 Compose 部署与启动检查。
- [P4 火山云现场复核与公网入口切换](logs/2026-10-22-P4-field-refresh.md)：用户确认后切换 HTTPS 上游，含健康检查及回退备份位置。
- [P4 火山云旧应用归档](logs/2026-10-22-P4-old-app-archive.md)：保存旧应用代码/配置、数据库转储、持久卷副本与镜像，并记录归档限制。
