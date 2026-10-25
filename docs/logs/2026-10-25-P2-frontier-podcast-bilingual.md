# 2026-10-25 · P2 前沿播客双语检索与中文正文

- 任务：Joe 2026-10-25 要求「前沿播客」的中文、英文话题均覆盖两种语言的节目，英文源节目以中文正文呈现。
- 状态：代码与聚焦测试在 `feat/frontier-podcast-bilingual`；待 PR 评审，未合并、未部署、未做真实员工试用。P2-05 与 P5 的验收勾选不变。

## 做了什么与文件

- `modules/membership/experts/bidclub.ts`：原词与另一语言关键词分别检索，按 slug 去重并交错排列，产物最多收录 6 集；记录实际检索词、扩展检索失败、缺少中文正文的英文源节目集数。英文源节目优先读取 BidClub 的 `tldr_md`、`digest_md` 或 alternate 中文字段；没有中文正文的集数跳过，并继续读取后续候选。
- `modules/membership/experts/worker.ts`：常见词用固定对应词；其他话题通过现有专家模型收据路径只翻译一个检索词。模型不可用或没有生成另一语言时任务报错，避免将单语检索误称为双语。模型不撰写、翻译或补充节目内容。
- `modules/membership/experts/frontier-podcast-view.ts`、`frontier-podcast-html.ts`、`frontier-podcast-markdown.ts`：网页与 Markdown 共用覆盖提示；逐集写明原节目语言与「公开播客文字库中文版」等正文来源。英文源节目的英文导语不作为中文正文展示。
- `modules/membership/experts/catalog.ts`、`README.md`、`docs/PLAN.md`、`docs/IMPLEMENTATION.md`、`docs/P2-EXPERT-ADAPTER.md`、`docs/README.md`：更新能力和运行边界。
- `modules/membership/tests/frontier-podcast.standalone.test.ts`：验证中文查询命中英文源集、英文查询发起中文检索、中文正文优先、无中文版跳过、扩展检索失败提示；既有无结果、单集读取失败及 partial 路径继续回归。

## 决定与边界

- 双语扩展只影响检索词，不改变来源内容。固定词对覆盖常见话题；其他词使用已接入的平台专家模型，因此需要该模型可用。
- 不用平台模型翻译要点与摘要：优先采用出版方自己的中文版；缺少中文版的英文集不收录，防止没有出处的机器译文被当作出版方整理稿。
- 双语检索仍受上游每次 `partial`／`searched_recent` 约 300 集的范围限制；双语不等于全库检索。扩展检索单独失败时会用原词结果并标明遗漏风险。
- 当前没有针对译文与英文版逐句一致性的人工核对，也没有真实员工体验验收。

## 验证

- `node --import ./tests/standalone.ts --test modules/membership/tests/frontier-podcast.standalone.test.ts`：15/15 通过。
- `npm run typecheck`：通过。
- `node scripts/check-doc-links.ts`：433 条本地 Markdown 链接通过；`git diff --check`：通过。

## 下一步

- 评审 PR；合并与部署由 coding 助手执行。上线后用真实中文与英文话题检查两类来源、正文与来源标注，再记录员工验收结果。
