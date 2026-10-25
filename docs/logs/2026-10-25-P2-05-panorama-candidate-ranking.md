# 对外投资全景图母公司候选排序

## 背景

生产复测「宁德时代」候选时，12 条候选中母公司排第 11，员工选择器也未显示母公司／分支关系。此次仅修复候选排序与员工可见关系提示；没有对生产接口重新发起查询。

## 变更

- 候选检索结果先标记分支登记名对应的母公司，再进行排序和 12 条上限截断。
- 排序把已被分支候选引用的母公司排在分支前，并规范化空白及常见登记名标点后比较名称。
- 员工选择器按关系显示「母公司候选」或「分支机构」标签；已有分支提示保留。
- 增加 12 条分支密集候选回归测试，验证母公司优先、信用代码候选和关系标签。

## 修改文件

- `modules/membership/experts/data.ts`
- `modules/membership/experts/worker.ts`
- `modules/membership/pages/expert-detail.tsx`
- `modules/membership/tests/experts-search.standalone.test.ts`
- `docs/IMPLEMENTATION.md`
- `docs/README.md`

## 验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/experts-search.standalone.test.ts`：13 项通过。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：通过，422 个本地 Markdown 链接目标存在。
- `git diff --check`：通过。

## 未验证与下一步

- PR #88 已 Open；截至提交 `902b7ee`，quality、Docs links 与 PostgreSQL integration checks 全部通过。仍未合并或部署。
- 没有再次调用生产候选接口，也没有真实员工验收；部署后的生产复测仍待用户执行。
- 全景专家 P2-05 的真实任务、数据覆盖和报告质量验收仍未完成，保持未勾选。
