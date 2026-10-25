# 2026-10-24 P2 专家任务列表分页与按专家过滤

- Agent：pi coding agent（MiniMax-M3.1-Flash）
- 对应任务：维护任务（不对应 P0–P5 验收项）；P2-05 保持 `[ ]`
- 完成状态：PR #57 已于 2026-10-26 合并（`65b10d9`）；未部署，真实员工页面验收待完成

## 本次改动

- 修改文件：`modules/membership/experts/task-page.ts`、`modules/membership/experts/routes.ts`、`modules/membership/pages/expert-detail.tsx`、`modules/membership/tests/expert-task-page.standalone.test.ts`、`modules/membership/tests/expert-tasks-page.test.ts`（新增）、`.github/workflows/p3-checks.yml`、`docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。
- 实际完成：`GET /api/v1/membership/expert-tasks` 由固定 `LIMIT 50` 改为分页读取，支持 `limit`、`offset` 与可选的 `expertSlug`，返回 `pagination: { limit, offset, hasMore, nextOffset }`；专家详情页按当前专家的 slug 向服务端请求任务，一页 20 条，可用「上一页／下一页」翻阅该专家的历史，页面轮询只在当前页存在排队中或执行中的任务时触发且只刷新当前页。
- 关键决定及理由：
  - 服务端按 `expertSlug` 过滤，员工页不再拉取全部任务再在前端筛；行仍以 `user_id` 限定，任何情况下都不返回其他员工的任务，隐藏或开发中的专家语义不变。
  - 参数按既有会员端列表口径处理：`limit` 默认 20、最大 100，`offset` 最大 100000；非数字、负数、重复参数与不合规 slug 一律 400，不静默当作第一页。超出上限的合法数字按上限截断。
  - 响应里的任务字段沿用当前任务详情 API（`state`、`stage`、`hasArtifact`、`materials`、`executionAttempts` 等）；不添加检查点 JSONL 下载字段或入口。
  - 分页交互沿用会员端既有写法（GP 管理页的「上一页／下一页」），因此历史可翻到任意一页而不是只能往后追加；提交新任务后回到第一页，确认主体、重试、取消与删除材料后刷新当前页。
  - 空状态写明「该专家还没有任务记录」，不再笼统写「暂无任务」；员工可见文案只说能力，不出现数据源或模型品牌名。
  - 未实现企业舆情报告的数据源与报告生成，未改 `coming_soon`／`hidden` 状态语义，未触及 citic-alliance／market-leaders 占位页。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck` 通过。
  - `node --import ./tests/standalone.ts --test …`（P3 checks 的 standalone 列表，含新增 `expert-task-page.standalone.test.ts`）108/108 通过。
  - 新增数据库用例 `modules/membership/tests/expert-tasks-page.test.ts` 1/1 通过（本地临时 PostgreSQL `newsfeed_test`）：访客 401、非法参数 400、`expertSlug` 只返回该专家的任务、分页 `hasMore`/`nextOffset` 与逐页内容、默认一页 20 条、另一员工读不到本人以外的任务。
  - 既有专家相关数据库用例 `experts-access`、`expert-catalog-hidden`、`expert-catalog-coming-soon`、`panorama-db` 4/4 通过。
  - `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts` 13/13 通过；`npm run build -w @aihot/web` 通过。
  - `node scripts/check-doc-links.ts` 通过；`git diff --check` 通过。
- 未执行或需用户试用的检查：未做生产发布；未做登录后真实员工页面验收与浏览器视觉检查；未运行全量 `npm test` 与全量 `npm run test:standalone`；未调用任何外部数据源或模型。补充：`tests/page-metadata.standalone.test.ts` 在本机为 8/10 失败（web server 返回 503），把本次改动全部收起后在同一 base 上结果相同，属仓库既有问题，与本改动无关（与 2026-10-24 GP 清单日志记录的一致）。

## 风险与交接

- 已知限制／缺失依赖：偏移分页在任务状态变化（例如新任务插入最前）时，同一页内可能出现一条记录顺序位移；单次请求最多 100 条、最多翻到 100000 条，更早的历史不可达；接口仍只返回本人未过期的任务（七天保留期），过期任务不显示也不可下载。
- CI：复基 head `433dc55` 上 `links`、`quality`、`postgres-integration` 全部通过。
- 后续：部署与真实员工页面验收待做。本次不改变 P2-05 的验收状态。

## 2026-10-26 合并状态

- PR #57 复基后的 head `433dc55` 上 `links`、`quality`、`postgres-integration` 全部通过，已 squash 合并为 `65b10d9e1c41651a0da80d2387c156d900342f28`。
- 尚未部署；真实员工页面验收待做。P2-05 继续保持未勾选。
