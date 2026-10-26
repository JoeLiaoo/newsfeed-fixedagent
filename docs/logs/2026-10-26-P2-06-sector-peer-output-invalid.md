# 2026-10-26 · P2-06 赛道同业看板整理输出不可用

- Agent：pi
- 对应任务：P2-06 生产故障维护（不对应 P0–P4 新任务）
- 完成状态：完成（代码与定向验证）；未合并、未部署、未做真实员工复测。

## 本次改动

- 修改文件：
  - `modules/membership/experts/sector-peer-board.ts`（新增）：看板读取器。逐栏目宽松读取模型回答——缺失或读不出的栏目保持空并写明，读不出用处的结论略过并计数，过长的句子截断，来源只认本次检索到的编号。
  - `modules/membership/experts/sector-peer-html.ts`：看板类型改为从读取器引入，渲染逻辑不变。
  - `modules/membership/experts/worker.ts`：整理请求不再用严格 zod 结构判生死（改为 `z.unknown()`，由读取器判读）；模型完全不可用时给出空看板而不是让任务失败；提示词补「五个键都要出现」「sourceIds 只写本次检索给出的编号、最多 8 个」「text 控制在 400 字以内」，提示词版本升至 `sector-peer-public-search-1.0.2`。
  - `modules/membership/tests/sector-peer-board.standalone.test.ts`（新增）：回归用例，固定住本次失败的回答形状。
  - `.github/workflows/p3-checks.yml`：新用例加入 CI 的 quality 步骤。
  - `site/changelog/pending/sector-peer-board.json`（新增）：员工端更新日志待发布条目。
  - 文档：`README.md`、`docs/README.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md` 与本日志。
- 实际完成：整理环节不再因单条结论的来源数量、栏目缺失或句子过长而作废整份看板；证据边界不变。
- 关键决定及理由：
  - 只放宽格式，不放宽证据。结论的来源必须来自本次检索；「美国参考」只认美国来源，其他三个栏目不认美国来源；不成立的结论略过并计数，写进「检索缺口」，而不是静默消失。
  - 单条结论的来源上限由 4 放宽到 8（生产里模型引用了 5 个），超出按前 8 个展示并写明。
  - 模型完全不可用（连 JSON 都没有）时不再让任务失败：看板保留已检索到的来源与缺口，四个事实区为空并在缺口里写明原因。模型未配置、被供应商拒绝、调用结果未知仍按原口径失败并提示员工或管理员。
  - 提示词与逻辑请求变了，提示词版本随之升到 1.0.2，避免旧的模型收据身份被复用。

## 现象与定位（生产只读核对）

- 2026-10-26 08:26 CST 的员工任务（赛道同业竞争看板，查询 `recursive self improvement`）失败：`error_code=expert_model_output_invalid`，`execution_attempts=1`，页面显示「文字整理模型返回的内容无法使用」。核对为只读：未写入生产，未读取或记录原始检索响应、模型原文、查询词以外的账号资料。
- 四条 `expert_search` 收据与一条 `expert_fetch` 收据均为 `received`；唯一的模型收据（`llm`／`deepseek-flash`／`expert`）为 `failed`，`finish_reason=stop`、输出未被截断，错误是结构校验：唯一问题是 `peers[7].sourceIds` 超过上限（`too_big`，maximum 4）。
- 同一份模型回答里 peers 10、stageSignals 7、capitalEvents 4、usReferences 9、gaps 5 都可读；被拒绝的只是「一条结论引用了 5 个来源」。
- 证据并不薄：四组检索各返回 5 条结果，17 个来源有可访问 URL 与正文；英文查询没有造成证据不足，也没有触发语言相关的判定。
- 重试会走同一条路径：检索收据为 `received`，重试时复用、不再计费；模型收据为 `failed`，会以同一提示词、同一温度 0 再调一次，同一超限仍会被同一上限拒绝，因此「可稍后重试」对这个失败无效（页面显示的尝试次数为 1/3）。

## 最小验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/sector-peer-board.standalone.test.ts`：10/10 通过。回归用例用生产回答的形状（10／7／4／9／5，其中一条引用 5 个来源）固定住失败形状：断言旧结构仍拒绝它并指出问题路径，新请求接受它，读取器给出 10／7／4／3 的看板。
- 用生产收据里的真实模型回答与真实来源在本地内存中跑新的读取器（未写入仓库、未打印原文）：得到 peers 10、stageSignals 7、capitalEvents 4、usReferences 3，缺口 6 条（含 6 条「美国参考」结论引用了中国来源而被略过的说明）；渲染出的 16 个链接全部来自本次检索的来源，没有模型自带的链接。
- `node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`：174/174 通过。
- `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13/13 通过。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：通过。

## 未验证、风险与下一步

- 未调用真实模型、未重跑员工任务、未部署。供应商当前配置、额度与输出质量仍需上线后核对；发布后的真实任务才算业务验收。
- 旧失败任务不会自动恢复；发布后由任务所有者在页面重试。提示词版本已变，重试会产生新的模型收据；检索收据复用，不重复计费。
- 一次公开网页检索被供应商拒绝时任务仍会失败（`expert_search_rejected`），本次未改这条路径。
- 「美国参考」的判定规则未改：模型把中国来源写进该栏目时整条略过，只增加了缺口说明。
- 下一步：评审并合并本 PR；发布后用同一查询词跑一次真实任务，核对看板内容、逐项来源链接、缺口说明、收据与费用。
