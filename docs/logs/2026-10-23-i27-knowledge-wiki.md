# 2026-10-23 Issue #27 共享投研知识库 工作日志

- Agent：pi（issue #27 实施）；本条含 PR #34 首轮 Codex 审阅（round 1）的修复
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P5-01～P5-04；本次完成 P5-01，P5-02～P5-04 待真实员工与真实材料验证，保持未勾选
- 完成状态：部分完成（代码与文档完成，真实使用验收待办）

## 本次改动

- 修改文件：
  - `modules/membership/knowledge/`（新增）：`catalog.ts`、`prompts.ts`、`schema.ts`、`extract.ts`、`render.ts`、`lint.ts`、`routing.ts`、`compile.ts`、`answer.ts`、`worker.ts`、`queue.ts`、`routes.ts`
  - `modules/membership/migrations/0157_…`～`0170_…`（新增 14 条迁移：材料、版本、构建任务、知识页、修订、引用、质量问题、审计事件、问答及索引）
  - `modules/membership/pages/knowledge.tsx`（替换占位页）、`knowledge-target.tsx`、`knowledge-document.tsx`（新增：知识页与材料详情，供引用跳转）
  - `modules/membership/module.ts`、`modules/membership/server.ts`、`modules/membership/package.json`、`site/modules/server.ts`（路由、队列与模块接线）
  - `modules/membership/tests/knowledge-core.standalone.test.ts`（新增）、`modules/membership/tests/knowledge-access.test.ts`（新增）
  - `.github/workflows/p3-checks.yml`（两份新测试加入 CI）、`.env.example`（`MEMBER_KNOWLEDGE_MAX_FILE_MB`）
  - `docs/PLAN.md`（基线 v0.70，新增 §12 共享知识库、D12 决策）、`docs/IMPLEMENTATION.md`（新增 P5 阶段）、`docs/PROGRESS-REPORT.md`、`docs/KNOWLEDGE-OPS.md`（新增运行手册）、`docs/README.md`、`README.md`
- 实际完成：
  - **数据模型**：九张表——材料、版本（含原件字节与校验和）、构建任务（含编译草稿与复核结果两个检查点）、知识页、页面修订、引用锚点、质量问题、审计事件、问答。
  - **上传与状态**：`POST /knowledge/documents` 接收 PDF／Word／PPT／Markdown；按字节判定真实格式（不认扩展名），按 SHA-256 去重，同一材料的新文件作为新版本；每人有同时 2 个、每小时 10 个的构建额度；页面显示排队／处理中／失败／已发布与可重试。
  - **构建与复核**：队列 `membership.knowledge` 五段流程——抽取文本与锚点 → 编译结构化草稿 → 独立上下文复核（只能撤回条目或把归因降为「未知」）→ 机器检查（归因可识别、封闭立场词表、时间锚、时间线倒序、覆盖度口径、Related Pages 指向）→ 事务内发布新修订。复核结论 `fail` 或出现 `P0` 检查项时不发布，旧修订继续可读；失败任务可重跑并从上次检查点继续；租约过期的构建由 `membership.knowledge-recover` 重新入队。
  - **浏览检索与问答**：知识页列表与单页（正文、引用、质量问题、覆盖度、时效档）；问答只读已发布页面，按关键词与中文字元重合度路由，回答带可跳转脚注，区分原文观点与 AI 综合判断，无覆盖时返回明确提示。
  - **界面**：`/knowledge` 上传与任务状态、共享库浏览检索、问答；`/knowledge/targets/:slug` 知识页（引用可跳到材料）；`/knowledge/documents/:id` 材料详情（版本、校验和、原件下载）。撤回是不可逆操作，页面前先说明后果再确认。
  - **文档**：`docs/PLAN.md` 升到 v0.70 并新增 §12 与 D12；`docs/KNOWLEDGE-OPS.md` 记录数据模型、接口、流程、存储与容量、备份、保留与撤回、监控费用、部署回退，以及与本地投研 wiki 工具的环境差异。
- 关键决定及理由：
  - 原件**按字节存库**而不是落对象存储或文件系统：库内只有约 20 名员工，单文件上限 10 MB，原件随数据库每日备份一并保留，权限与备份口径与知识页一致；迁移到对象存储的路径写在运行手册里，接口不变。
  - 知识库**不适用**专家任务「上传材料与产物 7 天清理」：这是持久共享库，清理规则只在 `member_expert_*` 表上执行；保留与撤回策略写入 PLAN §12.3 与运行手册。
  - 页面由**平台渲染**，模型只产出结构化草稿：章节顺序、表格列、覆盖度计数、来源脚注由代码决定，机器才能逐页检查。
  - 复核者只能**撤回或降级**，不能新增：缺失归因写「未知」，不由模型补造。
  - 新增依赖只有 `unpdf@1.9.1`（PDF 文本抽取，无运行时依赖，MIT）；DOCX／PPTX 用仓库已有的 `fflate` 解压后按段落抽取文本，不另引第二个解析库。
  - 私有 `lzj-skill` 只作规则基线：源码、提示词与内部样例未进入本公开仓库，平台提示词为自写。

## PR #34 首轮 Codex 审阅修复（round 1）

审阅 head `82a39d4`，评论 [issuecomment-6369610263](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/34#issuecomment-6369610263)。六条意见逐条处理如下：

1. **[P1] 发布围栏**（`knowledge/worker.ts`、`knowledge/publish.ts`）：发布事务按固定顺序锁材料与任务，核对材料 `active`、任务 `running`、租约令牌属于当前 worker 且未过期；任一检查失败不写页面也不写成功事件。每个阶段的 `UPDATE` 影响 0 行即停止（`knowledge_lease_lost`）。同一材料已有更新版本发布时，旧构建以 `knowledge_publish_stale` 退出，不得覆盖新版本。
2. **[P1] 撤回后的直读**（`knowledge/routes.ts`、`knowledge/worker.ts`）：`GET /pages/:slug` 只返回 `published` 的页面；`GET /versions/:id/original` 与 `GET /documents/:id` 关联 parent document 状态；已撤回材料对其他员工是 404，对上传者与管理员是 410（审计可见），不再默认全员可读。
3. **[P1] 同一标的多材料聚合**（新增 `knowledge/aggregate.ts`、`knowledge/publish.ts`，新增表 `member_wiki_contributions`）：每份材料版本对标的稳定标识 `target_key` 存一份结构化贡献，页面由有效贡献聚合；更新一份材料只替换它自己那份贡献；页面按 `target_key` 加锁，并发发布互不覆盖；构建失败时旧发布内容不动。撤回按贡献粒度生效并重新聚合。
4. **[P1] 复核下标**（`knowledge/render.ts`）：复核的下标按它读到的草稿解释——归因修正先落在原条目上，撤回再按原下标批量执行；重复与越界的修正被忽略并记为质量问题。
5. **[P1] 问答归因**（`knowledge/answer.ts`、`knowledge/routes.ts`、`knowledge/schema.ts`、`knowledge/routing.ts`）：本轮只把已发布修订与引用 ID 给模型，模型只能引用这些 ID；服务端按 ID 还原分析师、机构、日期，覆盖范围与时效由实际用到的来源去重后计算，不采信模型自述；引用不上的一律丢弃，无可核对引用的回答按 `knowledge_answer_unverified` 拒给。
6. **[P2] 长单节 Markdown 截成空**（`knowledge/extract.ts`、`knowledge/worker.ts`）：截取预算计入锚点与分隔符，节内过长时保留预算内的非空前缀；截取后仍无文本则构建以 `knowledge_text_empty` 明确失败，不调用模型。

同步：`docs/PLAN.md` 升到 v0.71（聚合与问答归因的边界）；`docs/KNOWLEDGE-OPS.md` 记录新表、发布围栏、聚合、撤回语义与问答归因规则；`modules/membership/pages/knowledge.tsx`（问答覆盖字段改为服务端口径）、`knowledge-target.tsx`（来源数口径）。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`（contracts／backend／api／worker／tests／modules／web）通过。
  - `npm run build -w @aihot/web` 通过。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts`：8 项通过（格式按字节判定、四种格式取文、抽取截断、页面渲染与覆盖度计数、复核只能撤回或降级、机器检查项、问题路由、时效分档）。
  - `node scripts/check-doc-links.ts` 通过（271 个本地链接）。
  - `node scripts/check-migrations.ts --base=origin/main` 在本机**失败**，但与本次改动无关：本机 `core.autocrlf=true` 使工作区文件为 CRLF，脚本逐字比对后把**每一个**迁移（包括未改动的 `0001_core.sql`）都报成「已部署迁移被修改」。改用 `migrationPlan` 逐个校验本次新增的 14 条迁移，全部为 `transaction` 或 `index` 计划（在线安全）。
  - `npm run test:standalone`：273 项中 261 项通过、12 项失败；这 12 项（站点的公开页面、feed、MCP 方法拦截）在未改动的 `origin/main` 上同样失败（265 项中 253 通过、12 失败），与本次改动无关；新增的 8 项全部通过。
  - `node --test apps/web/tests/nav-groups.test.ts`：5 项通过。
  - `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13 项通过（跳过的用例需数据库，在 CI 跑）。
- 未执行或需用户试用的检查：
  - 真实 DeepSeek 上的编译、复核与问答效果未验证：需要真实研报材料与真实模型输出核对。
  - 两名真实员工共用同一共享库、真实中文 PDF 的抽取效果、页面质量与引用跳转未验证。

## 风险与交接

- CI 第 1 轮（PR #34，head `197a197`）：`postgres-integration` 失败——集成测试里“问一个完全无关的问题应当无覆盖”返回 200。原因是问答路由只按字元重合度计分，句子里一个常见词（如“覆盖”）就能把页面拉进来。已修正：路由改为“问题点名标的直接命中；否则需要两个以上共同词且总分达标”，并给通用虚词（没有、什么、请问等）加了停用表，正文里的词权重低于标的、标题与赛道；新增的 standalone 用例覆盖了这条规则。
- CI 第 2 轮（head `4ba1126`）：`quality`、`postgres-integration`、`links` 三个任务全部通过；数据库集成测试在 CI 的 PostgreSQL 上通过（`✔ the shared library is open to approved employees and closed to everyone else`）。
- CI 第 3 轮（head `eedcf4b`，审阅 round 1 首推）：`postgres-integration` 失败——「撤回的材料不再出现在页面里」断言不成立。CI 日志里的页面正文显示：撤回后页面只剩另一家机构的观点，但第二家机构的**测试草稿**沿用了第一家的争议点与风险条目（仍写着上一家的分析师名），属测试数据问题而非聚合缺陷。已把第二份草稿改为自带归因（提交 `cdd8656`）。
- CI 第 4 轮（head `cdd8656`）：`quality`、`postgres-integration`、`Docs checks` 全部通过；数据库集成测试在 CI 的 PostgreSQL 上通过（多材料聚合、并发发布、撤回后的读取边界、问答引用校验均在其中）。
- 已知限制／缺失依赖：
  - 页面检索是关键词与字元重合度路由，不是向量检索；标的别名与同义词会影响命中。
  - 扫描件 PDF 没有文字层，只标记「未能提取文本」，不做 OCR。
  - `coverage.reports` 统计的是页面引用的来源数，不是上传份数。
  - 平台版没有实现本地工具的多库发现与锁定、git 历史分片、待决队列（PENDING）、定时 lint 与看板（差异表见运行手册 §10）。
  - 本地没有 PostgreSQL，集成测试只能由 CI 跑；改动数据库相关代码时先看 CI 结果。
- 下一步：
  - CI 通过后由用户用真实账号各上传一份材料，完成 P5-02～P5-04 的验收；用同一标的不同机构／日期的材料核对归因、分歧并列与时效提示。
  - 生产发布前按运行手册执行迁移并核对 `MEMBER_KNOWLEDGE_MAX_FILE_MB` 与备份体积。

## 最小验证（审阅 round 1）

- 执行的检查及结果：
  - `npm run typecheck`（contracts／backend／api／worker／tests／modules／web）通过。
  - `npm run build -w @aihot/web` 通过。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts`：15 项通过（新增：截取预算与长单节非空前缀、复核原下标与重复／越界、多材料聚合与单份材料更新）。
  - `npm run test:standalone`：280 项中 268 项通过、12 项失败；失败的 12 项与上一轮相同（站点公开页、feed、MCP 方法拦截），在未改动的 `origin/main` 上同样失败，与本次改动无关。
  - `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13 项通过。
  - `node scripts/check-doc-links.ts` 通过（271 个本地链接）。
  - `node scripts/check-migrations.ts --base=origin/main` 在本机仍因 `core.autocrlf=true` 把全部 130 条既有迁移报成「已修改」（与本次改动无关）；本次新增的 5 条迁移（`0171_…`～`0175_…`）逐条用 `migrationPlan` 校验，分别为 `transaction` 与 `index` 计划（在线安全），且未被该脚本列为「已修改」。
- 未验证事项：
  - **数据库集成测试（`knowledge-access.test.ts`）本机无法运行**（本机无 PostgreSQL），只能由 CI 的 `postgres-integration` 任务验证：多材料聚合、并发发布、撤回后的读取边界与问答引用校验都在该用例里。
  - 真实 DeepSeek 上的编译、复核与问答效果仍未验证：需要真实研报材料与真实模型输出核对。
  - 两名真实员工共用同一共享库、真实中文 PDF 的抽取效果、页面质量与引用跳转未验证。

不要在日志中写入密钥、未脱敏接口响应或用户私人材料。任务只有达到实施计划的完成标准时才能打勾。


## PR 实际状态（2026-10-24）

- [PR #34](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/34) 已经二次复审修复并合并，实际 merge `9e8b0846ef5b80e2398b3a0fbc69218027c20b65`，最终代码 head `f007b4d48612951deb66a27c02529d66a153360a`。
- 最终 quality、postgres-integration、links 全部通过；核心纯函数 17/17，PostgreSQL 集成 25/25。补充修复与真实回归边界见 [复审日志](2026-10-24-P5-pr34-review.md)。
- 未部署生产；真实 DeepSeek/中文材料效果和 P5-02～P5-04 真实员工验收仍待进行，原未勾选状态保持。
