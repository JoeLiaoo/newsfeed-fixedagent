# 2026-10-24 P2-05 对外投资全景图专家

- Agent：pi coding agent
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P2-05（新增，代码在 PR #48，未合并、未部署）
- 完成状态：部分完成（代码、测试与文档已就绪；真实环境验收未做）

## 本次改动

- 修改文件：
  - `modules/membership/experts/panorama.ts`：参考 skill 的三条终止条件与六条穿透规则，映射到平台允许调用的工具；主体类型、基金/投资类判定、控制口径（单一持股与关联方合并）、例外1/例外2、噪声与存在性判定，全部为纯函数。
  - `modules/membership/experts/panorama-run.ts`：逐层下钻的执行器（层级/主体数/调用次数/单节点处理数四重预算）、曾用名校验、年报交叉核验、逐节点缺口记录。
  - `modules/membership/experts/panorama-markdown.ts`：底稿渲染（逐层投资明细、有限合伙份额链、结构树、全景汇总、已退出部分、年报交叉、缺口清单、采集台账、摘要、待核事项）。
  - `modules/membership/experts/panorama-checkpoint.ts`：断点续跑台账的读写与 JSONL 导出。
  - `modules/membership/experts/catalog.ts`：新增内置专家「对外投资全景图」（slug `outbound-investment-panorama`），能力优先文案；`XINHUA_USED_TOOLS` 扩到平台实际调用的八项能力，另留 `XINHUA_BASE_TOOLS` 供一层适配器与导入校验使用。
  - `modules/membership/experts/worker.ts`、`routes.ts`、`import.ts`、`modules/membership/pages/experts.tsx`、`expert-detail.tsx`、`expert-new.tsx`：新执行模式 `xinhua_panorama`、内置专家播种、采集台账下载路由、导入模式说明与页面文案。
  - `modules/membership/migrations/0183_expert_panorama_checkpoints.sql`、`0184_expert_panorama_checkpoints_task_idx.sql`：台账表与索引。
  - `modules/membership/tests/panorama.standalone.test.ts`、`modules/membership/tests/panorama-db.test.ts`：规则、预算、缺口、断点续跑、实体确认与文案测试。
  - `docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`docs/PLAN.md`、`docs/README.md`、`README.md`、`.github/workflows/p3-checks.yml`。
- 实际完成：
  - 按 Joe 2026-10-24 的决定（`adapt-full-rules-xinhua`）实现「保留规则、缺什么写什么」：终止条件与穿透规则全部保留判断顺序，凡平台无对等工具的规则，写成底稿中的显式缺口，不跳过、不补造。
  - 多层下钻用平台已授权的八项能力：主体画像、对外直接投资、股东信息、注销吊销信息、历史名称、年报基础信息、年报对外投资（外加主体名称候选检索用于确认主体）。
  - 预算：默认层级 4、主体 25、调用 90 次、单节点处理 20 条；触及上限时底稿标注「结果不完整」并列出未处理关系。
  - 断点续跑：台账按（任务，主体，读取类型）落库，重试时复用已读结果；台账可由本人下载为 JSONL。
  - 保留「企业一层对外投资核查」，两个内置专家并存（一层 + 全景），未做替换。（2026-10-24 追加：按 Joe 的决定，一层专家的内置目录入口改为隐藏，目录只挂全景图；见[隐藏一层专家入口的工作日志](2026-10-24-P2-05-hide-one-layer-entry.md)。）
- 关键决定及理由：
  - **不替换一层专家**：一层核查的既有验收记录与文案已上线，替换会打断已记录的口径；全景作为第二个内置专家并列提供。
  - **有限合伙按未备案分支穿透**：平台没有基金备案工具，带基金字样的有限合伙按规则3即止（不披露其组合），不带基金字样的按未备案分支继续下钻，出到公司即止；两条路径都在底稿写明「备案未由平台工具确认」。
  - **控制口径缺股东名单时不继续下钻**：股东名单是判断第一大股东与关联方合并的唯一依据，取不到时该分支停止并写成缺口，而不是猜一个比例。
  - **上市公司只作弱信号**：登记经济类型含「上市」即按规则5停止下钻，并标注证券代码与上市地未确认。
  - **导入技能只声明部分全景能力时按一层执行**：不静默扩大执行面，导入说明与依赖提示同步更新。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`：通过。
  - `node --import ./tests/standalone.ts --test "modules/*/tests/*.standalone.test.ts"`：81 项通过（含新增 14 项）。
  - `node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/experts-access.test.ts modules/membership/tests/panorama-db.test.ts modules/membership/tests/access-contract.test.ts`：3 项通过（本地一次性 PostgreSQL，库名 `newsfeed_test`）。
  - `node scripts/check-doc-links.ts`：通过。
  - `node scripts/check-migrations.ts --base=origin/main`：通过（新增两条模块迁移，命名与在线安全词汇符合要求）。
- 未执行或需用户试用的检查：
  - 未对生产环境新华财经 MCP 做真实调用，未产生真实全景底稿；样例主体「杭州市国有资本投资运营有限公司」的真实连通与多层结果待部署后由用户验收。
  - 未在真实模型上验证摘要质量；单测用固定文案覆盖引用编号校验。
  - 未做多员工并发任务下的台账写入压力验证。

## 风险与交接

- 已知限制／缺失依赖：
  - 基金备案状态、备案号与私募基金管理人登记无对等工具；带基金字样的主体按「备案未核」处理。
  - 历史退出（转让、定向回购、上市减持）与接手股东无对等工具；已退出表只列登记状态可证实的注销或吊销，年报披露只作辅助披露时间。
  - 关联方关系证据未接入，合并口径按本次图谱内主体近似计算，已在底稿与文档中写明。
  - 上市公司识别只有登记经济类型这一弱信号。
  - 投资发生日期仍无对等工具：认缴出资日期、数据日期、年报披露日期不得互相替代。
  - 参考 skill 的三类终止主体附件机制（上市/备案基金/管理人专项分析）不在本次范围内，命中时底稿只留停止标签，未生成附件。
- 下一步：
  - 评审并合并 PR #48 后，按 `docs/P2-EXPERT-ADAPTER.md` 的样例主体做一次真实连通抽测，记录调用次数与缺口表现，再决定是否调整默认预算。
  - 真实员工验收后再勾选 P2-05；本次不合并、不部署。
