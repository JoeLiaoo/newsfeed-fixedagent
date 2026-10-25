# 2026-10-24 P5 知识库归因与时间线可见性 工作日志

- Agent：coding 助手（pi）；本次接手 Codex 中途达到用量上限留下的未提交改动（Codex 在 2026-10-24 19:19 前后中断），在原分支 `feat/kb-attribution-harden-v1`（基于 `origin/main` 的 `3f2447b`）上补完、验证并开 PR
- 对应任务：维护任务（不对应 P0–P4）；为 P5-03「同一标的不同机构／分析师／日期的材料保持独立归因，分歧并列、时间线与时效提示可追溯；缺失元数据保持「未知」不被补造」补强代码与界面。P5-02～P5-04 的完成标准未变，仍保持 `[ ]`
- 完成状态：完成（代码与文档已提交并开 PR；未合并、未部署，真实员工与真实材料验收仍待执行）

## 本次改动

- 修改文件：
  - `modules/membership/knowledge/routes.ts`：材料列表返回来源元数据（标题、作者、机构、日期、类型、入库时间）与单份材料的时效档位，并支持 `limit`／`offset` 分页（`hasMore`／`nextOffset`）；目标详情接口新增独立材料清单与页面修订时间线；同一材料对同一目标的多份贡献只展示一次。
  - `modules/membership/pages/knowledge-base.tsx`：材料卡片显示机构／分析师／材料日期／类型与时效徽标，缺失值显示「未知」；材料与知识页列表出现「加载更多」。
  - `modules/membership/pages/knowledge-target.tsx`：新增「材料时间线」（每份材料各自的归因、时效、入库时间与跳转）与「页面修订」两块；观点来源缺机构或日期时分别显示「机构未知」「材料日期未知」；页首说明观点并列保留、质量问题只提示归因与结构缺口。
  - `modules/membership/pages/knowledge-document.tsx`：版本行的缺失值文案与另两个页面统一（机构未知／分析师未知／材料日期未知）。
  - `modules/membership/tests/knowledge-access.test.ts`：新增数据库级验收——同一标的的两份材料在目标详情中都在、每次发布都有修订记录、缺失来源元数据在 API 中保持 `null` 且时效为 `undated`、材料列表分页返回 `hasMore`／`nextOffset`。
  - `modules/membership/tests/knowledge-bases.test.ts`：新增跨库隔离验收——某库的页面详情只返回该库的材料。
  - `docs/IMPLEMENTATION.md`、`docs/README.md`：补记本次归因可见性补强与本日志；P5-02～P5-04 保持未勾选。
  - `docs/logs/2026-10-24-kb-attribution-hardening.md`：本日志。
- 从 Codex 未提交改动继承的部分（本次只做复核与补完，未推翻其口径）：
  - 接口层：材料列表补来源元数据与时效、目标详情补材料与修订、分页参数与 `hasMore`／`nextOffset`；缺失值在 API 中保持空值，不补造。
  - 界面层：目标页的材料时间线与页面修订两块、观点来源缺值文案、材料列表的来源元数据行。
  - 测试层：`knowledge-access.test.ts` 的目标详情与分页断言、`knowledge-bases.test.ts` 的跨库隔离断言。
  - 材料详情页不再显示 `sha256` 校验和（接口的该字段一并去掉）。这是 Codex 在同一改动里做的取舍：校验和是技术字段，对员工阅读材料没有帮助。本次沿用该取舍，并在下面「已知限制」记明，便于复审时推翻。
- 本次补完与修正的部分：
  1. **补上缺失的工作日志**：`docs/README.md` 与 `docs/IMPLEMENTATION.md` 已引用 `logs/2026-10-24-kb-attribution-hardening.md`，但文件本身缺失（Codex 中断时未落盘），`node scripts/check-doc-links.ts` 因此失败。
  2. **同一材料只出现一次**：一份材料若对同一目标写了多个页面（目标键相同、草稿页名不同），会留下多行贡献，接口会把它列成多条材料。目标详情的材料清单改为按材料版本去重（`oneRowPerMaterial`），界面不再出现同一材料的重复条目。
  3. **时效文案只留一份**：两个页面各自内联了一份新鲜／半新／陈旧／日期未知的中文映射，改为直接复用 `modules/membership/knowledge/catalog.ts` 的 `FRESHNESS_LABELS`（服务端同一份来源），并把 `freshness` 的前端类型收紧为 `FreshnessTier`。
  4. **材料卡片不再重复标题**：材料卡原本把 `sourceTitle`（入库时等于材料标题）单起一行显示，与卡片标题重复；改为把时效徽标并入徽标行，来源信息只留一行。
  5. **「入库」时间用版本自己的入库时刻**：材料列表改为用 `versionCreatedAt`（该版本入库时间），不再用文档首次创建时间。
  6. **缺失值文案统一**：三个页面的未知文案统一为「机构未知／分析师未知／材料日期未知」。
- 关键决定及理由：
  - **缺失元数据在接口里保持 `null`、由界面显示「未知」**：接口不替用户补造分析师、机构、评级或日期；界面负责把「没有」说清楚，避免下游把空值当成事实。
  - **时效按材料自己的日期算**：单份材料的时效与页面覆盖度的时效分开——一份三个月前的材料放在今天的页面上仍然是三个月前的材料，不能因为页面刚发布就显示为「新鲜」。
  - **分页用 offset 而不是游标**：列表按时间倒序且排序键唯一（`created_at` + `id`／`published_at` + `slug`），offset 分页在两次请求之间不会漏行或重行；每次多取一行判断是否还有下一页。
  - **材料时间线只列仍然生效的贡献**：撤回或被新版本取代的材料不再出现在时间线里，与「共享库里此刻还看得见的材料」一致；被撤回材料的追溯仍走审计事件与管理员视角。
  - **质量问题与观点分歧分开表达**：页面顶部只说明读法，质量问题仍单列一块，不把质量问题读成「观点是错的」，也不从中挑出唯一结论。

## 最小验证

- 执行的检查及结果：
  - `npx tsc -p modules`：通过。
  - `npm run typecheck -w @aihot/web`（react-router typegen + `tsc -p .`）：通过。
  - 数据库测试（本机 PostgreSQL 16，模板库 `newsfeed_test`）：
    `DATABASE_URL=postgres://zhijianliao@127.0.0.1:5432/newsfeed_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency=2 --test-timeout=180000 modules/membership/tests/knowledge-access.test.ts modules/membership/tests/knowledge-bases.test.ts` —— 2 个用例全过（含本次新增的目标详情、分页、跨库隔离断言）。
  - 独立测试：`node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts` —— 28 个用例全过；`node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts` —— 13 个用例全过。
  - 文档链接检查：`node scripts/check-doc-links.ts` —— 通过（补齐本日志后，377 条链接全部存在）。
  - `git diff --check` —— 通过，无空白错误。
  - PR #55 的 CI：head `5197cd8` 上 `links`、`postgres-integration`、`quality` 三项检查全过（含本机之外的另一套 PostgreSQL 17 环境里的知识库数据库用例）。
- 未执行或需用户试用的检查：
  - 未做真实员工验收：两名已批准员工各自上传材料、各自核对「同一标的两份材料并列、各自归因、缺失项显示未知」的真实效果，仍待用户用自己的账号与真实材料复核（P5-02～P5-04 保持 `[ ]`）。
  - 未调用真实模型：本次没有触发任何构建，也不发版、不部署；页面渲染改动（材料时间线、修订列表、加载更多）没有在浏览器里人工点过。
  - 未跑全量测试套件（按仓库约定只做本次改动所需的最小验证）；CI 的 `postgres-integration` 与 `P3 checks` 在本 PR 的 head 上完整跑了一遍，三项检查全过（见下条）。

## 风险与交接

- 已知限制／缺失依赖：
  - 材料日期按上传时填写的日期保存，上传只校验「日历上真实存在」，不拦截未来日期；未来日期的材料会被算作最新（显示「新鲜」）。这是既有的日期口径，本次未改。
  - 构建任务列表（`/knowledge/tasks`）仍是固定 100 条上限，没有分页；本次只给材料与知识页列表加了分页，任务列表留待后续。
  - 材料详情页不再显示 `sha256`（沿用 Codex 的取舍）；若复审认为员工需要自行核对原件校验和，需要把该字段加回接口与页面。
  - 目标详情的材料清单只列仍然生效的贡献；被撤回材料从时间线上消失，撤回痕迹只在审计事件里。
  - 同一材料对同一目标写出多个页面时按一份材料展示，页面侧仍只保留聚合后的那一页。
- 下一步：
  - 复审本 PR；本 PR 不合并、不部署。
  - 合并后按常规发布流程发 api 与 web（无新增迁移），再用两份不同机构、不同日期的真实材料跑一次构建，核对：两份材料在目标页并列、缺失项显示「未知」、时效按材料自己的日期给出。
  - PR：[#55](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/55)（`feat/kb-attribution-harden-v1` → `main`，代码提交 `6af2b75`）。本 PR 不合并、不部署。

## 2026-10-26 基于最新 main 的复基与验证

- 将 PR #55 复基到当前 `origin/main`（含 #86、#97、#100 等后续合并）；保留主线材料正文加载和关联页解析，同时整合本 PR 的时间线材料、修订记录、来源分页和未知归因显示。
- 解决冲突的文件：`docs/IMPLEMENTATION.md`、`docs/README.md`、`modules/membership/knowledge/routes.ts`、`modules/membership/pages/knowledge-base.tsx`、`modules/membership/pages/knowledge-document.tsx`、`modules/membership/pages/knowledge-target.tsx`。
- 验证：`npx tsc -p modules` 通过；知识库 standalone 33/33 通过；知识库访问与多库数据库测试 2/2 通过（本机 PostgreSQL）；文档链接 482 条通过；`git diff --check` 通过。
- 全仓 `npm run typecheck` 在 `@aihot/web` 处失败：当前 worktree 未安装 `@radix-ui/react-dropdown-menu` 与 `@radix-ui/react-toggle-group`，并引发 `Tabs.tsx` 中的隐式 any 错误；模块 TypeScript 检查通过，GitHub CI 新 head 检查仍须完成。
- 复基 head：`657eab7`。本次未部署，未进行真实员工验收；P5-02～P5-04 继续未勾选。

## 2026-10-26 合并状态

- PR #55 复基后的新 head 检查全绿，已 squash 合并为 `9179785a74e7c0e9fdc60014e54046499c18cd22`。
- 尚未部署；P5-02～P5-04 的真实员工与材料验收仍待执行。
