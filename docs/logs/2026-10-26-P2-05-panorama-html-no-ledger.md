# 2026-10-26 · P2-05 全景图 HTML 预览与移除采集台账下载

- Agent：Codex
- 对应任务：P2-05 的员工产物体验维护；真实生产样例与员工验收仍未完成，P2-05 保持 `[ ]`。
- 完成状态：代码完成，PR 评审与 CI 待完成。
- 基线：`origin/main` `c7334e9`；独立 worktree 分支 `fix/panorama-html-no-ledger-download`。

## 本次改动

- 修改文件：`modules/membership/experts/worker.ts`、`modules/membership/experts/panorama-html.ts`、`modules/membership/experts/panorama-checkpoint.ts`、`modules/membership/experts/routes.ts`、`modules/membership/experts/catalog.ts`、专家详情／任务详情／任务历史页、对应全景与任务页测试、`docs/PLAN.md`、`docs/P2-EXPERT-ADAPTER.md`、本日志及文档索引。
- 实际完成：成功的内置全景任务把同一份 Markdown 草稿渲染成无脚本单文件 HTML，保留 `.md` / `text/markdown` 下载；专家页与全局任务详情页用 `sandbox=""` iframe 预览，显示原有不完整状态。移除 checkpoint JSONL 路由、员工任务列表／详情里的 `hasCheckpoint` 与三个下载入口；检查点仍用于服务端断点续跑。调整全景专家技能简介，说明覆盖记录用于核对和续跑。更新需求基线及适配说明。
- 关键决定及理由：HTML 由已生成的 Markdown 转换，避免预览与下载内容分叉；检查点表及恢复读写不变，只移除其导出与员工可见状态。

## 最小验证

- 执行的检查及结果：`npm ci` 成功（未改 manifest 或锁文件）；`node --import ./tests/standalone.ts --test modules/membership/tests/panorama.standalone.test.ts modules/membership/tests/task-detail-page.standalone.test.ts modules/membership/tests/frontier-podcast.standalone.test.ts` 45/45 通过；临时 PostgreSQL 17 上运行 `panorama-db.test.ts` 与 `expert-task-detail.test.ts`，2/2 通过；`npx tsc -p modules --noEmit` 通过；`node scripts/check-doc-links.ts` 检查 460 个链接全部通过；`git diff --check` 通过。
- 未执行或需用户试用的检查：未运行全量测试或网页浏览器视觉检查；真实账号、生产 MCP 全景与员工产物试用待后续验收。PR CI 尚未运行。

## 风险与交接

- 已知限制／缺失依赖：HTML 使用轻量 Markdown 呈现器，仅覆盖报告使用的标题、表格、引用、列表与常见行内格式。`npm ci` 输出提示当前依赖树审计有 5 项告警；本次未更改依赖且未运行修复。
- 下一步：审查 PR diff、等待当前 head 对应 CI 与评审；不要据此勾选 P2-05。生产部署和真实员工验收仍分开记录。
