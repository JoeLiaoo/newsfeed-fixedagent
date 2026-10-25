# 2026-10-25 · 对外投资全景图生产冒烟修复

- Agent：pi（MiniMax-M3.1-Flash）
- 对应任务：维护任务（不对应 P0–P4）。P2-05 的真实主体与员工产物验收仍未完成，实施计划勾选不变。
- 基线：`origin/main` 的 `e3465e5`（PR #81，生产当前 release）。
- 完成状态：完成（代码与自动化测试）；生产复测待部署后由员工执行。

## 现场证据（2026-10-25 20:14 CST，员工 zhijianliao，查询「宁德时代」）

1. 第一次 `POST /api/v1/membership/expert-tasks` 返回 **502**，页面提示「任务提交请求失败，请检查网络后重试。」；重试成功。
2. 任务进入 `choose_entity`，给出约 10 个工商候选；登记在册的母公司「宁德时代新能源科技股份有限公司」**不在候选里**，只有以它命名的分支机构「宁德时代新能源科技股份有限公司宁德时代创新实验室」（存续 · 91350900MA33F5967F · 漳湾镇新港路2号）。
3. 确认该分支机构后任务排队并**失败**（第 2/3 次尝试），页面提示「任务未完成，请检查配置后重试。」；没有产物，只有约 7.5 KB 的采集台账 JSONL：起点画像、年报基础信息各一条，对外投资与年报对外投资均为 `not_found`。
4. 「我的任务」里的任务卡**不显示查询词**，无法辨认是哪一次运行。

## 根因

- **第一次 502 是发布窗口，不是接口缺陷。** [PR #81 的发布记录](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/82)写明发布窗口为 20:10–20:14，api/web/worker 容器以 `--force-recreate` 重建；20:13 后该员工会话仍在访问专家目录。web 的 API 代理在连不上 api 时回 **纯文本** `api unavailable`（HTTP 502），页面用 `response.json()` 解析失败落进 `catch`，于是把「后端在重启」显示成「网络失败」。本次把代理的错误改成与 API 同形的 JSON，并把提交改为同一份提交复用同一把幂等键：网关报错后员工重试拿到的是同一个任务，不会多建一条。
- **候选列表只取第一页且只用一个关键词。** `companyCandidates` 此前只调用一次 `fuzzy_search_company_list`（limit 10、offset 0），命中即返回；知名上市公司有大量以它命名的分支机构，母公司往往排在第一页之外，因此母公司从候选里消失，员工只能选到分支机构。
- **分支进入穿透后任务整体失败。** 分支没有对外投资清单时，服务端回答 `not_found`；底稿本来就把「读不到」写成缺口，但 `not_found` 被当成「分页没读完」，而更关键的是：整份底稿的文字摘要由模型写，模型一步失败（超时、输出不可用、服务端拒绝）就让整个任务失败，底稿连同表格、台账一起丢掉，员工只看到「请检查配置后重试」。
- **失败原因不可见。** 除新华财经侧的少数错误码外，模型侧失败一律落到 `expert_execution_failed`，页面据此显示「请检查配置后重试」——配置不是原因。

## 本次改动

1. **候选检索**（`modules/membership/experts/data.ts`、`worker.ts`）：按页检索（每次 10 条、最多翻到第二页），命中即用；没有与查询词完全一致的主体时，再问一次更短的写法，并按法律形式反推分支所依附的母公司登记名去问一次。总调用次数上限 5，候选上限 12。候选按「与查询词完全一致 → 名称以查询词开头（短的在前）→ 其余」排序，母公司排在它自己的分支机构之前。
2. **分支可辨**（`data.ts`、`modules/membership/pages/expert-detail.tsx`）：候选带上登记类型与「依附于哪个候选」；页面在候选上直接写明「该候选是分支机构，通常没有自己的对外投资记录」或「该候选的登记名称建立在「X」之上，可能是分支机构」。没有候选的登记名包含查询词时，页面说明这是近似候选。
3. **`not_found` 是答案不是缺页**（`data.ts`、`panorama-run.ts`）：对外投资清单与年报对外投资明细的 `not_found` 写成对应缺口，不再写成「分页未读完」，也不据此断定该主体没有对外投资。
4. **分支机构在底稿里说破**（`panorama-run.ts`）：已确认主体的登记类型是分支机构时，底稿写明「其对外投资清单通常为空；本次结果不代表母公司的对外投资」，空清单不会被读成母公司的完整结论。
5. **文字步骤失败不再带走底稿**（`worker.ts`、`panorama-markdown.ts`）：模型写摘要失败时，全景图仍然出报告，摘要位置写明缺的是哪一部分，缺口清单同步记一条。表格、结构树、年报交叉、缺口清单与采集台账不受影响。
6. **失败原因落地**（`worker.ts`、`modules/membership/pages/expert-detail.tsx`）：模型未配置／输出不可用／结果未知（可能已计费）／服务端拒绝各有自己的错误码与中文说明；页面优先显示服务端给的中文原因，不再统一显示「请检查配置后重试」。
7. **任务卡认得出来**（`modules/membership/experts/routes.ts`、`modules/membership/pages/expert-detail.tsx`）：任务列表返回 `selectedEntity`，卡片显示员工查询的名称与已确认的工商主体（名称与统一社会信用代码），时间改用 `@aihot/contracts/time` 的 `beijingStamp`，阶段名换成中文。

## 修改文件

- 候选与字段：`modules/membership/experts/data.ts`、`modules/membership/experts/worker.ts`。
- 底稿与缺口：`modules/membership/experts/panorama-run.ts`、`modules/membership/experts/panorama-markdown.ts`。
- 目录与阶段文案：`modules/membership/experts/catalog.ts`、`modules/membership/experts/routes.ts`。
- 员工页面与代理：`modules/membership/pages/expert-detail.tsx`、`apps/web/app/lib/api-proxy.server.ts`。
- 测试：`modules/membership/tests/experts-search.standalone.test.ts`、`modules/membership/tests/panorama.standalone.test.ts`、`modules/membership/tests/panorama-db.test.ts`。
- 文档：`docs/P2-EXPERT-ADAPTER.md`、本日志。

## 最小验证

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/panorama.standalone.test.ts modules/membership/tests/experts-search.standalone.test.ts modules/membership/tests/experts.standalone.test.ts modules/membership/tests/knowledge-core.standalone.test.ts`：74/74 通过。新增覆盖：母公司排在分支机构之前、只返回分支时会按法律形式反查母公司、检索调用次数有上限、没有候选登记名包含查询词时标为近似候选、分支与母公司的从属关系、`not_found` 写成缺口而不是分页问题、文字步骤失败时底稿仍成立。
- PostgreSQL 17 临时库：`modules/membership/tests/panorama-db.test.ts`、`experts-access.test.ts`、`expert-catalog-*.test.ts` 4/4 通过；数据库集成覆盖任务卡带查询名称与已确认主体。
- 未运行全量 `npm test`；未连接生产数据库、未调用真实新华财经或 DeepSeek、未用真实员工账号复测。

## 风险与交接

- 候选检索的调用次数上限为 5，母公司仍可能不在服务端索引里；此时页面明确写出候选的分支属性与近似候选提示，不再把员工推进一个没有说明的死路。
- 文字摘要失败时任务按「成功但缺摘要」结束，报告与缺口清单写明缺哪一部分；摘要涉及结论口径，仍需人工复核。
- 本分支 **0 条迁移**、0 个开关变更；合并与发布遵循现有运维闸门。发布窗口内提交任务仍可能遇到网关 502，但员工重试不会再重复建任务，页面会给出可读原因。
- 下一步：部署后用「宁德时代」等知名上市公司重跑一次，确认候选含母公司、确认后出得来全景底稿；再核对失败任务的错误码是否落到新的具体原因上。
