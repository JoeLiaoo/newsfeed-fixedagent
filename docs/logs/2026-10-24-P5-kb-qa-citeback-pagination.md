# 2026-10-24 P5 · 知识库问答回跳与构建列表分页 工作日志

- Agent：coding 助手（pi）
- 对应任务：维护任务（不对应 P0–P5 勾选）；为 `P5-04`「问答可跳回依据页面与原件，无覆盖时明确提示」补齐代码侧能力，并为知识库构建列表补上分页
- 完成状态：完成（代码与测试）；PR #56 已于 2026-10-26 合并（`c207c01`）并随 release `55244fc` 发布到生产，真实员工验收未做，`P5-02`～`P5-04` 保持未勾选

## 本次改动

- 修改文件：
  - `modules/membership/knowledge/routes.ts`：新增 `pageWindow`（`limit` 收敛到 1–100、默认 50，`offset` 收敛到 0–100000）；`GET /api/v1/membership/knowledge/tasks` 去掉写死的 `LIMIT 100`，改为 `LIMIT limit+1 OFFSET offset`，返回 `hasMore` 与 `nextOffset`；问答的引用查询联结 `member_wiki_document_versions` 与 `member_wiki_documents`，每条引用多带 `documentId`、`documentTitle`、`fileName`。
  - `modules/membership/knowledge/routing.ts`：`RoutableCitation` 增加 `documentId`／`documentTitle`／`fileName`。
  - `modules/membership/knowledge/answer.ts`：`TrustedCitation` 同步增加这三个字段；归因、覆盖与时效仍只取库里的记录，模型看不到也不写这些字段。
  - `modules/membership/pages/knowledge-base.tsx`：构建状态卡片改为分页读取（每页 20 条，上一页／下一页），轮询只刷新构建列表；问答「参考资料」每条除依据页链接外，增加材料页链接与原件下载按钮；缺失的分析师／机构／日期显示「未知」；`knowledge_no_coverage` 不再显示成通用失败，本库没有已发布知识页时显示「本库尚无已发布知识页，先上传材料并等待构建完成。」。
  - `modules/membership/tests/knowledge-access.test.ts`：新增构建列表分页断言（`hasMore`／`nextOffset`／超限收敛／访客 401）、引用带 `documentId` 与 `versionId` 且指向库里真实材料与原件的断言、无覆盖时返回既有错误码与既有文案且不留回答记录。
  - `modules/membership/tests/knowledge-bases.test.ts`：新增按库隔离的构建列表断言（各库只列自己的构建）。
  - `modules/membership/tests/knowledge-core.standalone.test.ts`：引用 fixture 补上新的三个字段。
  - `docs/KNOWLEDGE-OPS.md`：接口表补上 `GET /tasks` 的分页参数与问答引用字段；§12 补上问答回跳与列表分页两条边界。
- 实际完成：
  - 问答的每条引用现在能跳到材料页并下载原件，路径与知识页／材料页已有的做法一致（`/knowledge/documents/:documentId`、`/versions/:id/original`）。
  - 构建列表不再被写死的 100 条截断；页面按页读取，后台轮询只刷构建列表。
  - 无覆盖的提问有明确文案，不再落进「问答失败，请重试。」
- 关键决定及理由：
  - **不改归因口径**：分析师、机构、日期仍从库里自己的记录读，缺失就是缺失，页面显示「未知」，不由模型或前端补造。
  - **引用字段由服务端联结得出**：`documentId` 由 `member_wiki_citations.version_id` 联结版本与材料得到，是库里的既有事实，不需要新字段、不需要迁移。
  - **分页参数收敛而不是报错**：`limit`／`offset` 越界时收敛到有效范围，与仓库里 GP 列表分页的做法一致，避免页面因为一个参数就整个读不出来。
  - **列表分页只做构建列表**：本次只按任务要求改 `GET /tasks`；材料与知识页列表的分页在另一个分支（PR #55）上，两边改动互不覆盖。
  - **无覆盖的文案分两层**：库里没有已发布知识页时说明「本库尚无已发布知识页」；有页面但没覆盖该问题时用既有文案 `knowledge_no_coverage`（「共享库中没有覆盖该问题的已发布内容。」）。两者都不是失败提示。

## 最小验证

- 执行的检查及结果：
  - `tsc -p modules`、`tsc -p packages/contracts`、`tsc -p packages/backend`、`tsc -p apps/api`、`tsc -p apps/worker`、`tsc -p tests`：通过。
  - `npm run typecheck -w @aihot/web`（`react-router typegen && tsc -p .`）：通过。
  - 独立测试：`node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts modules/membership/tests/gp-core.standalone.test.ts modules/membership/tests/experts.standalone.test.ts` —— 47 个用例全过。
  - 数据库测试（本地 PostgreSQL，`DATABASE_URL=postgres://zhijianliao@127.0.0.1:5432/newsfeed_test`）：`modules/membership/tests/knowledge-access.test.ts`、`modules/membership/tests/knowledge-bases.test.ts` 通过。
  - 与 CI 同列的数据库回归（p3-db、gp-projects-access、gp-admin-access、access-contract、experts-access、expert-catalog-hidden、expert-catalog-coming-soon、panorama-db、notifications-access、ilink-binding、ilink-scan、source-check、knowledge-access、knowledge-bases、tests/architecture.test.ts）：32 个用例全过。
  - 文档链接检查：`node scripts/check-doc-links.ts` —— 384 个本地链接全部存在。
  - `git diff --check` —— 通过。
- 未执行或需用户试用的检查：
  - 未在浏览器里人工点过问答回跳与构建列表翻页（本机没有可用的登录会话与真实材料），页面效果待用户在真实账号上确认。
  - 未在生产调用真实模型问答，未发版、未部署。
  - 未做两名真实员工的共用验收：`P5-02`～`P5-04` 仍待真实账号与真实材料。

## 风险与交接

- 已知限制／缺失依赖：
  - 引用里的 `documentTitle`／`fileName` 来自材料与版本记录；材料被撤回后原件接口按既有规则不再对其他员工开放（404），链接仍在。
  - 问答引用里的 `title` 仍是依据页的 slug，与改动前一致；显示目标名要改知识页接口，本次未动。
  - 这次没有新增迁移、表或字段；`member_wiki_answers.citations` 里的 JSON 多带三个字段，旧记录不受影响。
  - PR #55（知识库归因补强）已于 2026-10-26 合并；本 PR 基于其合并提交复基，冲突已逐项处理并通过上述针对性检查。
- 下一步：
  - 打开 PR（见本日志末尾的 PR 链接），由审阅者确认分页参数收敛与引用字段的边界。
  - 合并后按运维手册走一次受控发布，用一份真实材料跑一次问答，确认材料页与原件两个入口可达；再安排两名员工的真实试用。

## 2026-10-26 基于 PR #55 合并后的 main 复基

- PR #55 已在 `9179785a74e7c0e9fdc60014e54046499c18cd22` squash 合并。本 PR 复基到该提交后的 `main`，合并保留了材料与知识页分页、材料归因时间线、无覆盖 422 行为及既有知识页正文和关联目标修复。
- 冲突解决后复用同一个 `pageWindow`（含 offset 上限 100000），扩展真实数据库引用字段以返回材料标识、标题和文件名；standalone 引用 fixture 补齐对应材料元数据。
- `npx tsc -p modules`：通过；知识库 standalone：33/33 通过；知识库访问与多库数据库测试：2/2 通过（本机 PostgreSQL）；`node scripts/check-doc-links.ts`：485 个链接通过；`git diff --check`：通过。
- `hasCheckpoint` 与员工采集台账下载入口检查：未在 `/tasks`、任务详情页或专家详情页发现相关 UI/API 引用。
- 当前复基提交为 `dd6b245`。未部署；真实员工验收仍待执行，P5-02～P5-04 保持未勾选。

## 2026-10-26 合并状态

- PR #56 基于 PR #55 合并后的 main 复基，`links`、`quality`、`postgres-integration` 全部通过，已 squash 合并为 `c207c01d122778a8611183bf66878ece05050ea8`。
- 尚未部署；P5-02～P5-04 的真实员工验收待执行。

## 2026-10-26 生产发布

- 已随 release `55244fc81cde5e88dbde777b1c59d62826204245`（短 `55244fc`）发布到火山云 `ai-work` 生产；发布窗口 2026-10-26 01:42–01:56，0 条新迁移（`schema_migrations` 仍为 164 条、最大 `0190`），镜像内 membership 回归 158/158 通过。
- 引用回跳与构建列表分页代码已在最终运行镜像中确认（`enrichCitations`、`enrichAllCitations`）。
- 登录后的员工侧复验仍待人工完成；本项的验收勾选状态不变。发布记录见[功能批次生产发布日志](2026-10-26-P4-feat-batch-deployment.md)。
