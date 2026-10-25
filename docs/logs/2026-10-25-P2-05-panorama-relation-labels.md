# 全景图候选关系标签：按品牌识别母公司与分支

- Agent：coding 助手
- 对应任务：维护任务（不对应 P0–P4 的独立勾选项）；关联 P2-05「对外投资全景图」生产复测遗留问题
- 完成状态：完成（代码与聚焦测试通过；未合并、未部署、未做真实员工验收）

## 背景

生产冒烟（release `8a1a3cf`，2026-10-25）里，员工在「对外投资全景图」查询「宁德时代」。候选排序把内地母公司排在前面，但候选列表没有任何「母公司候选」／「分支机构」标签。

## 根因

`markBranchRelations` 只在「子候选的规范化登记名以父候选的规范化登记名开头」时写 `branchOf`，`companyRelationLabel` 再用 `branchOf` 判定关系。生产候选里，同品牌的子公司登记名是「宁德时代锂动力有限公司」「宁德时代(宁德)销售有限公司」「宁德时代传奇影业有限公司」，与母公司登记名「宁德时代新能源科技股份有限公司」不构成前缀关系，`branchOf` 恒为空，两个标签都不渲染。单元测试用的「${母公司登记名}N 号分公司」恰好是前缀关系，因此旧用例全绿而生产不出标签。

## 本次改动

- `modules/membership/experts/data.ts`
  - 新增品牌关系推导：员工输入的名称是这些候选共有的词干；候选里登记名包含该词干的行属于同一品牌。
  - 品牌下的母公司候选按「内地统一社会信用代码 → 任何信用代码 → 登记名读作法人（股份有限公司／有限责任公司／集团有限公司）」打分选取，同名多行（内地与港／不完整行）只有一行是母公司候选。
  - 同品牌下更长、读作子公司或分支的行（登记名以词干开头、且不以法人形式结尾）标为「分支机构」；读作同一品牌下另一家法人的行不标。
  - 没有候选携带员工输入的名称时不读品牌关系，近似候选不产生关系标签；`isBranchType` 与既有 `branchOf` 关系保持不变，登记名建立的分支关系仍然优先。
  - `companyRelationLabel` 增加可选的查询词参数，标签是给员工的提示，主体仍由员工确认。
- `modules/membership/pages/expert-detail.tsx`：候选选择器把任务里的查询词传给关系标签函数，每个候选只算一次标签。
- `modules/membership/pages/task-detail.tsx`：删除页面自带的 `candidateRelation`，改用同一份 `companyRelationLabel`，两处等待选择主体的页面口径一致。
- `modules/membership/tests/experts-search.standalone.test.ts`：新增生产形状的用例（内地母公司带信用代码、同名港／不完整行、锂动力／销售／传奇影业等子公司、真实分公司），以及近似候选无标签、两处页面同源 helper 的断言。
- `modules/membership/tests/task-detail-page.standalone.test.ts`：断言改为共享 helper。

## 关键决定及理由

- 候选排序未改：生产已把母公司排在前面，问题在标签而不在顺序，排序行为保持原样。
- 品牌关系不写回 `branchOf`：`branchOf` 表示「登记名建立在另一登记名之上」，同品牌子公司的登记名并不建立在母公司登记名之上，写回会让既有排序与提示文案失真。
- 标签判定放在前端共享 helper：候选集合与查询词都已随任务结果下发，页面与详情页用同一份规则，不需要改接口合同。

## 最小验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/experts-search.standalone.test.ts`：17 项通过（新增 4 项）。
- `node --import ./tests/standalone.ts --test "modules/membership/tests/*.standalone.test.ts"`：145 项通过。
- `npm run typecheck`：通过。
- `npm run test:standalone`：374 项中 16 项失败，全部是 `tests/` 下需要 `apps/web/build` 产物的公开站点用例；改动前在同一环境同样失败（已用 `git stash` 复核），与本次改动无关。
- `node scripts/check-doc-links.ts`：通过。
- `git diff --check`：通过。

## 风险与交接

- 未再次调用生产候选接口，未做真实员工验收；标签是提示，不是对母子关系的判定，母公司与分支仍由员工在确认框里选择。
- 同一品牌下读作另一家法人的行（例如「…（上海）股份有限公司」）不标「分支机构」，以免把独立法人说成分支；若真实数据里这类行很多，需要按业务口径再确认。
- 生产部署与复测仍待用户执行；回退本 PR 即恢复原标签行为。

## 修改文件

- `modules/membership/experts/data.ts`
- `modules/membership/pages/expert-detail.tsx`
- `modules/membership/pages/task-detail.tsx`
- `modules/membership/tests/experts-search.standalone.test.ts`
- `modules/membership/tests/task-detail-page.standalone.test.ts`
- `docs/IMPLEMENTATION.md`
- `docs/README.md`
- 本日志
