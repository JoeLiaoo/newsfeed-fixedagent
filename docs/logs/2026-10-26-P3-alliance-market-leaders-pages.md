# 2026-10-26 P3 项目分类员工页

- Agent：Codex
- 对应任务：P3-01～P3-03 的员工可见项目页维护；真实业务验收仍未完成。
- 完成状态：代码完成，待 PR 评审、部署和真实项目核验。

## 本次改动

- 修改文件：`database/migrations/0152`～`0155`、`modules/membership/gp/routes.ts`、`modules/membership/pages/gp-admin.tsx`、`modules/membership/pages/projects/*`、`modules/membership/module.ts`、对应测试、`site/changelog/pending/alliance-market-leaders-projects.json`、README、计划、实施状态、运维文档与索引。
- 中信股权联盟和市场头部机构列表、详情复用已投 GP 的卡片、关注匹配、分页、空列表、错误重试和演示域名来源抑制。现有员工导航已列出两个入口，本次补齐详情路由。
- `member_gp_watchlist.project_groups` 是管理员核对的机构分类，可同时属于两类；`project_group_basis` 记录依据。默认分类为空，既有主体和候选 seed 均不自动归类。管理员可在 GP 管理页设置或撤销分类；分类时必须提供依据。
- 员工 API 使用原有登录鉴权和 `verified` 投资、有效 GP、真实 GP 身份门槛，并按分类过滤列表与详情。分类依据和内部证据不进入员工响应；不存在、未分类、跨分类、暂停或未核实的详情返回 404。

## 最小验证

- `npm ci`、`npm run typecheck`：通过。
- `node scripts/check-migrations.ts --base=origin/main`：通过；四条在线迁移分别添加列、建立与验证约束。
- GP 列表状态 loader 独立测试：8/8 通过，包括两种分类的加载、关注匹配及错误后重试。
- 项目导航定向测试：6/6 通过，包含两类详情的侧栏归属。
- 临时 PostgreSQL 17 中的 `gp-projects-access.test.ts` 与 `gp-admin-access.test.ts`：2/2 通过；覆盖员工权限、分类隔离、未分类、暂停、未核实、详情与管理员分类依据校验。
- `node scripts/check-doc-links.ts`、`git diff --check`：通过。

## 风险与交接

- 未从真实资料核对任何联盟或头部机构，也未向生产写入 GP 分类或投资项目。没有分类时两个员工页会显示空状态；页面上线不代表真实数据已验收。
- 未部署，未用真实员工账号、供应商接口或移动设备验证；P3-01～P3-04 保持未勾选。
- 下一步：PR 评审与 CI 后合并；另按 P3 运维闸门迁移并发布，再由管理员逐一核对机构身份、分类依据和项目证据，员工复核列表与详情。
