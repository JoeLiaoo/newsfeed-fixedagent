# 2026-10-26 · PR #114 北京时间架构检查修复

- 任务：修复员工更新日志待发布脚本触发的北京时间架构门禁；属于维护工作，不改变 P0～P5 业务验收状态。
- 状态：PR #114 分支修复，待 CI、评审、合并与生产发布。

## 修改与决定

- `scripts/apply-employee-changelog.ts` 原本用 `Intl.DateTimeFormat` 在脚本内转换北京时间，违反 `tests/architecture.test.ts` 要求转换集中在 `packages/contracts/src/time.ts` 的规则。
- 改用 contracts 的 `beijingDate` 和 `beijingTime` 组成同一 `date`、`time` 与 `latestVersion` 分钟戳；保留无效时间检查。现有 helpers 已能表达需求，未增加架构 allowlist。
- 同步本日志、`docs/README.md` 和 `docs/IMPLEMENTATION.md` 的维护记录。

## 最小验证与结果

- `node --import ./tests/standalone.ts --test tests/employee-changelog.standalone.test.ts tests/architecture.test.ts`：19 项中 18 项通过；北京时间架构门禁通过。数据库结构检查连接 `127.0.0.1:1` 失败，因为 standalone 环境没有 PostgreSQL。
- `node --import ./tests/standalone.ts --test --test-name-pattern='Beijing time is converted only in contracts/time.ts' tests/architecture.test.ts`：1/1 通过。
- `node --import ./tests/standalone.ts --test tests/employee-changelog.standalone.test.ts`：5/5 通过。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：510 个本地 Markdown 链接均有效；`git diff --check` 通过。

## 未验证、风险与下一步

- 未在本地运行 PostgreSQL 集成套件，不能据此宣称 quality 或 postgres-integration 工作流整体通过。推送后复核 PR #114 CI；数据库结构检查仍由具备 PostgreSQL 的 CI 验证。
- 未合并、未部署；发布后员工红点与实际页面体验仍待验收。
