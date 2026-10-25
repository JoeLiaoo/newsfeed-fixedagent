# 员工全局任务记录

## 变更

- 新增 `/tasks`，展示当前员工跨专家的任务记录，按创建时间分页并轮询进行中的任务；可打开单项详情并下载已有产物或采集台账。
- 新增 `/api/v1/membership/expert-tasks/:id`，访客返回 401，其他员工、不存在及过期任务统一返回 404；列表分页仍以当前用户为范围。
- 移植 PR #60 的详情页实现及员工状态、步骤、错误文案，并保留当前分支的全景候选、查询词和 HTML 看板处理。
- 专家目录页和专家任务页提供全局任务记录入口。员工文案沿用能力表述，不显示服务商或模型品牌。

## 修改文件

- `modules/membership/module.ts`
- `modules/membership/experts/routes.ts`
- `modules/membership/experts/task-page.ts`
- `modules/membership/experts/catalog.ts`
- `modules/membership/pages/tasks.tsx`
- `modules/membership/pages/task-detail.tsx`
- `modules/membership/pages/experts.tsx`
- `modules/membership/pages/expert-detail.tsx`
- `modules/membership/tests/expert-task-page.standalone.test.ts`
- `modules/membership/tests/task-detail-page.standalone.test.ts`
- `modules/membership/tests/expert-task-detail.test.ts`
- `.github/workflows/p3-checks.yml`
- `docs/PLAN.md`, `docs/IMPLEMENTATION.md`, `docs/README.md`

## 验证

- `npm ci`：通过，按锁文件安装依赖。
- `npm run typecheck`：通过。
- 任务页和分页 standalone 测试：通过（7 项）。
- `expert-task-detail.test.ts`：通过；使用临时 PostgreSQL 17 容器，含访客 401、他人任务 404、本人详情、过期清理、分页字段及列表/详情行结构检查。
- `node scripts/check-doc-links.ts`：通过，423 个本地 Markdown 链接目标存在。
- `git diff --check`：通过。
- 代码尚未部署；员工真实验收未做。

## 风险与后续

- 详情接口复用列表所需的数据并增加单行读取；现有用户隔离条件、七天到期过滤与私有缓存头继续生效。
- P2-05 的真实全景任务与员工产物验收未完成，不能据本次任务页交付勾选 P2-05。
- 后续需在 PR CI 的一次性 PostgreSQL 上确认详情读取、分页元数据及跨员工隔离测试。
