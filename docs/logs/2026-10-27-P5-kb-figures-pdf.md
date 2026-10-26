# 2026-10-27 · 知识库图表证据 Phase 2（PDF 有界整页渲染）

- Agent：Pi（MiniMax-M3.1-Flash）
- 对应任务：`docs/IMPLEMENTATION.md` 的 KBIMG-05（完成）与 KBIMG-06（真实材料与真实模型验证，未做）
- 承接：`docs/PLAN.md` 与 `docs/KNOWLEDGE-OPS.md` 的锁定方案（Phase 2 = PDF 有界整页渲染，前 8 页，同一条证据协议）
- 完成状态：代码、fixture 与文档完成，**未合并、未部署**；开关默认关闭

## 本次改动

- 修改文件：
  - 新增 `modules/membership/knowledge/pdf-pages.ts`（受限渲染器：私有临时文件、可终止的渲染进程、单页与总预算、失败原因）、`modules/membership/knowledge/pdf-render-page.ts`（渲染进程里的那一页：读字节、画一页、写出图片）；
  - 新增 `modules/membership/tests/pdf-fixture.ts`（合成 PDF：文字页、只有图形的扫描页、任意页数）、`modules/membership/tests/knowledge-pdf-pages.standalone.test.ts`、`modules/membership/tests/knowledge-pdf-figures.test.ts`；
  - 改 `modules/membership/knowledge/extract.ts`（PDF 的总页数与文字层页码；扫描件与「读不出文件」分开；控制字符不进入正文）、`figures.ts`（图片清单分为网页与 PDF 两种；PDF 页图快照分支；覆盖度增加页级信息）、`worker.ts`（PDF 清单、扫描件的构建条件、只识别到封面即失败）、`render.ts`（页面「读取范围」区）、`aggregate.ts`（多材料时各材料自己的页级覆盖）、`routes.ts`（图片接口带定位）、`catalog.ts`（页级限额与新文案）、`pages/knowledge-document.tsx`（材料页显示页级覆盖）；
  - 改 `modules/membership/package.json`（新增依赖 `@napi-rs/canvas@1.0.13`）、`package-lock.json`、`Dockerfile` 与 `Dockerfile.volcengine`（字体包）、`.github/workflows/p3-checks.yml`（两个新测试入 CI）；
  - 文档：`docs/KNOWLEDGE-OPS.md`（§14 增补 PDF 阶段与 §14.10）、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`（KBIMG-05／06）、`docs/README.md`、`README.md`；新增员工端待发布条目 `site/changelog/pending/kb-figures-pdf.json`。
- 实际完成：
  - **PDF 走同一条证据链**：PDF 字节 → 受限渲染器把前 8 页画成位图 → 与网页图片同一套规范化（最长边 1600 px、单张 ≤1 MiB、合计 ≤8 MiB）→ 同一张快照表 → `readFigures` → `verifyFigures`（独立上下文）→ 编译器只选 `figureRefs` → lint → 原子发布。文字层仍按原有 60,000 字符上限抽取，页锚点保留。
  - **有界整页渲染**：只支持原有文件大小限额内的 PDF；自动视觉处理前 8 页；每页最多一张图，与网页图片共用 8 张与 8 MiB 的额度；渲染并发 1；单页 10 秒；整个渲染阶段 90 秒；渲染进程初始堆预算 512 MiB，超限退出并降级。
  - **可终止的独立进程**：每页一个渲染进程（`--max-old-space-size=512`），父进程可随时终止；材料字节先写入仅本人可读的临时文件，渲染结束后删除。
  - **降级是明说的**：渲染失败（超时／堆超限／页不存在）记为「未能渲染」并写明原因；超出 8 页或预算用尽的页记为「未做页面识图」。`figureCoverage` 区分**文字层覆盖**与**页面识图覆盖**，页面新增「读取范围」区，材料页同步显示。
  - **构建成功条件**：扫描件（没有文字层）只有在取得通过复核的图像证据时才继续构建；仅识别到封面（第 1 页）不算成功，构建以 `knowledge_pdf_cover_only` 失败。长 PDF 在页面上写明「本次为部分读取，不代表整份材料的完整理解」。
  - **开关复用**：沿用 `MEMBER_KNOWLEDGE_FIGURES_ENABLED`（默认关闭）＋ `MODEL_CALLS_ENABLED` ＋ `LLM_VISION`；关开关时 PDF 只按文字层构建并说明「本次未做页面识图」，行为与 Phase 1 一致。
- 关键决定及理由：
  - **渲染依赖只补同一条**：现有 PDF 栈是 `unpdf`（其画布 peer 为可选依赖）。取证后只补 `@napi-rs/canvas@1.0.13`，**没有引入第二个 PDF 栈**（不加 pdf.js、不加 poppler、不加别的画布）。
  - **取证先行**：先在 Node 24 + Linux（生产镜像基座 `node:24-trixie-slim`，amd64 与 arm64）验证 `unpdf` 的 `renderPageAsImage` 可用，再用生产镜像构建实测：页图 1224×1584、页面有墨迹（3179 个深色像素），证明依赖在镜像里可加载且页面上确实画出了内容。
  - **生产镜像缺字体，必须补最小补丁**：实测没有字体时页面的**字一个都画不出来**（深色像素 0，矢量图形仍在），补 `fontconfig`、`fonts-liberation`、`fonts-wqy-microhei` 后文字正常绘制。两个 Dockerfile 都已加，并在注释里写明原因。
  - **整页而不是抽内嵌图**：研报图表多为矢量绘制，没有独立图片对象；整页保留图题、坐标与脚注所在的版面，代价是小字可读性有限。
  - **一页一个进程**：这样「单页 10 秒」是可执行的硬约束（父进程到点即杀），而不是靠子进程自觉；代价是每页约 0.2～0.3 秒的进程启动开销。
  - **控制字符不进正文**：合成 PDF 的文字层带出了 0x02／0x04 等控制字符，直接写库会报 `invalid byte sequence for encoding UTF8`；现在提取阶段统一清掉控制字符（保留换行与制表符）。
  - **页级覆盖挂在覆盖度里**：页级信息跟着材料走（`figureCoverage.pages`），合并页面时按材料分别保留，不把不同材料的页码混在一起。
  - **员工文案**：只写「读取页面／部分页面未处理」，无供应商品牌名，不写「完整／精确」。

## 最小验证

- `npm run typecheck`：通过（contracts／backend／api／worker／tests／modules／web）。
- `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-pdf-pages.standalone.test.ts`：10/10 通过（页面在独立进程里被画出、图片尺寸符合上限、不存在的页失败、慢页被终止、文字层给出页码、扫描件只有页数没有字、清单最多 8 页、覆盖度区分文字页／已渲染页／失败页／未覆盖页、页码区间写法、页面「读取范围」区、读全的材料不自称部分读取）。
- `DATABASE_URL=… nf_kb_charts_pdf_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/knowledge-pdf-figures.test.ts`：1/1 通过（开关关闭时零页图、零视觉调用；开关打开时两页都画出来并带页码定位；覆盖度区分文字页与页图页；发布的页面含「读取范围」与部分读取声明；只识别到封面的扫描件以 `knowledge_pdf_cover_only` 失败）。
- `… --test modules/membership/tests/knowledge-figures.test.ts`（Phase 1 回归）：1/1 通过（复核拒绝的数字仍不成为事实）。
- `… --test modules/membership/tests/knowledge-core.standalone.test.ts`：35/35 通过。
- 生产镜像实测（本地构建 `node:24-trixie-slim` amd64）：镜像内渲染一页 PDF 成功，输出 1224×1584、深色像素 3179（无字体时为 0）。
- `node scripts/check-migrations.ts --base=origin/main`：通过（**本 PR 无新迁移**，复用 `0194`～`0196`）。
- `node scripts/check-doc-links.ts`：通过。
- `git diff --check`：通过。
- `npm run changelog:check`：**按预期失败**（功能 PR 必须保留待发布 JSON `kb-figures-pdf.json`，发布阶段再应用）。

## 风险与交接

- 未验证：
  - **真实研报与真实模型未验证**：本轮只用合成 PDF 与本地模型桩。中文研报（几十页、矢量图表、内嵌字体）的页面渲染质量与真实模型对页图的读图质量都未验证；同一模型两次识图可能产生相关错误，不能替代人工数值核验。KBIMG-06 与 KBIMG-04 因此保持未勾选，P5-02～P5-04 状态不变。
  - 未运行完整 `npm test`（全部数据库集成测试）与完整 `npm run test:standalone` 全量套件；只跑了上列定向检查。
  - 未在生产或员工会话下验收；本轮不合并、不部署。
- 已知限制：
  - 页图是小字可读性有限；本阶段不做长图切片，也不做 PDF 页码由用户选择。
  - 内存预算约束的是渲染进程的 JS 堆；原生（画布）内存不受该标志约束，因此另有单页 10 秒与整份 90 秒的硬时限。
  - 渲染进程只读一个私有临时文件，不做任何网络访问；PDF 里的 JavaScript 不执行、外部资源不加载、附件不执行——这些是 pdf.js 与本平台代码的性质，不是运行时强隔离的证明。
  - 页图与原图长期留在库里（不适用专家任务的 7 天清理），备份体积随之增长。
  - 回退代码前先停止相关新任务；关闭 `MEMBER_KNOWLEDGE_FIGURES_ENABLED` 是更安全的回退路径。
- 下一步：PR 评审与合并（**本轮不合并**）→ 生产发布（含字体包；旧镜像没有字体时页面上只有图形没有字）→ 打开开关前确认 `LLM_VISION=true` → 用获准的真实研报做少量真实模型验证，逐项核对单位、期间、数值、图文冲突与来源归属 → 再决定是否勾选 KBIMG-06。
- 本 PR 不合并、不部署；不打开生产 `MEMBER_KNOWLEDGE_FIGURES_ENABLED`。
