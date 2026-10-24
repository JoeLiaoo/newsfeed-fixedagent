# 2026-10-24 · 已投 GP 直投项目员工清单

- Agent：Codex
- 对应任务：维护任务（不对应 P0–P5 验收项）
- 完成状态：代码完成，PR 待创建

## 本次改动

- 修改文件：`modules/membership/gp/routes.ts`、`modules/membership/pages/projects/invested-gp.tsx`、`modules/membership/tests/gp-projects-access.test.ts`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。
- 实际完成：新增登录员工可读的 `/api/v1/membership/gp-projects`，按 50 条分页列出已核实投资和有效 GP；员工页提供加载、失败重试、空列表、赛道、核实状态、事件日期与审核来源链接。
- 关键决定及理由：仅返回 `verified` 投资且所属 GP 为 `active`、身份为 `gp` 的记录；响应不含原始证据、审核人、审批时间及审计字段。投资日期为空时页面显示「日期未知」，不使用首次发现或入库时间代替。P3-01～P3-04 验收勾选不变。

## 最小验证

- 执行的检查及结果：`npm run typecheck`、`npm run build -w @aihot/web`、新增 PostgreSQL 路由用例通过（未登录为 401、无记录为空、已核实有效 GP 可见，observed/baseline/retracted 投资和 paused GP 隐藏、响应不含审核私有字段、分页生效）；GP standalone 规则用例 7/7 通过；`node scripts/check-doc-links.ts` 检查 357 个本地链接全部存在；`git diff --check` 通过。
- 未执行或需用户试用的检查：完整 `npm run test:standalone` 未通过：页面元数据相关用例由 web server 返回 503；公开只读端点用例期望 405 而实际返回 401。这些失败发生在仓库其他页面/端点，非本改动路由；本页客户端 bundle 与生产构建已通过。未连接生产数据，也未进行真实员工页面验收。

## 风险与交接

- 已知限制／缺失依赖：本页展示的数据是否完整，取决于 GP 主体核验、投资事件审核及同步运行情况；页面不会把观察记录或暂停 GP 转成可见项目。未新增迁移或供应商调用。
- 下一步：完成文档链接检查、提交并推送分支、创建面向 `main` 的 PR；不合并、不部署。PR 与提交 SHA 写入 `/tmp/nf-codex-projects-gp-result.md`。
