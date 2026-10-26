# 2026-10-27 · 知识库图表证据 Phase 1（公开网页配图）

- Agent：Codex（gpt-6-sol，中途达用量上限）→ Pi（MiniMax-M3.1-Flash，接手同一工作树继续）
- 对应任务：`docs/IMPLEMENTATION.md` 的 KBIMG-01～KBIMG-04（KBIMG-04 只完成 fixture、文档与开关部分，真实模型验证待做）
- 完成状态：代码、fixture 与文档完成，待 PR 评审、合并、部署与真实样例验证

## 本次改动

- 修改文件：
  - 新增 `modules/membership/knowledge/figure-model.ts`（读图与图表复核的提示词、schema 与回执）、`modules/membership/knowledge/figures.ts`（候选校验、快照、检查点、预算、覆盖度）、`packages/backend/src/media/knowledge-figure.ts`（严格解码与规范化）；
  - 改 `modules/membership/knowledge/fetch-url.ts`（正文容器优先级、配图候选与上下文、短正文判定后移）、`compile.ts`／`prompts.ts`（编译器与复核者的图表引用约束）、`schema.ts`／`normalize.ts`／`lint.ts`／`aggregate.ts`／`render.ts`／`publish.ts`／`worker.ts`／`routes.ts`／`catalog.ts`（草稿协议、引用、页面「图表证据」区、图片接口、限额与文案）、`modules/membership/pages/knowledge-document.tsx`（材料页图表区）；
  - 改 `packages/backend/src/providers/llm.ts`（`maxRequestBytes` 与 `modelSupportsVision`）、`packages/backend/src/editorial/models.ts`（保留原导出兼容）；
  - 新增迁移 `0194_member_wiki_figure_manifest.sql`、`0195_member_wiki_figure_assets.sql`、`0196_member_wiki_figure_checkpoint.sql`；
  - 新增测试 `modules/membership/tests/knowledge-figures.standalone.test.ts`、`modules/membership/tests/knowledge-figures.test.ts`，改 `knowledge-access.test.ts`（图片接口的鉴权与 `no-store`）、`knowledge-core.standalone.test.ts`；
  - 文档：`docs/KNOWLEDGE-OPS.md`（新增 §14）、`docs/PLAN.md`（§12 图表证据范围与调用次数）、`docs/IMPLEMENTATION.md`（KBIMG-01～04）、`docs/README.md`、`README.md`、`.env.example`、`.github/workflows/p3-checks.yml`；新增员工端待发布条目 `site/changelog/pending/kb-figures-html.json`。
- 实际完成：
  - 公开网页与公众号正文的配图进入完整链路：抓取（`guardedFetch({publicOnly:true})`）→ 正文容器优先级（`#js_content` → `article` → `main`／`[role=main]` → body）→ 配图候选（优先有效 `data-src`，其次懒加载属性与 `srcset`，最后 `src`；相对地址按最终响应 URL 解析；保留图注与上下文；候选上限 40 并标记截断）→ 下载并冻结图片快照（原图 + 规范化 JPEG）→ `readFigures`（每批 ≤2 张）→ `verifyFigures`（独立上下文，只接受或撤回）→ 编译器只选 `figureRefs` → 文本复核者与 lint → 原子发布图表证据、页面与引用。
  - 限额按锁定方案：候选 40、下载尝试 12、单图 4 MiB、下载总预算 24 MiB、进视觉 8 张、规范化合计 8 MiB（单张 ≤1 MiB、最长边 1600 px、≤200 万像素）、视觉请求 ≤8、阶段 480 秒、每次模型请求体 ≤8 MiB。
  - 覆盖度由程序统计（候选／处理／有证据／无法辨认／未处理、是否截断），状态 `complete`／`partial`／`unavailable`／`legacy_text_only`；页面与材料页写明真实范围，不显示为全部识别。
  - 降级：图片失败只跳过该图；视觉调用被拒、输出无效或结果未知时该批不贡献事实且不重复付费；开关关闭或模型不能看图时不发图片请求、正文照常构建并说明「本次未读取图片」；正文不足 80 字且无通过复核的图表证据时构建失败（`knowledge_content_empty`），不生成空页面；没有图片清单的历史链接版本保持 `legacy_text_only`，普通重试不补图。
  - 鉴权接口：`GET /versions/:id/figures` 返回有界元数据、覆盖度与锚点；`GET /versions/:id/figures/:figureId/content` 返回规范化字节，校验图片属于该版本并联表判断材料状态，带 `private, no-store` 与 `nosniff`；撤回后不再共享。
- 关键决定及理由：
  - 采用「先冻结快照、再读图、再独立复核」的顺序：编译器、图表复核与最终复核读的是同一版本、同一批字节；草稿与复核结果带 `evidenceDigest`，与当前证据不一致时停止构建而不是复用旧草稿。
  - 检查点、覆盖度与证据摘要改用**稳定序列化**（键排序后取哈希）计算：检查点存在 JSONB 里，键顺序不保留，普通哈希会在重跑时漂移，导致恢复被误判为「证据被换」。
  - 下载预算按**实际读到的字节**计（单次下载上限 4 MiB，且不超过剩余预算），失败按次数计：早期版本每张图先预扣 4 MiB，实际只能取到 6 张，与「12 次下载尝试」的上限不符。
  - 读图与复核是两次独立调用（不同 subject、提示词版本与系统提示），复核只能接受或撤回，不能新增事实；图表结论不写入 `consensus`。
  - 模型能力判断下沉到 provider（`modelSupportsVision`），`editorial/models.ts` 保留原导出兼容，知识库模块不再依赖 editorial 模块。
  - 图片 MIME 判断放宽为「声明为文本的类型直接拒绝，其余按文件头与解码器判断」：CDN 常以 `application/octet-stream` 送图，按头部拒绝会误伤真实图片。
  - 员工文案统一为「读取图表／图表复核／部分图片未处理」，不出现供应商品牌名。

## 最小验证

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-figures.standalone.test.ts`：13/13 通过（公众号 `data-src` 与真图选择、同地址去重、候选上限与截断、body 回退、短正文存活、SSRF 地址拒绝、严格解码与长图拒绝、限额一致、复核拒绝即非事实、图片与上下文是数据、归一保留 `figureRefs`、lint 拒绝伪造与跨图 ID、多材料图号不混淆、未读图与历史版本的两种口径）。
- `DATABASE_URL=… nf_kb_charts_html_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/knowledge-figures.test.ts`：1/1 通过（开关关闭时零模型调用；三张图分两批读图与复核；只有被接受的事实成为证据；覆盖度为 `partial`；重跑不再调用模型；构建发布的页面含「图表证据」区、被拒事实不出现）。
- `… --test modules/membership/tests/knowledge-access.test.ts`：1/1 通过（含图片接口的 401／200、`private, no-store`、`nosniff`、跨版本不可读、撤回后不可读）。
- `… --test modules/membership/tests/knowledge-core.standalone.test.ts`：35/35 通过。
- `node scripts/check-migrations.ts --base=origin/main`：通过。
- `node scripts/check-doc-links.ts`：通过。
- `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：通过（`MEMBER_KNOWLEDGE_FIGURES_ENABLED` 已写入 `.env.example`）。

## 风险与交接

- 未验证：
  - **识图质量未经真实模型验证**：本轮只用本地模型桩与合成图片，真实模型对单位、期间、数值、图文冲突与来源归属的判断仍需逐项核对；同一模型两次识图可能产生相关错误，不能替代人工数值核验。因此 KBIMG-04 保持未勾选。
  - 未对真实公众号／CDN 发起抓取：防盗链、反爬与真实站点覆盖率未验证；未在生产或员工会话下验收。
  - 未运行完整 `npm test`（全部集成测试）与 Docker 镜像构建；本轮只跑了上列定向检查。
- 已知限制：
  - 只覆盖公开网页／公众号的静态配图；PDF 页面渲染、Markdown 远程图片、旧 URL 显式刷新、长图切片都不在本阶段（Phase 2 的 PDF 整页渲染另开 PR）。
  - 页面只显示规范化后的图片；原图字节长期在库里，备份体积随之增长。
  - 回退代码前先停止相关新任务：旧代码不会渲染新增字段，「迁移是追加的」不等于回滚无损；关闭 `MEMBER_KNOWLEDGE_FIGURES_ENABLED` 是更安全的回退路径。
- 下一步：PR 评审与合并 → 生产迁移（`0194`～`0196`）与发布 → 在火山云打开 `MEMBER_KNOWLEDGE_FIGURES_ENABLED` 并确认 `LLM_VISION=true` → 用获准的公开样例做少量真实模型验证 → Phase 2 的 PDF 有界整页渲染另开 PR。
- 本 PR 不合并、不部署；P5-02～P5-04 的真实员工验收状态不变。
