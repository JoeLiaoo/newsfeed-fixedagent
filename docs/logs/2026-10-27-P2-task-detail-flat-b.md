# 2026-10-27 · P2 任务详情阅读区与下载格式维护（B）

- Agent：Codex
- 对应任务：P2 专家任务界面维护；不改变 P2-05 等真实业务验收勾选。
- 完成状态：代码与合成夹具检查完成；待 PR 评审、发布和员工真机复核。

## 修改与决定

- `modules/membership/pages/task-detail.tsx`：成功任务页头保留专家、主题、状态、到期时间及下载入口，结果紧随页头；全景不完整提示紧邻结果。去掉外层结果 Card，HTML 继续用 `srcDoc` 与 `sandbox=""` 的有标题 iframe；纯文本预览改为随页面滚动，并说明完整产物需下载。任务编号、时间、尝试次数、完整输入移到结果后的原生折叠区，材料管理在其下。未完成任务仍先显示候选确认、执行状态或失败原因和相应操作。增加显式任务列表链接，深链接可返回列表；浏览器返回保留原筛选 URL。
- `modules/membership/pages/account-artifacts.tsx` 与 `modules/membership/experts/catalog.ts`：共用下载标签，当前 worker 仅同业看板产出 `.html`／`text/html`，其余内置及自定义专家产出 `.md`／`text/markdown`。列表和详情均按实际存储格式标注，不把 HTML 预览误标为 HTML 下载。
- `modules/membership/tests/task-detail-page.standalone.test.ts`：覆盖两页共用标签及当前专家格式、成功态结构与 iframe 隔离。`README.md`、`docs/IMPLEMENTATION.md`、`docs/README.md` 和 `site/changelog/pending/task-detail-reading.json` 同步员工可见变化与验收边界。
- 未更改 API、产物 MIME／扩展名／附件响应、鉴权、任务或材料七天期限、worker、报告内部 HTML 和专家详情页；无需新依赖或数据库迁移。

## 最小验证与结果

- `npm ci --ignore-scripts --no-audit --no-fund`：安装锁文件依赖；首次类型与测试命令因本 worktree 缺少依赖未启动，安装后重跑。
- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/task-detail-page.standalone.test.ts modules/membership/tests/expert-task-page.standalone.test.ts`：10/10 通过。
- Playwright Chromium + 本地 web 开发服务 + 合成任务接口：375／390／430／1280px 的 HTML 结果页面没有页级横向滚动；390×844 下 iframe 从视口顶部 273px 开始，下载入口顶部 188px，iframe 的 `sandbox` 仍为空。合成长文本预览自身无滚动条，任务信息可展开。queued、running、waiting_input、failed、cancelled、成功空结果、全景不完整提示和 404 均有相应内容或操作；旧 `/tasks?state=succeeded&offset=20` 跳转后保留参数，浏览器从详情返回后仍在筛选列表。所有输入均为合成内容，未运行专家任务或读取员工数据。
- `git diff --check`：通过；`node scripts/check-doc-links.ts`：559 条本地链接均有效。待发布更新日志 JSON 解析通过。

## 未验证、风险与下一步

- 保留固定高度隔离 iframe，长 HTML 在手机仍有 iframe 与页面双滚动；未在 iPhone Safari 真机检查手势、报告末尾或来源链接。Chromium 视口检查不能代表真机验收。
- 没有调用付费专家、下载真实产物、运行数据库鉴权测试或部署；鉴权、到期与附件响应代码未改。完整 Markdown 仍只经下载提供，任务结果中的文本预览受 worker 6000 字截断。
- 评审本 PR 后按既有发布流程部署，再由员工真机复核阅读与下载。P2-05 真实主体与产物验收继续保持未完成。
