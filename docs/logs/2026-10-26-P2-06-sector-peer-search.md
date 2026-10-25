# 2026-10-26 · P2-06 赛道同业公开资料检索

- 对应任务：P2-06。
- 状态：实现与定向验证完成；PR #100 已合并，用户报告生产运行包含该变更的 `07488ac`；首次员工任务在模型整理阶段失败，见[故障记录](2026-10-26-P2-06-sector-peer-model-reject.md)，真实业务验收未完成。
- 基线：独立 worktree 从 `origin/main` `036cb10` 建立；未触碰其他 worktree 或原工作目录中的未提交改动。

## 做了什么

- 将 `sector-peer-landscape` 从 P0 空看板升级为受限公开资料检索流程：同业、阶段信号、境内资本事件、美国参考各执行一次 Search，每次最多 5 条结果并请求正文；正文不足时最多 Fetch 3 个来源页；最后最多调用一次结构化模型整理。
- 所有来源 URL 仅接受 HTTPS 且通过公开地址检查；模型输出的每条事实须含本次来源 ID，服务端剔除未检索 ID 或跨中国／美国分区的引用。来源标题、URL、日期都来自检索结果或 Fetch 返回，不由模型生成。无可靠证据的分区显示「未披露／未检索到」，并列检索缺口。
- Search / Fetch 与已有 DeepSeek `deepseek` 收据、预算及费用台账共用服务标签，分别以 `expert_search`、`expert_fetch` 用途区分；不新增数据库迁移或依赖。检索和抓取最多 7 次，按公开费率估算每次非空请求 ¥0.005、空结果 ¥0，工具调用费用上限约 ¥0.035／任务；结构化模型请求最多 1 次，费用按现有模型用量收据记录。
- 服务开关关闭或 models 凭据缺失时明确失败，不再成功返回空壳。worker 在每次付费请求前检查任务租约；收据只保留查询身份哈希，不写明文查询到请求摘要。目录描述、技能文本、查询提示与 HTML 只写能力，不出现供应商品牌。

## 修改文件

- `packages/backend/src/providers/deepseek-search.ts`
- `modules/membership/experts/worker.ts`
- `modules/membership/experts/sector-peer-html.ts`
- `modules/membership/experts/catalog.ts`
- `modules/membership/pages/expert-detail.tsx`
- `modules/membership/tests/expert-catalog-coming-soon.test.ts`
- `modules/membership/tests/expert-coming-soon.standalone.test.ts`
- `docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/PROGRESS-REPORT.md`、`README.md`、`docs/README.md`

## 决定与边界

- 单任务上限：4 次 Search × 最多 5 条结果 + 最多 3 次 Fetch + 1 次结构化模型请求；无翻页、无模型生成的新搜索词、无新华财经或专有企业数据。HTML 继续作为预览与下载产物。
- 日期沿用搜索元数据的日期；Fetch 不足以证明事实日期时显示「未提供」，不推断融资或产品事件发生时间。公开检索不是全量覆盖，不披露不等于不存在。
- 不新增迁移：Search / Fetch 收据记录复用现有 `deepseek` 服务预算，`purpose` 区分检索、抓取与模型整理；每次 Search / Fetch 返回非空结果按 ¥5/1000 次记 ¥0.005 估算；空结果记 ¥0。
- 因为功能还未发布，未修改员工端站点更新日志；待合并与发布后按实际状态同步。

## 定向验证

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/expert-coming-soon.standalone.test.ts`：5 项通过，覆盖目录文案、URL 与输入转义、来源 ID 白名单、空来源不伪造、沙盒预览。
- PostgreSQL 17 一次性测试库下运行 `expert-catalog-coming-soon.test.ts`：1/1 通过。注入 Search / Fetch HTTP 传输桩，核对 4 次 Search、最多 3 次 Fetch、请求数量／正文选项、128 字符 query 上限、凭据头与来源日期；四组空 Search 输出缺口并按零费用入账；开关关闭时任务明确失败且不产生 artifact。
- `node --import ./tests/standalone.ts --test --test-skip-pattern='every table and column' tests/architecture.test.ts`：13/13 通过，含北京时间边界。
- `node scripts/check-doc-links.ts`：480 个本地 Markdown 链接均存在；`git diff --check`：通过。
- 未调用真实 Search、Fetch 或模型服务；员工真实账号体验、供应商持续可用性、事实准确率仍待验收。

## 下一步

- PR：[PR #100](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/100)，已合并（`cc1a5af`）；用户报告生产现为 `07488ac`，包含该变更。实现提交 `e390415ba040e6710dbe2ec1ae3acb6440aef1d7` 的 `quality`、`links`、`postgres-integration` 检查均通过。
- 首次员工任务证实搜索成功、模型整理请求失败；修复与模型侧复验见[故障记录](2026-10-26-P2-06-sector-peer-model-reject.md)。员工对看板来源及覆盖范围的验收仍待完成。
