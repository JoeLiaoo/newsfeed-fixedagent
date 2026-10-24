# 2026-10-24 P2-05 目录里新增「企业舆情报告」开发中入口

- Agent：pi coding agent
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P2-05（PR #48 内的追加改动；未合并、未部署）
- 完成状态：完成（代码、迁移、测试与文档已就绪；未做生产验收）

## 本次改动

- 修改文件：
  - `modules/membership/migrations/0188_member_experts_status_coming_soon_drop.sql`、`0189_member_experts_status_coming_soon_check.sql`、`0190_member_experts_status_coming_soon_validate.sql`：`member_experts.status` 的检查约束扩到 `('available','blocked','hidden','coming_soon')`。
  - `modules/membership/experts/catalog.ts`：新增 `COMING_SOON_EXPERT_STATUS`（`coming_soon`）、`COMING_SOON_EXPERT_SLUG`（`company-sentiment-report`）、`COMING_SOON_EXPERT`（名称「企业舆情报告」、描述、技能文本 stub）以及员工可见的状态徽标映射 `EXPERT_STATUS_BADGES`／`expertStatusBadge`。
  - `modules/membership/experts/routes.ts`：播种写入这条开发中条目（冲突分支一并写回状态）；目录接口对所有角色返回 `coming_soon`，排序为可运行 → 开发中 → 缺少依赖；对该 slug 新建任务按「开发中」拒绝（404 `expert_coming_soon`）。
  - `modules/membership/experts/worker.ts`：注明开发中的专家不执行（状态既非 `available` 也非 `hidden`，执行器直接报 `expert_unavailable`）。
  - `modules/membership/pages/experts.tsx`、`modules/membership/pages/expert-detail.tsx`：状态徽标统一走 `expertStatusBadge`；开发中的条目不显示执行模式与输入提示，详情页显示「开发中，敬请期待」且不显示提交表单与任务列表。
  - `modules/membership/tests/expert-catalog-coming-soon.test.ts`（新增）、`modules/membership/tests/expert-coming-soon.standalone.test.ts`（新增）、`.github/workflows/p3-checks.yml`。
  - `docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`docs/PLAN.md`（v0.79）、`docs/README.md`、根 `README.md`、本日志。
- 实际完成：
  - 员工目录里多一条「企业舆情报告」卡片，徽标为「开发中」；点进详情页显示「开发中，敬请期待」，没有提交任务的表单，也没有任务列表。
  - 这条入口对员工与管理员都可见（内置行的 `owner_id` 为空，靠状态本身进入目录），与隐藏入口的行为不同。
  - 新建任务接口对这条 slug 返回 404 `expert_coming_soon`；即使绕过界面直接排队，执行器也只把它记为失败，不产出报告。
  - 已部署的旧状态行在下一次播种时翻成 `coming_soon`；播种同时把名称、描述、技能文本写回。
  - 员工可见文案只有能力表述（「企业舆情报告」「面向企业公开舆情与品牌声誉的专题报告能力，开发中，敬请期待」），没有供应商品牌名；没有写任何未接入的数据源，也不承诺报告内容。
- 关键决定及理由：
  - **新增 `coming_soon` 状态而不是复用 `blocked` 或 `hidden`**：`blocked` 的语义是缺少依赖（会显示「缺少依赖」徽标），`hidden` 是目录里不提供入口。规划中的能力既不是缺依赖也不是隐藏，两者都会给出错误的事实。
  - **迁移沿用 `hidden` 的在线迁移写法**：拆成「删约束 → 加宽约束（NOT VALID）→ 校验约束」三条，一条迁移只做一个动作，避免在强锁下扫表。数据翻转放在播种里，不放在发布迁移里。
  - **目录保留入口、写入拒绝**：与隐藏入口相反——员工能看到规划，但平台不开始任务。
  - **开发中的条目不显示执行模式**：`execution_mode` 描述的是「员工要提供什么」，对还没有执行流程的条目没有意义，界面上只留状态徽标与版本号。
  - **详情页不显示任务列表**：这条入口没有任务可跑，空列表只是噪音。

## 最小验证

- 执行的检查及结果：
  - `node scripts/check-migrations.ts --base=origin/main`：通过（三条新迁移命名与在线安全词表合规）。
  - `npm run typecheck`：通过。
  - `npm run build -w @aihot/web`：通过。
  - `node --import ./tests/standalone.ts --test ...`（CI 同款 standalone 清单，含新增 `modules/membership/tests/expert-coming-soon.standalone.test.ts`）：85 项通过。
  - `node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test ...`（CI 同款 PostgreSQL 清单，含新增 `modules/membership/tests/expert-catalog-coming-soon.test.ts`）：29 项通过；本地一次性 PostgreSQL，库名 `newsfeed_test`。
  - 迁移实跑：在一份全新库与一份把约束改回旧口径（`('available','blocked')`）的库上分别执行 `scripts/migrate.ts`，`0185`–`0190` 全部成功，`member_experts_status_check` 最终为 `CHECK (status = ANY (ARRAY['available','blocked','hidden','coming_soon']))` 且 `convalidated = t`。
  - `node scripts/check-doc-links.ts`：通过。
- 未执行或需用户试用的检查：
  - 未合并、未部署，没有在生产环境验证目录与任务行为。
  - 卡片与详情页的「开发中」文案未做真机确认（仅类型、构建与页面源码断言覆盖）。
  - 这条入口接入真实舆情数据源后的报告口径没有验证；本次只做入口，不含采集与报告生成。

## 风险与交接

- 已知限制／缺失依赖：
  - 部署顺序：先应用迁移（放开 `coming_soon` 取值），再发布新代码；反过来会让播种在旧约束下报错。
  - 迁移期间（删约束与加约束之间）`status` 暂时没有检查约束；该窗口内只会写入旧状态或新状态，不会出现非法值。
  - `execution_mode` 对这条条目仍按工具清单派生为 `text_only`（内部字段），员工界面在开发中不显示它；目录接口的调用方不要把它当成可执行模式。
  - 本次不含任何舆情数据源、报告生成或外部服务接入；「未提供／开发中」的口径不得改写成已具备的能力。
- 下一步：
  - 合并 PR #48 并部署后，用真实员工账号确认目录里出现「企业舆情报告」且徽标为「开发中」，详情页显示「开发中，敬请期待」，直接提交任务被拒绝。
  - 真正开放这条入口时，把播种状态改回 `available`，并另立任务接入数据源与报告口径；P2-05 在全景底稿真实样例验收完成前保持 `[ ]`。
