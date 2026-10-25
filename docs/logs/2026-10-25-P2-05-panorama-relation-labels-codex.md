# P2-05 对外投资全景图真实名称关系标签

## 本次改动

- 生产 `8a1a3cf` 冒烟中，「宁德时代」母公司已排首位，但「宁德时代锂动力有限公司」等名称不以母公司完整登记名开头，原 `branchOf` 规则无法显示关系标签。
- 候选关系标签增加查询词范围内的品牌前缀提示：优先以登记类型、信用代码或明确的登记名前缀确定母公司候选；同名记录只标一条，有大陆统一社会信用代码者优先。只有名称携带查询词时才显示，近似候选不标。
- `/experts/:slug` 与 `/tasks/:id` 共用 `companyRelationLabel`；排序、服务端 `branchOf` 与员工确认流程不变。品牌提示不作为股权或法律分支事实。

## 修改文件与决定

- `modules/membership/experts/data.ts`：查询词约束、母公司候选去重和品牌前缀提示。
- `modules/membership/pages/expert-detail.tsx`、`modules/membership/pages/task-detail.tsx`：向共享标签规则传入查询词及近似标记。
- `modules/membership/tests/experts-search.standalone.test.ts`、`modules/membership/tests/task-detail-page.standalone.test.ts`：真实形状名称、同名候选、近似候选和任务详情复用回归。
- `docs/P2-EXPERT-ADAPTER.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`：记录提示口径和 P2-05 未完成边界。

## 验证与边界

- `npm ci`：通过。
- `npm run typecheck`：通过。
- 两个相邻 standalone 测试文件：21/21 通过，含原完整登记名分支回归。
- `node scripts/check-doc-links.ts`：432 个本地 Markdown 链接检查通过。
- `git diff --check`：通过。
- 未调用生产接口，未部署、未做真实员工确认；P2-05 仍待完整全景产物验收，不勾选。
