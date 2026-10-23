# 2026-10-23 · Issue #26 资讯信源与新华财经专家失败修复

## 目标

修复员工在 `/settings/sources` 添加公开网站／RSS 信源失败，以及在 `/experts` 运行新华财经适配版时提示“新华财经没有返回主体候选，请检查名称或稍后重试”的两条失败。两条链路分别定位，不预设共同根因（[#26](https://github.com/JoeLiaoo/newsfeed-fixedagent/issues/26)）。

## 复现证据（脱敏）

### 信源链路

- 生产 Nginx 访问日志（`/var/log/nginx/access.log`）：2026-10-23 17:39:39、17:39:52、17:40:27（+0800）同一客户端三次 `POST /api/v1/membership/sources`，均返回 **422**，响应体 36 字节（`{"error":"no_public_articles_found"}` 或 `{"error":"source_validation_failed"}`，两者长度相同，无法从字节数区分）。失败前后的 `GET /api/v1/membership/sources` 均为 200。
- 生产数据库 `sources` 表没有任何 `member-source-%` 记录：`SELECT count(*) FROM sources WHERE id LIKE 'member-source-%'` → 0，即三次提交都没有入库。
- 生产 API 容器在排查前已被重建（`docker ps` 显示容器 Up 3 hours），失败时段的 API 日志已不存在，`docker logs` 只剩启动行；因此失败阶段只能由代码路径与受控样例确定，不能由服务端日志还原。
- 员工提交的具体地址未随 issue 提供（issue 明确该信息走受控渠道），因此按受控样例逐阶段复现：公开 RSS 源可预览成功；把网站首页当 RSS 提交、不可达地址、没有文章条目的页面分别落到不同阶段。

### 新华财经链路

- 生产数据库 `member_expert_tasks` 中该次失败任务：`state=failed`、`stage=failed`、`error_code=xinhua_no_candidates`、`execution_attempts=1`，创建于 2026-10-23 09:41:15 UTC，3.6 秒后失败；`input.companyName` 是一个以“中心私募基金管理有限公司”结尾的部分名称。
- 用仓库自带凭据直连 `mcp.cnfic.com.cn` 复现：该关键词 `fuzzy_search_company_list` 返回 `total=0`、`results=[]`；同前缀更短的“私募基金管理有限公司”返回 `total=10217`。即服务商确实没有匹配到该名称，原实现把这一种情况与“返回行缺少主体 ID”“响应结构无法解析”混在同一个错误里。
- 同一账号直连还发现第二个真实缺陷：`get_company_profile` 不带时间参数时，工具按“滚动三年”的默认窗口过滤（响应回显 `time_field: "start_date"`），成立日期早于窗口的主体一律返回 `not_found: true`。实测样本“杭州市国有资本投资运营有限公司”（成立 2018-11-28）不带窗口为 `not_found`，带 `time.start=1900-01-01` 才返回完整画像（`company_id`、`credit_code`、`company_status_name` 一致）。`get_direct_investment` 过滤的是 `capi_date`，适配器本就传了同样的宽窗口，所以只有画像这一步必然失败。

## 改动

### 信源链路

- 新增 `modules/membership/sources.ts`：按失败阶段给出稳定错误码——`source_unreachable`（地址不可达）、`source_timeout`（超时，含本次检查自己的截止时间）、`source_not_parseable`（不是可解析的 RSS／列表／sitemap）、`source_no_articles`（可解析但没有文章条目）、`source_not_found`（404/410）、`source_forbidden`（401/403）、`source_rate_limited`（429）、`source_upstream_error`（5xx）、`source_article_pages_failed`、`source_validation_failed`（兜底）。原来的兜底 `source_validation_failed` 不再覆盖全部失败。
- `POST /api/v1/membership/sources`（`modules/membership/server.ts`）：整次检查（站点发现＋列表＋原文页）共用 40 秒预算并可中止；原文页读取失败不再让整次检查失败（列表可解析即可入库，原文页失败数随结果返回）；重复检查在消耗每小时额度之前返回 409；失败时按阶段返回错误码。
- `packages/backend/src/admin/sources.ts` 的 `previewSource` 增加可选参数：本次检查的原文页预算、原文页失败是否致命、外部中止信号；管理员后台预览行为不变（仍按来源自身预算、原文页全部失败即报错）。
- `packages/backend/src/lib/http-fetch.ts` 及其上层（`sources/rss.ts`、`sources/web-list.ts`、`sources/collect.ts`）支持可选 `AbortSignal`，检查结束后能真正停止已开始的读取，不再留下占用并发名额的后台任务。
- 页面 `modules/membership/pages/sources.tsx`：按错误码逐条映射提示；成功提示补充“其中 N 篇原文页未能读取”。

### 新华财经链路

- `modules/membership/experts/data.ts`：`get_company_profile` 改为传宽时间窗口 `XINHUA_ALL_TIME`（与 `get_direct_investment` 一致），成立较早的主体不再返回 `not_found`；新增 `candidateSearchOutcome`（区分“服务商给了空列表”和“回答里没有候选列表”）、`mapCompanyCandidates`、`relaxedCompanyKeywords`（去掉尾部括号与“有限公司／合伙企业”等企业形式后的短名）。
- `modules/membership/experts/worker.ts`：先按原样名称检索，无匹配时依次尝试短名；只有带主体 ID 的候选才进入选择状态；新增错误码 `xinhua_entity_id_missing`；`xinhua_no_candidates` 的文案改为“未匹配到该名称的主体，请核对登记名称或改用更短的关键词”。候选来自短名时标记 `approximate`，页面提示这是近似候选。
- 页面 `modules/membership/pages/experts.tsx`：补齐新错误码文案与近似候选提示。

## 验证

- `npm run typecheck`（contracts、backend、api、worker、tests、modules、web）通过。
- `npm run test:standalone`：262 项中 246 通过、16 失败；失败项与 `origin/main` 基线逐条同名同数（均为本机环境下的公共站点测试），本次新增 6 项全部通过：
  - `modules/membership/tests/sources-errors.standalone.test.ts`：失败阶段 → 错误码；不可达／超时不被当成“地址不可读”。
  - `modules/membership/tests/experts-search.standalone.test.ts`：候选列表读取、无主体 ID 的候选、短名变体、画像时间窗口。
- 直连真实新华财经 MCP（结构信息，不落盘原始响应）：
  - “杭州市国有资本投资运营有限公司”→ 2 个候选（精确匹配）→ 画像核验通过 → 一层直接投资 13 行。
  - 生产失败用的部分名称 → 原样检索 0 条，短名检索 10 条（`approximate=true`）→ 选定后画像核验通过。
- 直连公开站点复现信源各阶段（不经数据库，仅预览逻辑）：公开 RSS → 201（预览 30 篇）；网站首页当 RSS → `source_not_parseable`；不可达地址 → `source_unreachable`；无文章条目页面 → `source_no_articles`。
- 本地夹具验证中止：8 秒才响应的站点在 1 秒截止后 1.0 秒内停止读取，并报告 `source_timeout`。

## 未验证

- 需要数据库的接口测试（`POST /api/v1/membership/sources` 的 201/409/429 与落库、列表页 GET 可见）本机无 PostgreSQL，未运行。
- 生产环境发布后的真实员工复核（信源加入共享采集池、专家任务走完选择主体到产物）未做。
- 员工当时提交的准确地址未知，无法确认其失败落在上述哪一个阶段；本 PR 覆盖了各阶段的准确提示。
- 火山云实例上的容器日志在排查前已被重建，失败时段的原始调用链日志不可恢复。

## 风险与下一步

- 原文页读取失败不再阻断入库：这类信源会进入采集池，其正文可能为空，页面上以“N 篇原文页未能读取”提示，需要在采集健康表中观察。
- 检查预算由 45 秒收紧为 40 秒（含站点发现），极慢站点会更早得到 `source_timeout`。
- 下一步：合并后按 `docs/P3-OPERATIONS.md` 发布到火山云，用受控账号复核两条链路，并请员工重试原地址。

## 涉及文件

`modules/membership/sources.ts`（新增）、`modules/membership/server.ts`、`modules/membership/pages/sources.tsx`、`modules/membership/pages/experts.tsx`、`modules/membership/experts/data.ts`、`modules/membership/experts/worker.ts`、`modules/membership/tests/sources-errors.standalone.test.ts`（新增）、`modules/membership/tests/experts-search.standalone.test.ts`（新增）、`packages/backend/src/admin/sources.ts`、`packages/backend/src/lib/http-fetch.ts`、`packages/backend/src/sources/rss.ts`、`packages/backend/src/sources/web-list.ts`、`packages/backend/src/sources/collect.ts`、`packages/contracts/src/admin.ts`、`docs/P2-EXPERT-ADAPTER.md`、`docs/P0-DATA-MATRIX.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`。
