# 2026-10-26 · 前沿播客 UX 与检索数量调整

- 对应任务：维护任务（不对应 P0–P4）；用户要求隐藏前沿播客 partial 检索提示并取消六集上限。
- 完成状态：代码完成，待 PR 评审；未合并、未部署、未做真实员工试用。P2-05 与 P5 验收状态不变。

## 本次改动

- 修改文件：`modules/membership/experts/bidclub.ts`、`worker.ts`、`frontier-podcast-view.ts`、`frontier-podcast-html.ts`、`frontier-podcast-markdown.ts`、`catalog.ts`、`modules/membership/pages/expert-detail.tsx`、对应 standalone 与数据库测试、`README.md`、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/README.md`。
- 移除 `PODCAST_MAX_EPISODES = 6` 与 collector/worker 的 `max` 参数。slug 去重后的全部搜索候选都以每批 3 集读取；英文源节目仍须有中文正文，失败计数和错误处理保留。
- HTML 不再显示 partial 告警、hero 的“范围”状态或检索窗口；Markdown 和任务卡片也不再显示该搜索覆盖告警。原文未逐条核验、平台不补写事实等内容限制继续保留。
- 保留原词及另一语言检索、现有模型 `expandQuery` 路径，没有新增搜索后端。新增 Personal AI 与 recursive self improvement 的查询扩展回归覆盖。
- 更新目录文案、需求基线、实现状态、适配说明与 README；P2-05 真实业务验收未勾选。

## 最小验证

- `npm ci`：完成（仅在隔离 worktree 安装依赖）。
- `node --import ./tests/standalone.ts --test modules/membership/tests/frontier-podcast.standalone.test.ts`：16/16 通过。
- `node --test-global-setup=tests/databases.ts --import=./tests/databases.ts --test modules/membership/tests/frontier-podcast-db.test.ts`：1/1 通过；使用临时本地 PostgreSQL，测试后已停止并删除临时数据库目录。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：459 条本地 Markdown 链接通过。
- `git diff --check`：通过。

## 风险与交接

- 上游搜索响应仍限制候选范围；员工摘要不展示 partial 检索告警。收录数会随接口返回匹配数变化，任务报告完整 HTML 可能增大。
- 未验证 BidClub 授权、真实账号体验与生产行为；不修改 API 地址或节目内容处理规则。
- 下一步：提交、推送并打开 PR；将 PR URL 与提交 SHA 写入指定结果文件。PR 不由本任务合并。
