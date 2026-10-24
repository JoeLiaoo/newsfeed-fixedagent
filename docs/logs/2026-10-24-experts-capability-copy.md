# 2026-10-24 专家平台能力优先文案

- Agent：coding 助手
- 对应任务：维护任务（不对应 P0–P4 勾选）；P2 专家平台展示文案
- 完成状态：代码与文档修订完成；[PR #47](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/47) 已创建，未合并、未部署

## 首轮改动（PR #47 首次推送，head `628f9a9`）

- 修改文件：
  - `modules/membership/pages/experts.tsx`：专家卡片改为「可运行／缺少依赖」＋能力徽标（「一层对外投资核查」「文本任务专家」）＋输入提示＋版本；缺少依赖单独成行。
  - `modules/membership/pages/expert-detail.tsx`：页头徽标同上；`ERROR_TEXT` 全部改为能力表述，不再出现数据源名称。
  - `modules/membership/pages/expert-new.tsx`：导入说明去掉模型名，改为按能力说明执行范围。
  - `modules/membership/experts/catalog.ts`：`EXPERT_SKILL` 首段改为能力表述；新增 `EXPERT_MODE_LABELS`、`EXPERT_MODE_INPUTS` 供页面复用。
  - `modules/membership/experts/worker.ts`：任务错误文案、模型提示与 Markdown 产物的「工具／来源」行改为能力与数据能力名称（复用既有 `XINHUA_TOOL_LABELS`）。
  - `modules/membership/experts/import.ts`：缺少依赖提示去掉数据源品牌名。
  - `modules/membership/tests/experts.standalone.test.ts`：更新两处期望文案；新增导入页文案回归用例（覆盖两种能力表述、无供应商品牌、无绝对式限制）。
  - 文档：本日志、`docs/README.md` 索引、`docs/IMPLEMENTATION.md` 说明、`docs/P2-EXPERT-ADAPTER.md` 文案口径说明。
- 实际完成：员工可见的专家平台页面、任务错误与 Markdown 产物不再出现数据源或模型品牌名，改用「一层对外投资核查」「文本任务专家」「平台企业信息查询」等能力表述。
- 关键决定及理由：
  - 内部标识（`xinhua_trial`、`xinhua_*` 错误码、MCP 主机名、环境变量、专家 slug）一律不变，接口契约与既有任务不受影响；只改员工可见文案。
  - 能力徽标与输入提示并排显示，让「需先确认企业主体」这一前置步骤在进入表单前即可见。
  - 产物中的「工具：…」行改用既有 `XINHUA_TOOL_LABELS`（主体名称候选检索／企业基础画像／对外直接投资）：既去掉品牌名，又保留可核验的来源粒度。
  - 运维与工程文档仍按实际配置记录数据源名称，只在开头说明员工可见文案采用能力口径，避免运维失去定位依据。

## 最小验证

- `npm run typecheck`：通过（contracts／backend／api／worker／tests／modules／web）。
- `node --import ./tests/standalone.ts --test "modules/membership/tests/experts.standalone.test.ts"`：9/9 通过。
- `DATABASE_URL=postgres://…/ai_workbench_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test "modules/membership/tests/experts-access.test.ts"`：1/1 通过（临时 PostgreSQL）。
- `npm run test:standalone`：286 项、270 通过、16 失败；`origin/main` 基线同为 286／270／16，失败用例集合完全一致（站点公开页与公开方法用例），与本次改动无关。
- `grep -rn "悟道\|新华财经\|DeepSeek" modules/membership/`：仅剩导入依赖识别用的内部正则和审计收据里的服务标识，均不进入员工界面。
- 未执行：真实员工试用、生产发布验证、浏览器端视觉回归。

## 风险与交接

- 已知限制／缺失依赖：内置专家的 `skill_md` 由 `seedBuiltin()` 在部署后按新文案刷新；改动前生成的历史产物与任务快照仍保留旧措辞。
- 下一步：评审并合并 PR #47 后随下一次发布上线，再由用户确认专家卡片、错误提示与产物的实际显示。（本轮之后又按首轮审阅意见修正导入说明，见下节。）

## PR #47 首轮审阅修正

- 审阅意见：[PR #47 首轮审阅](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/47#issuecomment-6378786052)（审阅 head `628f9a9`），一项 P2：导入说明不应断言所有自定义专家都不查询企业信息。
- 问题：首版导入说明写「自定义技能只以文本模式执行，不查询企业信息库」。PR #45 合并后，完整声明平台三项企业查询工具（`fuzzy_search_company_list`、`get_company_profile`、`get_direct_investment`）的自定义专家会以 `xinhua_trial` 执行并实际查询企业，该绝对表述与目录、详情页的能力徽标互相矛盾。
- 修改文件：
  - `modules/membership/pages/expert-new.tsx`：导入说明改为「技能按自身声明及平台已开放的能力执行：未声明工具的技能为文本任务专家，直接填写任务要求；完整声明主体检索、工商画像与一层直接投资三项平台能力的技能为一层对外投资核查，需先确认企业主体。声明的工具或其他技能依赖会被结构化检查，未接入的依赖会阻止运行。」不再出现供应商品牌，也不再断言一律不查询企业信息。
  - `modules/membership/tests/experts.standalone.test.ts`：新增「导入页同时说明两种专家能力且不含供应商品牌」回归用例，断言页面文案含「文本任务专家」「一层对外投资核查」「未接入的依赖会阻止运行」，且不含「不查询企业信息库」及任何供应商品牌名。
- 关键决定及理由：
  - 导入页直接说明两种能力与各自需要员工提供什么，与卡片、详情页徽标使用同一套能力表述，避免导入前的预期与导入后的展示不一致。
  - 只描述能力（主体检索、工商画像、一层直接投资），不写具体工具名、数据源或模型品牌；受控工具名仍只在工程文档与内部标识中出现。
  - 执行判定逻辑未改动：`executionMode()` 仍以是否完整声明三项受控工具区分 `text_only` 与 `xinhua_trial`。
- 最小验证（首轮审阅修正）：
  - `npm run typecheck`：通过（contracts／backend／api／worker／tests／modules／web）。
  - `node --import ./tests/standalone.ts --test "modules/membership/tests/experts.standalone.test.ts"`：10/10 通过（新增 1 项）。
  - `npm run test:standalone`：287 项、275 通过、12 失败；同一工作树去除本次改动后为 286／274／12，失败用例集合完全一致（站点公开页、公开方法与 MCP 相关用例），与本次改动无关。
  - 本地复核脚本（不入库）按评审验收逐条断言：无工具包 `missingDependencies=[]`、状态可运行、能力徽标「文本任务专家」；完整声明三项受控工具的包 `missingDependencies=[]`、状态可运行、能力徽标「一层对外投资核查」且输入提示为「需先确认企业主体」；导入页文案含两种能力且无品牌名与绝对限制表述。全部通过。
  - 未执行：真实员工试用、生产发布验证、浏览器端视觉回归。
- 风险与交接：
  - 已知限制：改动前后生成的历史产物与任务快照仍保留旧措辞；内置专家 `skill_md` 由 `seedBuiltin()` 在部署后刷新。
  - 下一步：等待 PR #47 复审；合并后随下一次发布上线，再由用户确认导入页、卡片、错误提示与产物的实际显示。
