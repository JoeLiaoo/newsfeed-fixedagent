# 2026-10-27 · WX-C1 微信知识库问答

- 对应任务：P3-04 的 WX-C1 代码阶段。真实员工微信、真实材料和跨日验收未完成，P3-04 保持 `[ ]`。
- 状态：本分支实现；未部署、未合并、未开启 KB 开关、未使用生产凭据。

## 做了什么与文件

- `modules/membership/knowledge/service.ts` 抽取 active 库列表、已发布页检索和完整问答，网页 routes 与微信共用；`answer.ts` 给微信短答单次受验证模型调用、员工费用归属与有界输入。保留问答落库前的文档状态、页面修订复核；审计不再保存问题原文。
- `conversation/knowledge.ts`、`knowledge-queue.ts` 和 `replies.ts` 增加固定语法的列库、搜页、问答与选库；先走 WX-A 阅读路由，未命中 KB 的文字仍走 WX-B。新增 `0209`–`0211` 会话选库、幂等 run 和回复关联；发送前复核员工 grant、绑定、库、引用页最新修订与材料。只接受固定文字动作，外部输入没有 actor、URL、SQL、路径或凭据参数槽位。
- `.env.example`、`site/modules/server.ts`、`modules/membership/package.json`、知识库与 P3 运维手册、README／实施状态／文档索引和待发布员工更新条目随之更新。未新增依赖。

## 关键决定

- 明确 KB 指令不经 Hermes；首版自然语言未显式命中 KB 时保持 WX-B。每条入站至多一个主要业务动作，最多一次 KB 模型调用；最多六页、总页面正文 24,000 字符、微信输出 1,200 tokens、最多三条关键引用。没有覆盖时不调用模型，也不让 Hermes 补常识。
- 多库先选再重发问题；选中的库归档后提示重选，不回退共享默认库。run 先唯一入队再执行，已开始的未知结果不重放。网页 KB 不受微信开关影响。回退关闭 `P3_ILINK_KB_ENABLED`，不动 bridge／其他生产开关。

## 最小验证与结果

- `npm run typecheck`：通过。
- `node scripts/check-migrations.ts --base=HEAD`：通过；在本机隔离 PostgreSQL 16 测试库经测试框架应用。
- 隔离数据库 `wx-knowledge`、`knowledge-access`、`knowledge-answer-history`、`wx-agent` 与仓库架构检查：18/18 通过。合成模型覆盖双员工同库问答归属、无覆盖、多库选库与归档、重放计费一次、重绑／撤权／修订／页面撤回阻止待发回复；未用供应商或 iLink 真实调用。
- `node scripts/check-doc-links.ts`（579 条本地链接）与 `git diff --check`：通过。

## 未验证事项、风险与下一步

真实模型质量、手机端来源跳转、真实材料覆盖与跨日收发待 Joe 试用。iLink `accepted` 不能证明手机送达。微信回复有 1500 字符上限；较长回答会截短正文，完整内容在登录后的问答记录。部署前需按运维闸确认实际迁移、模型出口成本和逐员工 grant。PR 评审后由 Joe 决定后续发布与开关。
