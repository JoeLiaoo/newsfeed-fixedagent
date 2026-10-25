# 2026-10-25 · 知识库问答 502 修复

- Agent：pi（MiniMax-M3.1-Flash）
- 对应任务：维护任务（不对应 P0–P4）。P5-02～P5-04 的真实员工验收仍未完成，实施计划勾选不变。
- 基线：`origin/main` 的 `e3465e5`（PR #81，生产当前 release）。
- 完成状态：完成（代码与自动化测试）；生产复测待部署后由员工执行。

## 现场证据（2026-10-25 晚间，库 `kb-4e7f876c7f74`「AI for science」，材料 4 · 知识页 9）

- 问「AGI 六问的主要内容是什么？」→ `POST /api/v1/membership/knowledge/answers` 连续两次 **HTTP 502**。
- 页面显示的是新文案「回答没有可核对的引用来源，未生成回答，请重试。」——不是旧的「问答生成失败，可重试」。
- 对照「今天天气怎么样」仍是 **422**「共享库中没有覆盖该问题的已发布内容。」，这条必须保持。
- PR #77 曾把这条记为「偶发 502」并推迟；它不是偶发。

## 根因

1. **回答被引用核对拒给，而不是模型调不动。** 页面显示的是 `knowledge_answer_unverified` 的文案，说明模型调用成功、返回了答案，是服务端核对引用时把整条回答拒了。核对规则与模型实际拿到的输入对不上：
   - 服务端只认**纯数字**的脚注标签（`/^\d+$/`），但平台给模型的每条引用同时带着**页面自己的来源编号**（`S1`、`S2`…，页面正文里就是这个编号）。模型照着输入写 `[^S1]`，就被判成「引用不上」，整条回答丢掉。
   - 服务端要求模型逐字复制页面标识，而标识本身带库前缀与消歧后缀（`kb-…-view-company-…-12345678`）。模型截短一点就被判成「引用不在本轮路由到的页面上」，整条回答丢掉。
2. **一次拒给被反复重放。** 模型回执在收到响应后停在 `received`，问答链路没有把它标成失败；同一个问题的逻辑键相同，下一次提问直接复用同一份回执，于是拿到同一份核不上的回答，再拒一次——这正是「两次 502」，也解释了为什么它不是偶发。
3. **状态码用错了。** 回答没通过核对是服务端判断，不是上游网关故障；回 502 让运维与页面都以为上游出了问题。

## 本次改动

1. **脚注编号由平台给出**（`modules/membership/knowledge/answer.ts`、`prompts.ts`）：本轮每条可用引用编一个 `footnote` 数字，模型在正文写 `[^1]`、在 `citations` 里写回编号、`citationId` 与页面标识；提示词明确「`sourceLabel` 是页面自己的来源编号，只可在正文引用，不要拿它当角标编号」。
2. **核对放宽到模型实际会写的样子，纪律不变**（`answer.ts`）：脚注可以是本轮的编号，也可以是页面自己的来源编号，两者指向同一条引用；页面标识写短了（截断）仍按同页处理，引用 ID 说了算；完全不相干的页面名、指向另一条来源的编号、同一脚注挂两条来源、正文里有脚注却没有任何可核对引用，仍然拒给整条回答。归因、覆盖范围与时效照旧只从库里的记录还原，模型写的分析师与机构一律丢弃。
3. **拒给不再是 502**（`modules/membership/knowledge/routes.ts`）：核不上回 **422** `knowledge_answer_unverified`，模型调不动才回 502 `knowledge_answer_failed`；无覆盖仍是 422 `knowledge_no_coverage`。文案改为「回答未能绑定共享库里的可核对引用，本次未生成回答；请重试或换一种问法。」
4. **拒给的回答不再被重放**（`answer.ts`）：核对失败时把模型回执标成失败释放，下次提问重新调用模型；提示词版本从 `wiki-answer-2` 升到 `wiki-answer-3`，旧回执不会被复用。

## 修改文件

- `modules/membership/knowledge/answer.ts`、`modules/membership/knowledge/prompts.ts`、`modules/membership/knowledge/routes.ts`、`modules/membership/knowledge/catalog.ts`。
- 测试：`modules/membership/tests/knowledge-core.standalone.test.ts`、`modules/membership/tests/knowledge-access.test.ts`。
- 文档：`docs/KNOWLEDGE-OPS.md`、`docs/IMPLEMENTATION.md`、`docs/README.md`、本日志。

## 最小验证

- `npm run typecheck`：通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts`：33/33 通过。新增覆盖：脚注用本轮编号、用页面来源编号、模型自己编号而返回来源编号、装饰过的角标、页面标识截短仍算同页、指向另一来源编号被拒、本轮编号只属于本轮。
- PostgreSQL 17 临时库：`modules/membership/tests/knowledge-access.test.ts`、`knowledge-bases.test.ts` 2/2 通过；数据库集成覆盖核不上回 422（不再是 502）、核不上的回答不会被重放（第二次提问确实又调了一次模型）、用来源编号作脚注的回答回 200 且归因仍来自库里、无覆盖仍回 422。
- 未运行全量 `npm test`；未连接生产数据库、未调用真实模型、未用真实员工账号复测。

## 风险与交接

- 放宽的是**写法**，不是纪律：每一条脚注仍须指向本轮给出的一条库内引用，模型自拟的引用、跨页的引用、没有引用的正文仍然拒给整条回答。
- 核不上的回答现在会真的再调一次模型（回执释放），费用随之增加；这是回执机制既有的口径（「不可用的回答让下一次尝试重新付费」），已在 `docs/KNOWLEDGE-OPS.md` 写明。
- 本分支 **0 条迁移**、0 个开关变更；合并与发布遵循现有运维闸门。
- 下一步：部署后用「AGI 六问的主要内容是什么？」等有覆盖的问题验证 200 与引用，用「今天天气怎么样」验证仍是 422；若仍出现 422，需按 `docs/KNOWLEDGE-OPS.md` 核对回执状态与模型输出，再判断是模型语义问题还是路由问题。
