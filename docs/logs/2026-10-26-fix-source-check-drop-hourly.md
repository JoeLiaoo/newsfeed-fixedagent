# 2026-10-26 · 员工信源检查取消每小时次数上限

- Agent：pi
- 对应任务：维护任务（不对应 P0–P4）；按 Joe 的产品决定，移除员工信源检查「每位员工每小时最多 3 次」的上限，保留全站同时最多 4 次检查和「同一员工不能同时跑两个检查」。
- 完成状态：完成（代码与测试已改，PR 未合并、未部署）

## 本次改动

- 修改文件：
  - `modules/membership/server.ts`：`POST /api/v1/membership/sources` 的准入判断从「同一员工已在检查／全站已满 4 个／该员工一小时内已用 3 次」改为只看前两项；删除每小时的 `sourcePreviews` 时间戳 Map 及其清理逻辑，`activeSourcePreviews` 继续记录正在进行的检查；429 的 `retryAfterSeconds` 由 3600 改为 30（现在表示并发而非小时额度，前端未使用该字段）。
  - `modules/membership/sources.ts`：新增 `SOURCE_CHECK_CONCURRENCY = 4` 与 `sourceCheckMayStart(active, userId)`，把并发准入规则放在已有的信源检查模块里，便于直接测试。
  - `modules/membership/pages/sources.tsx`：页头删去「每位员工每小时最多检查 3 次，」，保留「全站同时最多 4 次检查」；429 文案由「来源检查次数或并发已达上限」改为「同时进行的来源检查已达上限」。
  - `modules/membership/tests/source-check-concurrency.standalone.test.ts`（新增）：同一员工不能同时跑两个检查、全站最多 4 个、检查结束后名额立即释放（没有小时计数）。
  - `modules/membership/tests/source-check.test.ts`：在同一小时内第 4、5 次提交仍被真正检查（201）而不是 429，锁住「取消小时上限」这一行为。
  - `.github/workflows/p3-checks.yml`：把新增的 standalone 测试加入 CI 的 standalone 列表。
  - `site/changelog/pending/source-check-concurrency.json`（新增）：员工可见变更的待发布更新日志条目。
- 实际完成：服务端只保留并发限制；每小时计数与其 Map、清理代码一并删除；页面文案与 429 提示与实际限制一致；补了单元与集成两处回归。
- 关键决定及理由：
  - 每小时的 `sourcePreviews` Map 只服务于被取消的额度判断，删除后没有其他读取方，保留会成为无用状态，故一并删除（同时删掉 `nowMs` 与 5000 条上限的清理循环）。
  - 429 的 `retryAfterSeconds` 改为 30：原来 3600 表示「一小时后再说」，现在是最多 4 个并发名额，稍后即可重试；前端只按错误码显示文案，不读该字段，因此无需同步改页面。
  - 专家任务、知识库等其他限流未改动；36kr 主机别名、专家任务界面不在本次范围内。

## 最小验证

- 执行的检查及结果：
  - `node --import ./tests/standalone.ts --test modules/membership/tests/source-check-concurrency.standalone.test.ts modules/membership/tests/sources-errors.standalone.test.ts`：5/5 通过。
  - `DATABASE_URL=postgres://zhijianliao@127.0.0.1:5432/newsfeed_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/source-check.test.ts`：1/1 通过（含新增的第 4、5 次检查断言）。
  - 反向验证：临时把准入判断改回旧的每小时 3 次逻辑后，同一集成测试在第 4 次提交处失败（429 !== 201），确认新断言确实能拦住旧行为；随后已恢复新代码。
  - `npm run typecheck`：通过。
  - `node scripts/check-doc-links.ts`：通过。
- 未执行或需用户试用的检查：未在浏览器里复看信源页页头文案；未跑全量测试套件；未合并、未部署。

## 风险与交接

- 已知限制／缺失依赖：
  - 并发名额是进程内的 `Set`，多实例部署时上限按实例计（与改动前的行为一致，未改变部署形态）。
  - 全站同时 4 次的并发上限保留，因此多名员工集中提交时仍可能出现 429，此时按并发文案提示稍后重试。
  - 员工可见变更写入 `site/changelog/pending/`，需在发布前由 `npm run changelog:apply` 统一写入 `site/changelog.json`。
- 下一步：PR 评审通过后合并；发布时应用待发布更新日志；由真实员工验证多人同时提交时的 429 提示与实际并发上限。

不要在日志中写入密钥、未脱敏接口响应或用户私人材料。
