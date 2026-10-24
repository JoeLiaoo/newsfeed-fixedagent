# 2026-10-24 · 已投 GP 直投项目员工清单

- Agent：Codex
- 对应任务：维护任务（不对应 P0–P5 验收项）
- 完成状态：PR #52 已创建，Open；未合并、未部署

## 本次改动

- 修改文件：`modules/membership/gp/routes.ts`、`modules/membership/pages/projects/invested-gp.tsx`、`modules/membership/tests/gp-projects-access.test.ts`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。
- 实际完成：新增登录员工可读的 `/api/v1/membership/gp-projects`，按 50 条分页列出已核实投资和有效 GP；员工页提供加载、失败重试、空列表、赛道、核实状态、事件日期与审核来源链接。
- 关键决定及理由：仅返回 `verified` 投资且所属 GP 为 `active`、身份为 `gp` 的记录；响应不含原始证据、审核人、审批时间及审计字段。投资日期为空时页面显示「日期未知」，不使用首次发现或入库时间代替。P3-01～P3-04 验收勾选不变。

## 最小验证

- 执行的检查及结果：`npm run typecheck`、`npm run build -w @aihot/web`、新增 PostgreSQL 路由用例通过（未登录为 401、无记录为空、已核实有效 GP 可见，observed/baseline/retracted 投资和 paused GP 隐藏、响应不含审核私有字段、分页生效）；GP standalone 规则用例 7/7 通过；`tests/architecture.test.ts` 按 CI 参数跳过数据库连通性项后 13/13 通过；`node scripts/check-doc-links.ts` 检查 357 个本地链接全部存在；`git diff --check` 通过。
- 未执行或需用户试用的检查：完整 `npm run test:standalone` 未通过：页面元数据相关用例由 web server 返回 503；公开只读端点用例期望 405 而实际返回 401。这些失败发生在仓库其他页面/端点，非本改动路由；本页客户端 bundle 与生产构建已通过。未连接生产数据，也未进行真实员工页面验收。

## 风险与交接

- 已知限制／缺失依赖：本页展示的数据是否完整，取决于 GP 主体核验、投资事件审核及同步运行情况；页面不会把观察记录或暂停 GP 转成可见项目。未新增迁移或供应商调用。
- 下一步：等待 PR #52 的 review 与 CI；员工登录后的真实页面验收待安排。本次不合并、不部署。

PR：[PR #52](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/52)，分支 `feat/projects-invested-gp-v1`。

PR 第一次 `quality` 检查发现本页链接使用了设计系统外的 `rounded-sm`；已改为 `rounded-control` 并复跑架构规则通过。后续 CI 以最新 head 为准。


## 自动审阅验证补充

- 核对员工会话由服务端限制 active 账号；查询仅返回 verified 投资及 active/gp 主体，私有证据与审核身份不出 API，来源使用审核字段，日期不使用发现或入库时间代填。完整 diff 未发现额外实质问题。
- 原 CI 显式列出数据库测试文件，遗漏本 PR 新增的 `gp-projects-access.test.ts`；已把此文件加入 PostgreSQL job，以便对最终 head 实际验证新接口，未改动业务实现。
- 本地架构规则 13/13、357 个文档链接通过。最终 CI 及主分支组合验证结果记入 PR 审阅结论；未执行生产部署与真实员工验收。
