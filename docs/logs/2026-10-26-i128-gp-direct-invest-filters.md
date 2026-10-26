# 2026-10-26 · Issue #128 已投 GP 直投项目筛选

- Agent：Codex
- 对应任务：维护任务（不对应 P0–P5 验收项）
- 完成状态：代码和本地非数据库验证完成；待数据库集成 CI、PR 评审、发布与员工复验

## 本次改动

- 修改文件：
  - `modules/membership/gp/routes.ts`、`modules/membership/gp/province.ts`
  - `modules/membership/pages/projects/project-list.tsx`、`modules/membership/pages/projects/invested-gp-state.ts`
  - `modules/membership/pages/gp-admin.tsx`
  - `modules/membership/tests/gp-projects-access.test.ts`、`modules/membership/tests/gp-projects-state.standalone.test.ts`、`modules/membership/tests/gp-province.standalone.test.ts`
  - `database/migrations/0192`–`0201` GP 项目筛选迁移
  - `site/changelog/pending/gp-direct-invest-filters.json`
  - `docs/IMPLEMENTATION.md`、`docs/README.md`
  - `docs/P3-OPERATIONS.md`
- 实际完成：
  - GP 项目列表 API 在分页前按母基金、子基金、省份与单个赛道组合过滤；原有关注匹配、项目分组与分页仍由同一查询处理。API 提供省级筛选选项，并对未知归属提供“未知”选项。
  - 员工列表加入四项筛选，URL 保存筛选状态，卡片显示基金归属和省份；无符合条件的记录有空状态。
  - 管理审核表可维护母/子基金名称与关系依据；填写基金归属时须提供至少 8 字依据和 HTTPS 来源，并更新 P3 运维说明。
  - 管理员可通过新华财经公司画像核验项目省份。仅在新华返回企业 ID、企业名称均与被投主体一致时解析登记地址；没有主体 ID、服务失败、地址缺省或省份不能唯一识别时省份保持“未知”。
- 关键决定及理由：
  - 原有 GP/项目模型没有母基金、子基金或项目省份字段，也没有省份 helper；不把 GP 名称猜作基金层级，也不从行政区地址片段推断省份。
  - 使用新增列追加迁移；数据默认 NULL，历史记录不自动回填。在线索引使用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`。
  - 新华财经员工端核验复用 `withXinhua` 与 `querySelectedCompanyProfile`；需已有新华财经 MCP 凭据。省份映射仅接受唯一的省级名称。

## 最小验证

- 执行的检查及结果：
  - `npm ci`：通过，锁文件安装完成，npm audit 报告 0 vulnerabilities。
  - `npm run typecheck`：通过。
  - GP 项目分页/筛选 loader 与省份解析 standalone 定向测试：10/10 通过。
  - `node scripts/check-migrations.ts --base=origin/main`：通过。
  - `git diff --check`：通过。
- 未执行或需用户试用的检查：
  - `gp-projects-access.test.ts` 与 `gp-admin-access.test.ts` 数据库集成用例已扩充覆盖四项 AND 过滤、未知/省级展示与筛选选项、基金归属证据门槛和省份核验鉴权；本地没有 `DATABASE_URL`，因此未运行，需要 PR 的 postgres-integration CI 执行。
  - 未调用真实新华财经 MCP，也未验证真实员工账号或生产数据；运行时需要既有 `XINHUA_MCP_API_KEY`。
  - 未部署。

## 风险与交接

- 已知限制／缺失依赖：
  - 历史记录的母基金、子基金和省份均保留未知，须管理员逐项维护关系依据或用新华财经核验省份。
  - 新华财经资料只能按准确主体 ID 与名称完成身份核对；缺 ID 或名称不一致时不会给出省份。
  - P3-01～P3-04 的 GP 主体、投资事实、数据同步、通知和员工验收状态不变。
- 下一步：PR CI 执行数据库集成测试；评审通过后再按独立发布流程处理。员工和真实新华财经资料验收仍待用户侧完成。
