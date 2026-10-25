# 2026-10-26 · P2-06 赛道同业模型拒绝与输入显示修复

- 对应任务：P2-06 生产故障维护；不改变真实员工验收状态。
- 状态：本分支修复并完成定向检查；待 PR 评审、合并、发布和员工复测。未操作生产任务、配置或服务。

## 现象与定位

- 用户报告首次员工任务约三秒失败，页面同时显示「没有填写输入内容」和「文字整理服务暂时拒绝了请求」。只读核对生产数据库时，该任务的 `input.query` 去首尾空白后长度为 4，`execution_attempts=1`，证实空输入提示由任务详情页忽略 `query` 引起。API 提交入口原已要求至少两个汉字或拉丁字母，新增空白输入回归用例。
- 同一任务的四条 `expert_search` 收据均为 `received`，唯一 `expert` 模型收据为 `failed`、HTTP 400、`invalid_request_error`；保存的错误指向 `response_format`、`prompt` 和 `json` 一词。未读取或记录原始搜索响应、模型响应、完整报错、查询词或账号资料。
- `chatJson` 默认发送 JSON 响应格式；赛道同业的旧系统提示词却没有明确要求输出 JSON。供应商按请求格式规则拒绝，worker 把非重试性的 HTTP 400 统称为「暂时拒绝」，造成误导。此次证据支持请求形状错误，不支持将其归因于搜索失败、空查询、输出 token 上限或暂时限流。

## 修改与决定

- `modules/membership/experts/worker.ts`：提示词明确要求合法 JSON 对象、五个数组及无证据时的空数组；保留逐项来源与不补造约束；提示词版本增至 `1.0.1`，避免旧逻辑请求身份复用。暂时故障、账号访问拒绝和永久请求错误分别写员工可行动的中文消息；原始供应商文本不回显。
- `modules/membership/pages/task-detail.tsx`：查询类专家展示 `query` 与备注，空输入只在公司、查询和备注都缺失时显示；公司名专家的「核查主体」保持原样。赛道同业下载入口按实际 HTML 格式命名。
- `modules/membership/tests/task-detail-page.standalone.test.ts`、`modules/membership/tests/expert-coming-soon.standalone.test.ts`、`modules/membership/tests/expert-catalog-coming-soon.test.ts`：覆盖查询显示、JSON 模式提示词、三类模型拒绝和纯空白查询。
- `README.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/README.md` 与原 P2-06 实施日志：纠正 PR #100 合并／部署状态、服务收据归属与输入规则，记录本次生产故障和未验收范围。

## 最小验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/expert-coming-soon.standalone.test.ts modules/membership/tests/task-detail-page.standalone.test.ts`：13/13 通过。
- `DATABASE_URL=postgres://.../sector_peer_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/expert-catalog-coming-soon.test.ts`：隔离 PostgreSQL 17 测试库，1/1 通过。使用本机临时容器；无生产写入。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：503 个本地 Markdown 链接通过；`git diff --check`：通过。

## 未验证、风险与下一步

- 未调用真实模型，也未在生产重新运行员工任务；供应商账号、额度、当前配置与可用性在发布时仍需运维复核。提示词满足这次 HTTP 400 指向的 JSON 规则，但模型输出质量、可引用来源覆盖和真实员工 HTML 预览仍需发布后验收。
- 既有失败任务不会自动恢复。发布后可由任务所有者按页面重试，或提交新任务；旧搜索收据可能复用，更新的提示词会产生新的模型逻辑请求，费用与收据应按实际调用核对。暂时故障仍需员工稍后重试，永久请求错误则提示联系管理员。
- 下一步：评审并合并本 PR；另行按部署闸门发布并核对一项真实企业或赛道查询的任务状态、HTML 看板、逐项来源、费用收据和空证据提示。P2-06 的真实员工体验不因本地测试而视为通过。
