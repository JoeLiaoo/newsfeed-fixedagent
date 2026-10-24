# 2026-10-24 任务详情页 /tasks/:id

- Agent：coding 助手
- 对应任务：维护任务（不对应 P0–P4 勾选）；`docs/PLAN.md` §4.2 页面结构中的 `/tasks/:id`
- 完成状态：代码与文档完成；[PR #60](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/60) 已创建，未合并、未部署

## 本次改动

- 修改文件：
  - `modules/membership/experts/routes.ts`：新增 `GET /api/v1/membership/expert-tasks/:id`（仅任务本人可读，访客 401，他人任务与不存在一律 404）；任务列表与单个任务共用同一段列（`taskColumns()`），单个任务多带一个 `expiresAt`，两处读到的行结构一致。
  - `modules/membership/experts/catalog.ts`：新增员工可见的任务文案 `EXPERT_TASK_STATE_LABELS`、`EXPERT_TASK_STATE_VARIANTS`、`EXPERT_TASK_STAGE_LABELS`、`EXPERT_TASK_ERROR_LABELS`，供专家页与任务详情页共用。
  - `modules/membership/pages/task-detail.tsx`：新增任务详情页（当前步骤、结果预览、错误原因、重试与取消、产物／材料／采集台账下载、终态删除材料、等待选择主体时确认主体），排队／执行／等待确认时定时刷新。
  - `modules/membership/module.ts`：注册页面路径 `tasks/:id`。
  - `modules/membership/pages/expert-detail.tsx`：任务列表里每条任务增加「查看详情」入口；错误文案与状态徽标改用共用文案表，不再在本页另存一份。
  - `modules/membership/tests/expert-task-detail.test.ts`：数据库用例（访客 401、他人任务 404、不存在 404、本人 200 与列表同形、产物／台账／材料标记、失败原因、到期后 404）。
  - `modules/membership/tests/task-detail-page.standalone.test.ts`：页面与路由注册的独立用例（路径注册、读取单个任务、各状态动作、能力优先文案、专家页入口）。
  - `.github/workflows/p3-checks.yml`：两个新用例接入 CI 的 standalone 与数据库检查清单。
  - 文档：本日志、`docs/IMPLEMENTATION.md` 的 P2 说明、`docs/README.md` 索引。
- 实际完成：
  - 员工有了自己的任务详情页：从专家页点「查看详情」进入 `/tasks/:id`，页面显示任务属于哪个专家、当前状态与步骤、创建／更新／到期时间、输入内容、结果预览、失败原因与重试、取消、产物与材料下载、任务结束后的材料删除。
  - 后端补上单个任务的读取接口，鉴权与任务列表一致：访客 401；别人的任务与不存在的任务都是 404（不泄露别人的任务是否存在）；任务到期清理后同样 404。
- 关键决定及理由：
  - 列表与单个任务共用同一段 SQL 列，两个页面读到的字段与形状相同，避免两处形状各改各的；列里加 `expiresAt` 是为了让页面说明任务何时被清理。
  - 任务状态、步骤与错误文案移到 `experts/catalog.ts` 共用，专家页与任务页说同一套话；错误文案仍是能力表述（企业信息查询、任务材料等），不出现数据源或模型品牌名。
  - 任务详情页沿用专家页已有的接口与规则（确认主体、重试、取消、材料删除都走既有路由），没有另造一套任务状态机；页面自己定时刷新，进行中的任务离开页面也照常执行。
  - 等待选择主体的任务在详情页也能确认主体，不必退回专家页；确认后任务继续排队。
  - 产物、台账与材料的下载入口都指向既有接口，详情页不直接暴露文件内容。

## 最小验证

- `npm run typecheck`：通过（contracts／backend／api／worker／tests／modules／web）。
- `npm run build -w @aihot/web`：通过；新页面进入路由清单（`apps/web/.react-router/types/+routes.ts`）。
- `node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`：108 项全部通过（含新增 4 项）。
- `DATABASE_URL=postgres://…/newsfeed_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/p3-db.test.ts modules/membership/tests/experts-access.test.ts modules/membership/tests/expert-task-detail.test.ts modules/membership/tests/expert-catalog-hidden.test.ts modules/membership/tests/expert-catalog-coming-soon.test.ts modules/membership/tests/panorama-db.test.ts tests/architecture.test.ts`：21 项全部通过（临时 PostgreSQL）。
- 本地浏览器抽测（脚本不入库，用本机 Chrome 打开构建后的页面）：任务成功页显示状态徽标、步骤、输入、结果预览、缺口提示、产物与台账下载、材料与删除入口；失败页显示失败原因与「重试」且没有「取消」；等待选择主体页显示候选主体；任务不存在时显示空状态；页面无脚本错误。
- `node scripts/check-doc-links.ts`：384 条本地链接全部有效。
- `git diff --check`：通过。
- 已知无关项：`tests/page-metadata.standalone.test.ts` 在本工作树为 2 通过／8 失败，去掉本次改动后的同一基线（`git stash`）结果一致，失败原因是该用例自带的假接口没有 `/api/v1/membership/me`，与本次改动无关，按约定不在本 PR 处理。
- 未执行：全量测试套件、真实员工账号试用、生产发布与真机验证。

## 风险与交接

- 已知限制／缺失依赖：
  - 任务详情页的字段来自任务表与材料／产物／台账表；已到期（超过七天保留期）的任务按 404 处理，与任务列表一致。
  - `modules/*/pages/*.tsx` 目前不在 `tsc` 的 include 范围内（`tsc -p modules` 只含 `*.ts`），页面代码由 web 构建解析；本次改动没有调整这一既有情况，已用同一严格配置单独校验新页面无类型错误。
  - 与未合并的 PR #55～#59 无依赖关系；PR #57 改的是任务列表接口（分页与按专家过滤），合并时列表那一处需要人工确认，本 PR 未依赖 `/account/artifacts`。
- 下一步：评审并合并 [PR #60](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/60) 后随下一次发布上线，再由用户用真实账号确认任务详情页的显示、刷新与下载。
