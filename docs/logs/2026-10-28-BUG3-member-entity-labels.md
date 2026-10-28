# 2026-10-28 · BUG3 员工端实体标签显示

- 对应任务：P1-04／P1-05 员工端 E2E BUG3 维护；原任务勾选不变，P4-04 员工真实试用仍待完成。
- 状态：[PR #173](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/173) 已于 2026-10-28 squash 合并（`b9b9a50354f0f2a4544e79a55aec55ebae928b2d`）；待发布与员工复验。

## 本次改动

- `modules/membership/tag-labels.ts` 使用现有行业主体词典，将已知 `entity:*` 标记转换为公司显示名，去除重复标签；未知主体标记不输出给员工。
- `modules/membership/server.ts` 在日报响应中转换历史或新生成快照的标签，不改动数据库里供匹配使用的原始标记。信源覆盖按转换后的标签统计去重文章数，避免一篇同时带显示标签和主体标记时重复计数。
- `modules/membership/tests/tag-labels.standalone.test.ts` 与 `modules/membership/tests/access-contract.test.ts` 覆盖已知和未知标记、日报响应、覆盖标签与重复标签。`site/changelog/pending/member-entity-labels.json` 留给发布前应用。
- 本文及 `docs/IMPLEMENTATION.md`、`docs/README.md` 记录验证和验收边界。管理员诊断数据未改动。

## 最小验证

- `npm ci`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/tag-labels.standalone.test.ts`：1/1 通过。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`、`git diff --check`：通过。
- 本机无 `DATABASE_URL`、PostgreSQL 或 Docker，未在本地运行 `modules/membership/tests/access-contract.test.ts` 的数据库集成回归；PR #173 的 PostgreSQL 17 `postgres-integration`、`quality`、`links` 三项检查均通过。未在生产成员账号复验。

## 风险与下一步

- 修改仅影响员工 API 标签展示；已存日报仍保留原始标签用于快照和匹配。未知 `entity:*` 不显示，因此如果行业词典尚无对应名称，该覆盖标签暂不出现。
- 发布后由员工复验我的日报和资讯信源页；P4-04 不因代码修复而勾选。
