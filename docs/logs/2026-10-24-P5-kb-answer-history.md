# 2026-10-24 · 知识库问答记录（历史列表与回跳）

- Agent：pi（MiniMax-M3.1-Flash）
- 对应任务：维护任务（补充 P5-04 的可用性，不改动 P5-02～P5-04 的验收勾选）
- 完成状态：代码与测试完成，PR 已开，未合并、未部署；真实员工验收待执行

## 本次改动

- 修改文件：
  - `modules/membership/knowledge/history.ts`（新增）：读取问答记录的纯函数与引用回跳的联表。
  - `modules/membership/knowledge/routes.ts`：新增 `GET /api/v1/membership/knowledge/answers`；`POST /answers` 的响应引用在返回前补齐材料信息。
  - `modules/membership/pages/knowledge-base.tsx`：新增「问答记录」卡片（列表、展开、分页、空状态）；问答与历史共用同一套「参考资料」渲染（目标页／材料／原件）。
  - `modules/membership/tests/knowledge-answer-history.test.ts`（新增，数据库用例）、`modules/membership/tests/knowledge-core.standalone.test.ts`（新增纯函数用例）。
  - `.github/workflows/p3-checks.yml`：把新增的数据库用例文件加入 PostgreSQL job。
  - `docs/KNOWLEDGE-OPS.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。
- 实际完成：员工登录后可在知识库页打开本库的「问答记录」，看到自己问过的问题、时间与覆盖口径，点开一条即可读到当时的回答正文，并从引用跳回依据页（`/knowledge/targets/:slug`）、材料详情（`/knowledge/documents/:id`）与原件（`/versions/:id/original`）；列表按 `limit`/`offset` 分页，带上一页／下一页与空状态、读失败提示。
- 关键决定及理由：
  - **范围规则**：`member_wiki_answers` 没有 `base_id` 列，回答与库的对应关系由它记录的 `pages`（本次回答所用的知识页 slug）派生——回答的 `pages` 中只要有一个 slug 属于该库，这条回答就算该库的回答。页被撤回时行仍在，归属不变；页被彻底删除时该回答会落出该库范围（当前库内没有删除页面的入口）。
  - **只看自己的**：默认只返回 `asked_by = 当前员工` 的回答。文档没有把问答记录定为库内共享，因此不把别人的回答暴露给同一库的其他员工；管理员也按本人记录看自己的问答。
  - **引用回跳在读取时补齐**：库里的回答 JSON 只记了 `versionId`（`citationId` 也有）。读回答时按「`versionId` → `citationId` → 页面当前唯一引用」的顺序联表补出 `documentId`／`documentTitle`／`fileName`；页面有多条来源时不猜，材料留空、页面显示「未知」。回答 JSON 里若已带 `documentId`／`documentTitle`／`fileName`（例如后续 PR 在写入时补上），原样透传。
  - **不补造元数据**：缺失的分析师、机构、日期一律为 `null`，页面显示「分析师未知／机构未知／日期未知」；覆盖度按记录读出，没有记录就是 0 与空，不按页面积累。
  - **新回答与历史回答一致**：`POST /answers` 的响应也在返回前走同一套联表，因此刚问出来的回答和从历史里打开的旧回答给出同样的「目标页／材料／原件」入口。
  - **引用兼容已合并的 #56**：历史读取优先保留已存 `documentId`／`documentTitle`／`fileName`；较旧回答按版本 ID、引用 ID 或唯一来源联表补齐材料信息。

## 最小验证

- 执行的检查及结果：
  - `npm run typecheck`（contracts／backend／api／worker／tests／modules／web）通过。
  - 新增数据库用例 `modules/membership/tests/knowledge-answer-history.test.ts` 通过：访客 401；只返回本人回答；另一员工看不到别人的回答；另一库的回答不出现在本库、本库的回答不出现在另一库；引用能补出 `documentId`／`versionId`／`documentTitle`／`fileName`；按 `citationId` 与「页面唯一来源」两条回退路径都能补出材料；页面有两条来源时不猜材料；缺失的分析师／机构／日期保持 `null`；分页 `limit`/`offset`、`hasMore`/`nextOffset` 正确；非法 `limit`／`offset` 返回 400。
  - 既有知识库用例 `knowledge-access.test.ts`、`knowledge-bases.test.ts` 仍通过（改动只影响 `POST /answers` 的响应字段）。
  - `modules/membership/tests/knowledge-core.standalone.test.ts` 29/29 通过（新增纯函数用例：缺失字段保持空、覆盖与时效按记录读出）。
  - `tests/architecture.test.ts` 14/14 通过（本地 PostgreSQL）。
  - `node scripts/check-doc-links.ts` 与 `git diff --check` 通过。
- 未执行或需用户试用的检查：未跑全量 `npm test`（按仓库约定只做最小验证）；未做浏览器视觉验收；未连接生产数据；未做真实员工账号的页面验收。

## 风险与交接

- 已知限制／缺失依赖：
  - 回答的历史按本员工记录展示，跨员工不可见；若产品后来决定库内共享，需要改 `asked_by` 这一条判断并同步文档。
  - 引用回跳依赖 `member_wiki_document_versions`／`member_wiki_documents`／`member_wiki_citations` 的行还在；材料被撤回时原件接口按既有规则返回 404（上传者与管理员看到 410），链接仍在，由服务端裁决。
  - 列表按 `created_at` 倒序，同一秒内的多条以 `id` 兜底排序。
  - 未新增迁移，未新增供应商调用，未触碰企业舆情／BettaFish。
- 下一步：PR 评审通过后再安排真实员工在知识库页试用（提问 → 离开页面 → 重新打开 → 回跳材料与原件）。P5-02～P5-04 的验收状态不变，仍未勾选。

## 2026-10-26 基于 PR #55/#56 合并后的 main 复基

- 复基到包含 PR #55（`9179785`）与 PR #56（`c207c01`）的当前 `main`；保留 #56 的引用字段和构建列表分页，并将 #58 的 GET 问答历史读取接入原本返回 405 的 `/answers` 路由。
- 同步运维手册：`GET /answers` 现表示已鉴权的本人历史记录；`POST /answers` 继续用于提问，无覆盖仍返回 422。
- `npx tsc -p modules`：通过；知识库 standalone 34/34 通过；问答历史、知识库访问和多库数据库测试 3/3 通过（本机 PostgreSQL）；文档链接 487 条通过；`git diff --check` 通过。
- 本地 `npm run typecheck` 在 `@aihot/web` 因未安装 `@radix-ui/react-dropdown-menu` 与 `@radix-ui/react-toggle-group` 失败，并伴随 `Tabs.tsx` 隐式 any；GitHub 新 head 的质量检查仍须完成。
- 主线专家页面检查未发现 `hasCheckpoint` 或采集台账 JSONL 下载 UI。未部署；真实员工验收仍待完成，P5-02～P5-04 保持未勾选。

PR：[#58](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/58)，分支 `feat/kb-answer-history-v1`。

## 初始 head 的自动检查结果（PR #58）

- `quality`（typecheck、web 构建、standalone 106/106、架构规则、docker build）：通过。
- `postgres-integration`（含新增的 `knowledge-answer-history.test.ts`，数据库用例 33/33）：通过。
- `links`（文档链接 386 个）：通过。
- 这些结果来自复基前的 tip `23557f1`，不代表 2026-10-26 复基 head 的 CI 状态。

## 2026-10-26 合并状态

- PR #58 基于 PR #55/#56 合并后的 main 复基，`links`、`quality`、`postgres-integration` 全部通过，已 squash 合并为 `b2dd6f872dabe83e5d955d770ad31f7a9f1482a9`。
- 尚未部署；P5-02～P5-04 的真实员工验收待执行。
