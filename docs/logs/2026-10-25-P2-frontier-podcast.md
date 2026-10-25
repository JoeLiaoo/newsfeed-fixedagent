# 2026-10-25 · 前沿播客专家（公开播客检索 + beautiful-article 网页摘要）

- 对应任务：Joe 2026-10-25 决定的第三个可运行内置专家「前沿播客」；本项是专家平台维护，不改变 P2-05 全景图或 P5 知识库的真实业务验收勾选。
- 状态：工作分支完成代码与本地聚焦检查，待 PR 评审；未合并、未部署、未做真实员工试用。

## 做了什么与修改文件

- `modules/membership/experts/bidclub.ts`（新增）：公开播客文字库的服务端客户端。固定主机 `https://bidclub.ai`，只发普通 GET，不需要账号、密钥或配置；检索 `/api/v1/search`、单集 `/api/v1/episodes/:slug`、该集摘要文件 `/dl/:slug/summary.md`。字段按服务实际返回读取：没有的字段保持缺失（页面写「未提供」），中文文本优先，另一种语言保留并标注语言名；单集读取失败不打断其他集，失败集数与失败原因随结果返回。
- `modules/membership/experts/frontier-podcast-view.ts`（新增）：两种呈现共读的一份事实——同一批节目、同一组上限、同一句覆盖范围与集数说明。
- `modules/membership/experts/frontier-podcast-html.ts`（新增）：网页预览。按 beautiful-article / reacticle 的 `press`（书卷）主题生成**单文件静态 HTML**：报头（Hero）、导语（Lead）、覆盖范围提示（Callout）、目录、一集一节（章节号 + 标题 + 元信息 + 导语引文 + 来源提示 + 要点 + 摘要）、使用说明（Conclusion）与版记（Colophon）。样式是主题 token 的内联 CSS（`--ra-*`），没有脚本、外部样式表、外部字体与外部图片；文档自带的 CSP 是 `default-src 'none'; style-src 'unsafe-inline'`。
- `modules/membership/experts/frontier-podcast-markdown.ts`（新增）：Markdown 产物，保留每集的完整要点与摘要、来源与限制说明。
- `modules/membership/experts/catalog.ts`、`routes.ts`、`seed.ts`、`worker.ts`：新增内置专家「前沿播客」（slug `frontier-podcast`，执行模式 `podcast_search`）；任务只收一个话题（2–100 字），不做主体确认、不收材料；worker 领取任务后读取公开库并写出网页摘要与 Markdown 产物，过程不调用模型、新华财经或其他数据源。
- `modules/membership/pages/expert-detail.tsx`、`experts.tsx`：详情页只显示一个「话题」输入框与一句说明；任务完成后在**与赛道同业看板同一个沙盒 iframe**（`srcDoc` + `sandbox=""`）里展示网页摘要，同时保留 Markdown 下载；结果不完整时卡片上另给一条提示。
- `modules/membership/tests/frontier-podcast.standalone.test.ts`、`frontier-podcast-db.test.ts`（新增）：库读取与映射、中文优先与另一语言、检索拒绝、摘要上限与失败计数、网页结构与转义、无脚本与无外部资源、主题 token、Markdown 产物、任务全链路（提交 → worker → 结果 → 产物下载）与失败原因。
- 文档：`docs/PLAN.md`（v0.84）、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/PROGRESS-REPORT.md`、`README.md`、`docs/README.md` 与本日志。

## 关键决定与理由

- **版式与 beautiful-article 一致，但不把 React 运行时塞进 iframe。** 任务卡片的预览是 `sandbox=""` 的 iframe，没有脚本与同源权限，也不能取外部资源；因此产物是任务时生成的内联 CSS 单文件，而不是 Vite/React 打包。视觉语言照 reacticle 的 `press` 主题：奶油纸底 `#fbf7ee`、墨色 `#211e18`、氧化血红主色 `#7b1e22`、衬线正文（Georgia → Songti SC）、零圆角零投影、以线代框。
- **三处按运行环境做的取舍，并记录在此：**①没有 3:4 封面（CSP 不允许任何图片，680px 高的框也放不下书封），报头即是题面；②没有左侧目录栏（框宽多在 700px 上下），目录以「书前目录」的形态排在正文列里，条目可点；③不加载 webfont（沙盒不能取外部字体），用系统衬线栈，斜体按 press 协议丢弃——强调只用字重与规则线。
- **只呈现库里已经写下的内容。** 要点与摘要是公开播客文字库对原节目的整理稿，平台没有逐条核验，因此报头、导语、每集的来源提示和文末都写明这一点；平台不补写节目未提及的事实、数字与结论，也不把入库时间当作事件时间。缺失字段写「未提供」。
- **「结果不完整」按服务说的写。** 实测该库对所有查询（含精确标题）都返回 `partial: true` 与 `searched_recent: 300`，即检索回退到最近 300 集的子串匹配；网页摘要、Markdown 与任务卡片三处都写明这一口径，并说明目录即本次命中的全部内容。收录集数受接口匹配结果限制，不等于该话题的全部节目。
- **读不到节目与「没有匹配」分开说。** 每集读取失败会被计数并随结果返回；当所有节目都读不到时，任务报出的是具体原因（服务不可用／超时／返回无法解析／该集已不在库中），而不是「没有匹配到节目」，避免把服务故障读成话题为空。
- **摘要设上限。** 一次任务最多 6 集、每批并行 3 集；网页预览里要点与摘要各取前 1200 字并在截断处写明，Markdown 产物保留每段至多 20000 字的全文。真实调用观察到该库单次请求在 0.4～7 秒之间波动，检索与单集的读超时因此放宽到 20 秒（原来 8／12 秒会误报超时）；任务租约每 30 秒续期，长读取不影响心跳。
- **内置专家不要求写任务要求。** 复核时发现统一「非话题类专家必须写备注」的判定会波及「对外投资全景图」，已改为按内置专家与话题类专家分别判定，备注要求只留给导入的自定义专家（既有 `experts-access` 用例当时即报出该回归）。
- **员工端更新日志不写本功能。** 按仓库既有做法（见[员工端更新日志补齐](2026-10-25-employee-changelog.md)），待合并或未发布的功能不写成已交付；该条目随实际发布记录补记。

## 最小验证与结果

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`：132/132 通过（含新增 12 项）。
- 一次性本地 PostgreSQL：`node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test "modules/membership/tests/*.test.ts"`：152/152 通过（含新增的播客全链路用例；既有专家目录、隐藏入口、访问隔离与全景用例一并回归）。
- `npm run test:standalone`（全仓）：360 项中 344 通过、16 项失败；这 16 项在未改动的 `main` 工作树上同样失败（公开站点的分享卡、feed 与元数据用例，需要已构建的站点服务），与本次改动无关。
- 真实调用（开发机、未在生产）：`GET https://bidclub.ai/api/v1/search?q=具身智能` 返回 2 条，`partial=true`、`searched_recent=300`；`GET /api/v1/episodes/latetalk-2026-09-24-182-ai` 返回 `tldr_md`、`digest_md` 与 `lang_alt=EN`；`GET /dl/latetalk-2026-09-24-182-ai/summary.md` 返回该集 Markdown。渲染出的网页摘要在 Chrome 中按 900px 与 700px 两种宽度目视核对过版面（报头、目录、章节、引文、提示框、文末版记）。
- `node scripts/check-doc-links.ts`：通过（本地 Markdown 链接均存在）；`git diff --check`：通过。

## 未验证事项、风险与下一步

- 未在生产或真实员工账号验证目录、提交、预览与下载；未做手机端真机核对。
- 沙盒 iframe 不给 `allow-popups`，预览里的来源链接点开不会新开标签页，因此每集的来源地址与摘要文件地址都以文字形式印在提示框里，便于复制后自行打开；这一交互尚未在真实账号里核对。
- 网页摘要随任务 `result` 一并返回（与赛道同业看板同一做法），6 集满编时 HTML 约 30～60 KB；任务列表会重复携带这段 HTML，若后续集数或篇幅上调，应改为独立的鉴权预览流。
- 公开库的服务条款、数据授权与长期可用性未核实；本次只按公开 HTTP 接口读取。
- P2-05 与 P5 的真实业务验收状态不变；本分支不合并、不部署。

## 下一步

- 评审 PR 后再由独立发布流程部署，并在生产核对目录播种、一次真实任务、网页摘要与 Markdown 下载；随后补记员工端更新日志条目与发布日志。

## CI 修复（PR #87，2026-10-25）

- 现象：PR #87 的 quality 检查在 `npm run typecheck` 阶段失败，报 `modules/membership/experts/routes.ts(114,28)` 等三处 `Argument of type 'unknown' is not assignable to parameter of type 'string'`。请求体里的 `slug` 是 `unknown`，上一轮把「备注要求」的判定从 `slug !== EXPERT_SLUG && …` 改成集合判定时，直接把它传给了 `Set.has`，本地那次 typecheck 跑在这处改动之前。
- 修改文件：`modules/membership/experts/routes.ts` 先把 `slug` 收成 `slugText`（非字符串时为空串），集合判定与输入构造都用它；行为不变，仍是内置专家与话题类专家不要求写备注。
- 最小验证与结果：`npm run typecheck` 通过；`modules/membership/tests/*.test.ts`（一次性本地 PostgreSQL）152/152 通过，`modules/membership/tests/*.standalone.test.ts` 132/132 通过；其余检查结果见上。
- 未验证事项：未在本地完整复现 CI 的全部任务，以 GitHub Actions 重跑结果为准；本分支不合并、不部署。
