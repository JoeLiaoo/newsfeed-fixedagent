# 2026-10-24-员工任务与产物库 工作日志

- Agent：pi（MiniMax-M3.1-Flash）
- 对应任务：维护任务（不对应 P0–P5 的新增勾选）；落实 `docs/PLAN.md` 4.2 的 `/account/artifacts` 路由
- 完成状态：完成（代码与自动化检查通过；真实员工试用与部署未做）

## 本次改动

- 修改文件：
  - `modules/membership/experts/task-query.ts`（新增）：列表参数解析与分页口径（limit 1–100，默认 20；offset 0–100000；非法参数返回错误码）。
  - `modules/membership/experts/task-state.ts`（新增）：任务状态的中文说法与徽标，详情页与产物库共用一套。
  - `modules/membership/experts/routes.ts`：`GET /api/v1/membership/expert-tasks` 增加 `limit`／`offset`／`expertSlug`／`state` 参数与 `pagination.{limit,offset,hasMore,nextOffset}`；输入备注改为最多 200 字的预览。
  - `modules/membership/pages/account-artifacts.tsx`（新增）：`/account/artifacts` 页面「我的任务与产物」。
  - `modules/membership/pages/expert-detail.tsx`：改为自己这个专家的历史（`expertSlug` + `limit=100`），并共用状态文案。
  - `modules/membership/pages/profile.tsx`、`modules/membership/pages/experts.tsx`、`modules/membership/web.tsx`、`modules/membership/module.ts`：入口与路由登记。
  - `modules/membership/tests/task-query.standalone.test.ts`（新增）、`modules/membership/tests/account-artifacts.test.ts`（新增）、`.github/workflows/p3-checks.yml`：测试与 CI 接线。
- 实际完成：
  - 员工登录后可在 `/account/artifacts` 一次看完跨专家的任务记录：专家名、状态徽标、阶段、提交与更新时间、输入预览、可下载的 Markdown 产物与任务材料；支持按状态分组筛选（全部／进行中／已完成／失败／已取消）与上一页／下一页。
  - 入口：个人设置页新增「我的任务与产物」一行；专家平台页头新增同名入口；手机「我的」页的工具区新增同名一行。未新增第五个侧栏一级入口，也未放进「项目信息」。
  - 产物下载与材料下载仍走原有地址（`/expert-tasks/:id/artifact`、`/expert-tasks/:id/materials/:materialId`），未改动。
  - 接口仍只返回调用者自己的、尚未过期的任务；访客 401；非法分页或筛选参数 400。
- 关键决定及理由：
  - **沿用既有列表接口，没有另起一个并行接口。** `GET /api/v1/membership/expert-tasks` 本来就返回本人任务、材料摘要与产物标记，补上分页和筛选即可；另建一个 `/account/artifacts` 专用 JSON 会让同一份数据有两个出口。页面需要的字段这一接口都已具备，唯一的差别是备注长度：接口原来整段返回备注，页面只需要一行预览，因此服务端把备注截到 200 字并带 `notesTruncated` 标记，详情页本来就不显示备注，不受影响。
  - **默认 20 条会改变旧行为，所以详情页显式提高了上限。** 旧接口固定返回 50 条；改为默认 20 条后，专家详情页若照旧只取前 20 条，会漏掉该专家较早的任务。详情页因此改为按 `expertSlug` 读取并把上限提到 100 条（接口允许的最大值），比原来更全。
  - **筛选参数非法就报错，不静默兜底。** `limit`／`offset` 只接受数字文本并夹到区间内，其余（如重复参数、小数、负数）返回 400 `invalid_query`；`state` 只接受平台写下的六种状态，可写多个，返回 400 `invalid_state`。错误码只描述能力，不含任何供应商品牌名。
  - **产物库页面不承载操作，只承载查看与下载。** 提交、重试、取消仍留在专家详情页，产物库只回答「我做过什么、产物在哪」。
  - 与未合并的 PR #57（同样给该列表接口加分页）有重叠：两个 PR 都会改 `modules/membership/experts/routes.ts` 与详情页，合并时需要人工取舍，本分支未依赖 #57。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`：通过。
  - `npm run build -w @aihot/web`：通过。
  - `node --import ./tests/standalone.ts --test modules/membership/tests/task-query.standalone.test.ts`：4 项通过（默认 20 条、夹取区间、非法参数 400、分页游标）。
  - `DATABASE_URL=… node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/*.test.ts`：127 项通过（含新增的接口测试：401、非法参数 400、只返回本人任务、过期任务不出现、首页 20 条与 `hasMore`／`nextOffset`、第二页 5 条且不重复、`expertSlug` 与 `state` 筛选、产物与材料归属）。
  - `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13 项通过。
  - `node --test apps/web/tests/nav-groups.test.ts`：5 项通过（未改侧栏一级入口）。
  - `node scripts/check-doc-links.ts`：384 条本地链接全部存在。
- 未执行或需用户试用的检查：
  - 未在浏览器里登录实机查看产物库页面（布局、下载按钮、翻页）——只做了类型检查与构建，没有人工点过页面。
  - 未用真实任务验证产物与材料在页面上的下载链接。
  - 未做部署，也未在生产数据上跑过。

## 风险与交接

- 已知限制／缺失依赖：
  - 页面只显示输入预览（企业名称或前 200 字备注），完整备注要去专家详情页看。
  - 任务与产物保留期不变：七天到期后从列表消失，产物与材料同时不可下载。
  - 与 PR #57 的改动面重叠，合并顺序需要人工取舍；本分支的接口口径是 limit 1–100／默认 20／offset 0–100000，与仓库其他会员列表一致。
  - 「任务状态」徽标与错误文案沿用详情页现有说法，本次未新增文案口径。
- 下一步：
  - 请用户登录后打开 `/account/artifacts`，确认列表、筛选、翻页与两个下载入口的实际效果。
  - 合并顺序确定后，再按 P3／P4 的闸门安排发布与真实员工验收。

不要在日志中写入密钥、未脱敏接口响应或用户私人材料。任务只有达到实施计划的完成标准时才能打勾。
