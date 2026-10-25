# 2026-10-25 · 赛道同业竞争看板 P0

- 对应任务：Joe 2026-10-25 产品锁定的 P0 专家入口替换；本项是专家平台维护，不改变 P2-05 全景图或 P5 知识库的真实业务验收勾选。
- 状态：工作分支完成代码与本地聚焦检查，待 PR 评审；未合并、未部署。

## 做了什么与修改文件

- `modules/membership/experts/catalog.ts`、`routes.ts`：旧 `company-sentiment-report` 播种为 `hidden`，保留行以维护历史任务；新 `sector-peer-landscape` 为 `available`，技能文本写明公开数据、中国优先、美国参考与来源 URL 规则。任务 API 接收原始 `query`；少于两个汉字／拉丁字母返回 400 `sector_query_required`。P0 不要求主体确认。
- `modules/membership/experts/sector-peer-html.ts`、`worker.ts`：worker 领取任务后直接生成独立 HTML，三主区、美国参考带、来源缺口、生成时间和免责提示均在产物中；不调用模型、新华财经或实时信源，不填模拟数字。旧舆情 slug 即使被手工排队也不落入文本模型执行。产物沿用 `member_expert_artifacts` 的本人鉴权、下载与七天清理，结果保存 HTML 供页面预览。
- `modules/membership/pages/experts.tsx`、`expert-detail.tsx`：新卡片显示「可运行」，详情页用单一企业／赛道查询框和可选备注提交；任务完成后在无脚本权限的 iframe 中展示 HTML，并可下载。旧 slug 深链因目录隐藏显示无此专家。
- `modules/membership/tests/expert-coming-soon.standalone.test.ts`、`expert-catalog-coming-soon.test.ts`：替换旧「开发中」预期，覆盖旧入口隐藏、新入口可用、短查询拒绝、worker 生成 HTML 和产物下载。
- `docs/PLAN.md`、`IMPLEMENTATION.md`、`P2-EXPERT-ADAPTER.md`、`PROGRESS-REPORT.md`、`README.md`、`docs/README.md`、`site/changelog.json`：同步需求基线、实现边界与索引；更新历史更新日志里的「目前」时间措辞，不把本分支写成生产已发布。

## 决定与边界

- 一个输入保存用户原始查询（含首尾空白），呈现时 HTML 转义；企业与赛道的消歧留给 P1。备注不进入空看板事实区。UI 不展示材料上传，新任务页面只有查询与可选备注。
- P0 看板所有业务区明确「数据源未接入」；不取内部 IC 笔记、未披露估值或真实 LP 管线。美国资料只是参考带，不进入中国主体清单。
- HTML 同时存于任务 `result` 和可下载 artifact，沿用原有任务所有权与过期清理；iframe `sandbox` 不授予脚本或同源权限，文档自身 CSP 也阻止外部资源。后续大体积真实看板可改为独立鉴权预览流，不应无限放大任务列表 JSON。

## 最小验证与结果

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/expert-coming-soon.standalone.test.ts`：3/3 通过，含三主区、输入转义与沙盒预览。
- `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13/13 通过，含圆角刻度。
- 一次性 PostgreSQL 17：`expert-catalog-coming-soon.test.ts` 1/1 通过，覆盖播种、API、worker、HTML 下载；将模型调用开关置为关闭后，任务仍成功。
- `npm run build -w @aihot/web`：client 与 SSR 构建通过。
- `node scripts/check-doc-links.ts`：415 个本地 Markdown 链接均存在；`git diff --check`：通过。

## 未验证事项、风险与下一步

- 未在生产或真实员工账号验证目录、预览和下载；未连接公开数据源，也未验证 P1 的事实准确性。`result` 内嵌 HTML 适合当前小型空看板，真实数据接入时需核对列表响应大小。
- P1：企业／赛道消歧；中国同业边界和公开阶段信号；人民币融资、境内并购及 IPO 事件的来源 URL、时间口径与密度定义；美国同业／融资参考；逐项缺失显示「未披露／未检索到」及来源可达性复核。
- 评审 PR 后再由独立发布流程部署；本分支不合并、不操作火山云。

## CI 修复（PR #79，2026-10-25）

- 做了什么：PR #79 的 quality 与 postgres-integration 均因架构测试「Beijing time is converted only in contracts/time.ts」失败。`modules/membership/experts/sector-peer-html.ts` 用 `new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ... })` 自行格式化生成时间，被架构测试判为绕过 `packages/contracts/src/time.ts`。
- 修改文件：`modules/membership/experts/sector-peer-html.ts` 改为从 `@aihot/contracts/time` 导入 `beijingStamp`，用 `beijingStamp(generatedAt)` 取代 `Intl.DateTimeFormat`，转义仍走 `escapeHtml`。
- 关键决定：走 contracts 助手而非把文件加入 `CONVERTS_BEIJING_TIME` 白名单；`@aihot/contracts` 已在 `@citic/membership` 的依赖里，不新增依赖。除时间戳来源外未改产品行为，HTML 分区、CSP、离线与「无模拟数字」约束原样保留；时间戳文字按仓库既有 `beijingStamp` 口径显示为「10月25日 08:00（北京时间）」。
- 最小验证与结果：`node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts` 修复前 12/13（仅北京时失败），修复后 13/13 通过；`node --import ./tests/standalone.ts --test modules/membership/tests/expert-coming-soon.standalone.test.ts modules/membership/tests/experts.standalone.test.ts modules/membership/tests/experts-search.standalone.test.ts` 17/17 通过；`npm run typecheck` 通过；`git diff --check` 通过。
- 未验证事项、风险与下一步：未重跑完整 CI（依赖网络的 PostgreSQL 集成任务在本地不可全量复现），以 GitHub Actions 重跑结果为准；本分支不合并、不部署。
