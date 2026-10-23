# 2026-10-24 · Issue #36 专家平台与知识库卡片列表

- Agent：pi（分支 `feat/issue-36-expert-knowledge-cards`，基于 `origin/main` 的 `af6b39a`；PR [#38](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/38)，开 PR 时未合并）
- 对应任务：维护任务（不对应 P0–P5）；需求来源为 [Issue #36](https://github.com/JoeLiaoo/newsfeed-fixedagent/issues/36)，需求基线记入 `docs/PLAN.md` v0.73
- 完成状态：完成（卡片列表、详情页与新增入口、多知识库数据模型与接口已交付；真实员工验收与生产发布未做）

## 本次改动

### 入口：列表卡片 → 详情再操作（专家平台与知识库对称）

- `modules/membership/pages/experts.tsx`（重写）：专家平台首页改为**卡片网格**（名称、说明、状态徽章、执行模式与版本），页头「+ 新增专家」；卡片整块可点，指向 `/experts/:slug`。
- `modules/membership/pages/expert-detail.tsx`（新增）：专家详情。沿用原页面的能力——提交任务表单（内置专家填目标企业名称，其余专家填任务要求）、我的任务（按该专家过滤）、实体确认、产物下载、重试与取消。页首有返回专家平台的按钮。
- `modules/membership/pages/expert-new.tsx`（新增）：「新增专家」页，即原有「导入技能」流程（ZIP／`SKILL.md`，检查格式与依赖后发布）；导入成功后给出进入新专家的入口。
- `modules/membership/pages/knowledge.tsx`（重写）：知识库首页改为**卡片网格**（名称、说明、材料数、知识页数、构建中与失败数），页头「+ 新增知识库」（不是「新增专家」）。
- `modules/membership/pages/knowledge-base.tsx`（新增）：知识库详情，承载原 `/knowledge` 页面的全部能力——上传材料、构建状态、浏览与检索、问答与引用跳转——全部按所在库读取。
- `modules/membership/pages/knowledge-base-new.tsx`（新增）：「新增知识库」页（名称与说明），创建后直接进入该库。
- `modules/membership/module.ts`：登记 `experts/new`、`experts/:slug`、`knowledge/bases/new`、`knowledge/bases/:id` 四条路由（`new` 为静态段，优先于 `:slug`／`:id`）。
- `apps/web/app/components/member-ui/card.tsx`：`Card` 增加 `asChild`（Radix Slot，与仓库既有 `Button asChild` 同一写法），使卡片本身就是链接时仍用卡片自己的样式，不在两处各写一份类名。
- `modules/membership/pages/knowledge-target.tsx`、`knowledge-document.tsx`：「返回知识库」改为回到该页所属的库。

### 知识库按库组织（多知识库最小模型）

- 新表 `member_wiki_bases`（`id`、`name`、`description`、`status`、`created_by`、时间戳）；材料与知识页各加一列 `base_id`（常量默认值 `'shared'`），并各建一个索引。迁移 `0176_…`～`0180_…`，每条一条语句。
- `modules/membership/knowledge/bases.ts`（新增）：库的常量与换算。**共享库沿用上线前已有的 `target_key` 与 `slug`**（已发布的页面仍是共享库的页面，不需数据回填）；其他库在前面加自己的库号（`kb-xxxx|view|公司|某公司`、`kb-xxxx-view-company-example`），因此同一标的可以在两个库中各有一页，互不合并、互不引用。默认库 `shared` 在第一次读库列表时写入（`ensureDefaultBase`），迁移里不插数据。
- `modules/membership/knowledge/routes.ts`：新增 `GET/POST /knowledge/bases`、`GET /knowledge/bases/:id`；`GET /overview`、`GET /documents`、`GET /tasks`、`GET /pages` 接受 `baseId`（缺省为共享库）；`POST /documents` 接受 `baseId`（材料入所在库，作为已有材料的新版本时必须同库）；`POST /answers` 接受 `baseId`，候选页面只取该库的已发布页面。
- `modules/membership/knowledge/publish.ts`、`worker.ts`：发布与撤回按库进行——页面写入所属库、贡献只聚合同库同标的的材料、撤回只重建本库的页面；机器检查（Related Pages）只看本库的页面。
- 鉴权：全部接口仍走员工会话（`memberSession`）；未登录与未批准账号在访问边界即被拒（`registerMembershipAccessBoundary`），库列表、库详情、上传与问答同样受此保护。新增库与材料入库一致，不设逐条审核；同时存在的库上限 20 个。

### 文档

- `docs/PLAN.md` v0.73：页面结构补 `/experts/:slug`、`/experts/new`、`/knowledge/bases/:id`、`/knowledge/bases/new`；§12 写明知识库按库组织、同一标的在不同库中各有一页、问答只依据所问之库。
- `docs/KNOWLEDGE-OPS.md`：数据模型、接口表、新增 §2.1（多个知识库怎么分开）与 §13（多库的落地边界与未验证项）。
- `docs/IMPLEMENTATION.md`、`docs/PROGRESS-REPORT.md`、`docs/README.md`：同步本次改动与日志链接。P5-01～P5-04 的勾选状态**未变**（真实材料验收仍待执行）。

## 关键决定及理由

- **默认库保留旧键与旧 slug**：迁移约定不允许在发布迁移里回填数据（`scripts/migration-safety.ts`），且 `member_wiki_pages.target_key` 上有全局唯一索引、不能删。共享库因此沿用原键原 slug，新库加库号前缀——上线前的页面无需任何数据处理，仍是共享库的页面，也不会与新库撞键。
- **库不是新的权限域**：所有已批准员工都能看全部库。这是最小可落库方案；按库授权留待后续（已写入运行手册的未验证项）。
- **专家的「我的任务」放进详情**：issue 要求「沿用现有导入／任务／状态等能力，移入详情或保持可达」。任务列表按专家过滤后放进详情，列表页只留卡片与新增入口，两侧对称。
- **页头按钮用 `+ 新增专家`／`+ 新增知识库`**：按 issue 定稿的文案；知识库不是「新增专家」。
- **组件不重写**：卡片复用仓库既有的 `Card`（只加 `asChild`），图标用既有的 `lucide-react`，链接用既有的 `IntentLink`，没有引入新依赖。

## 最小验证

- `npm run typecheck`（contracts、backend、api、worker、tests、modules、web）通过。
- `npm run build -w @aihot/web` 通过。
- `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13 项全过。
- `node --test apps/web/tests/nav-groups.test.ts`：5 项全过。
- CI 同款 standalone 集合（request-context、gp-core、experts、experts-search、sources-errors、source-check-abort、interests-state、provider-pages、platform-prompts、notifications-core、ilink-protocol、scan-state、knowledge-core）：55 项全过，其中新增「每个知识库有自己的键空间与 slug 空间」一项。
- `node scripts/check-doc-links.ts`：303 个本地链接全部可达。
- `node scripts/check-migrations.ts --base=origin/main`：新增的 5 条迁移均通过在线迁移词表检查（本机为 Windows 工作区，`core.autocrlf=true` 使已发布迁移与 `git show` 的字节比较全部报「immutable」，属本机换行差异，与本次改动无关；在 CI 的 Linux 检出下无此现象）。
- 新增 `modules/membership/tests/knowledge-bases.test.ts`（PostgreSQL 场景）：两个库各自建页、页面前缀、列表按库过滤、问答按库路由、共享库沿用旧 slug、库卡片计数、不存在的库被拒。已加入 CI 的 PostgreSQL 集成任务清单。
- 本机浏览器核对（生产构建的 web 进程 + 桩 API，Chrome 1440×900 与 390×844）：
  - `/experts` 卡片 3 张、页头「新增专家」、侧栏「专家平台」高亮；点卡片进入 `/experts/external-investment-landscape-xinhua-adapter`，详情有专家名、返回入口与提交表单。
  - `/knowledge` 卡片 2 张、页头「新增知识库」、侧栏「知识库」高亮；点卡片进入 `/knowledge/bases/shared`，详情有上传、构建状态、浏览检索与问答四块。
  - `/experts/new`、`/knowledge/bases/new` 均可达，表单字段齐全。
  - 窄屏下底部「我的」标签在 `/knowledge` 与 `/knowledge/bases/<id>` 上均点亮。
  - 控制台唯一的 404 是 `/favicon.ico`（改动前即有）。

## 未验证

- **PostgreSQL 场景测试未在本机执行**：本机没有可用的 PostgreSQL 或 Docker，`npm test` 与新增的 `knowledge-bases.test.ts` 只能由 CI 的临时数据库跑；改动后的 SQL（`base_id` 过滤、`UPDATE … FROM` 取 `base_id`、库内 `target_key`／slug 前缀）只经过人工核对与类型检查，未在本机跑过真实数据库。
- **多库的真实材料与真实模型调用未试跑**：编译器在多库下写出重复 slug、跨库引用等情形尚无真实材料可验证。
- **未合并、未发布**：按指示不在本 issue 部署火山云；生产迁移（5 条）与新页面在上线前需按发布流程执行。
- 未做读屏软件的实际朗读核对，只核对了 `aria-current`、标题层级与可聚焦顺序。

## 风险与下一步

- 共享库沿用旧键是兼容做法；若将来下线默认库，需要先把它的页面迁到新库并改写键与 slug（写入运行手册 §2.1）。
- 库目前没有独立的权限模型，任何已批准员工都能新建库并查看其他库；库数量上限 20 只是防止误建，不是授权。
- 下一步：评审通过后合并，按发布流程执行 `npm run db:migrate`（新增 5 条迁移）并发布 api 与 worker，再由用户用真实账号核对两个库的材料、页面与问答。

## 涉及文件

`apps/web/app/components/member-ui/card.tsx`、`modules/membership/module.ts`、`modules/membership/knowledge/bases.ts`（新增）、`modules/membership/knowledge/routes.ts`、`modules/membership/knowledge/publish.ts`、`modules/membership/knowledge/worker.ts`、`modules/membership/pages/experts.tsx`（重写）、`modules/membership/pages/expert-detail.tsx`（新增）、`modules/membership/pages/expert-new.tsx`（新增）、`modules/membership/pages/knowledge.tsx`（重写）、`modules/membership/pages/knowledge-base.tsx`（新增）、`modules/membership/pages/knowledge-base-new.tsx`（新增）、`modules/membership/pages/knowledge-target.tsx`、`modules/membership/pages/knowledge-document.tsx`、`modules/membership/tests/knowledge-bases.test.ts`（新增）、`modules/membership/tests/knowledge-core.standalone.test.ts`、`modules/membership/migrations/0176_…`～`0180_…`（新增 5 条）、`.github/workflows/p3-checks.yml`、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/KNOWLEDGE-OPS.md`、`docs/PROGRESS-REPORT.md`、`docs/README.md`、`docs/logs/2026-10-24-i36-expert-knowledge-cards.md`（新增）。

## PR #38 复审修复（2026-10-24）

- 首轮意见：[PR 评论](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/38#issuecomment-6371815269)，审阅版本 `341ec58`。提交者在意见之后提交 `d6b231d`，将两处数组比较改为内容比较，进入第二轮复审。
- 复审仍发现合法原始 slug 加知识库前缀后超过问答引用的 80 字符上限。按已授权流程直接修复：保持 Builder 原始 slug 上限 80，发布后的引用标识上限为 128，并要求模型原样复制完整标识；保留共享库旧地址，不截断或重写页面名。
- 数据库多库场景改用 70 字符原始 slug，实际经过上传、构建、发布、answers 路由以及引用校验；同时验证共享库旧地址。独立回归覆盖 80 字符原始名加库前缀及碰撞后缀后的 105 字符引用。
- 本地 knowledge-core 19/19、类型检查、Web 构建、306 个文档链接及 diff 空白检查均通过；最终 head CI 待完成后记录。数据库用例依赖 CI 临时 PostgreSQL，本环境未运行数据库。
- PR 尚未合并；未部署生产、未执行生产迁移，真实员工与真实模型验收仍待完成。P5-02～P5-04 勾选不变。
