# 2026-10-26 · #117～#120 员工端更新日志应用与发布检查

- 对应任务：员工端更新日志维护；不改变 P0～P5 的业务验收勾选。
- 状态：本分支已应用并完成定向检查；待 PR 评审、合并与发布，员工界面尚未验收。

## 做了什么与修改文件

- 将 `site/changelog/pending/` 已有的四条待发布记录与 #120 的一条员工可见中文记录一起应用到 `site/changelog.json`，版本从 `2026-10-26T07:15` 更新为 `2026-10-26T10:30`。#120 记录专家产物完整七天可见期、八工具导入专家的全景模式显示，以及 GP 通知不再把演示／导入占位地址当作可核对链接。文案不写供应商品牌，也不宣称真实业务验收完成。
- 已应用的四个 JSON 从 `site/changelog/pending/` 删除；#120 的临时待发布文件参与同一批应用后删除。保留该目录的 `README.md` 和 `.gitkeep`。
- `scripts/apply-employee-changelog.ts`、`package.json` 新增仅供发布前使用的 `npm run changelog:check`：目录里仍有 `.json` 就失败。`tests/employee-changelog.standalone.test.ts` 覆盖失败与通过路径；功能 PR 仍可提交待发布文件，不把这项检查放进普通 PR 的全局 CI。
- `docs/DEPLOY-VOLCENGINE.md` 明确 Pi/Codex 必须在归档／构建前运行应用、提交和检查，并检查 `site/changelog.json` 与待发布目录没有未提交差异。`docs/IMPLEMENTATION.md`、`docs/README.md` 记录本次维护。

## 关键决定

- 更新日志取实际执行 `changelog:apply` 时的北京时间分钟；五条记录共用一个版本号，按文件名顺序写入。没有单独编辑历史记录。
- 发布检查只在部署闸门运行，因为功能 PR 留下待发布 JSON 属于设计内行为；将它放入所有 PR 的常规检查会阻止正常功能开发。

## 最小验证与结果

- 在应用前执行 `npm run changelog:check`：如预期失败并列出五个待发布 JSON。
- `node --import ./tests/standalone.ts --test tests/employee-changelog.standalone.test.ts`：6/6 通过，含发布检查回归用例。
- `npm run changelog:apply`：应用 5/5，版本为 `2026-10-26T10:30`。
- 再运行 `npm run changelog:apply`：输出 `no pending changelog`，没有重复写入；`npm run changelog:check`：通过。
- `npm run typecheck`：通过。`node scripts/check-doc-links.ts`：524 个本地链接有效。`git diff --check`：通过。

## 未验证、风险与下一步

- 未构建镜像、未部署，也未验证生产 `/api/site/meta`、`/api/site/changelog` 与员工红点。合并后的发布负责人仍需在最终构建 tip 上复核有没有新待发布文件，并运行发布闸门；本 PR 的通过结果不能代表未来 tip 自动更新。
- #117～#120 的功能效果和真实业务验收仍以对应工作日志及 `docs/IMPLEMENTATION.md` 为准。
- 下一步：完成定向验证，提交并发起 PR；发布由后续负责人执行。
