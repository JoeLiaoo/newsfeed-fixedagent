# 2026-10-28 · P3-04 微信短推标题与回复体验维护

- 任务：WX-A 维护；P3-04 的真实微信业务验收仍为 `[ ]`。
- 状态：代码和本地合成验证完成，待 PR 评审；未部署、未合并。

## 改动与文件

- `modules/membership/notifications/presentation.ts`：短推先为三条标题和精简操作提示留空间，摘要仅在剩余空间容得下完整摘要或句子时显示，不从句中截断；标题总长超过 700 字上限时才缩短。短推仍最多三条、700 UTF-16 code units，发送前重验沿用同一展示器。
- `modules/membership/conversation/{intent,help,replies,semantic}.ts`：数字、展开、详情、中文序数及其他／全部／下一页等自然说法确定性匹配，旧“深读／深度”兼容；帮助改为员工易懂的动作。未匹配且存在本绑定短版次时，可用结构化模型映射既有阅读意图；置信度低于 0.8、无效输出、超时或调用失败返回帮助。模型没有新闻正文输出，详情与目录仍由原 `replies.ts` 按来源可见性、兴趣与绑定版次核对。
- `.env.example`、`docs/{PLAN,IMPLEMENTATION,P3-OPERATIONS,README}.md`、`site/changelog/pending/wx-compact-reading-ux.json`：说明新增默认关闭的 `P3_ILINK_READING_SEMANTIC_ENABLED`、运营启用条件、验收边界和员工可见变化。
- `modules/membership/tests/{notifications-core.standalone,wx-help.standalone,wx-agent.standalone,wx-reading,wx-agent,wx-knowledge,wx-experts}.test.ts`：更新旧提示断言，覆盖长标题、同义词、模型高低置信度／坏结果及无短版次不调用模型。

## 决定与边界

- 语义层独立开关默认关闭，避免现有已开启阅读回复的生产环境新增付费调用。启用还需阅读回复与 `MODEL_CALLS_ENABLED=true`；沿用平台 `chatJson`、回执与已配置的 `LLM_MODEL`，建议使用小型非推理模型。单条输入至多 300 字，模型 4 秒超时，且不使用工具。
- 显式知识库和专家指令沿原路由和授权校验处理。开启语义层后，活动短版次下的其他未知短回复会由语义层分类；低置信度及失败回帮助，可能不再进入自由聊天。关闭开关立即恢复原路由。
- 模型自行报告的置信度只能作为过滤信号；真实员工措辞仍可能被误分，须用手机端复测。模型调用在原入站事务内，最多增加 4 秒等待；上线前需观察延迟与费用。

## 最小验证

- `npm ci --ignore-scripts --no-audit --no-fund`：通过；无依赖变更。
- `npm run typecheck`：通过。
- 相关 standalone 7/7 通过；隔离本机 PostgreSQL 测试库的 `wx-reading`、`wx-agent`、`wx-knowledge`、`wx-experts` 4/4 通过，模型使用本地 HTTP stub；无真实供应商调用。
- `node scripts/check-doc-links.ts`：607 条本地链接通过；`git diff --check`：通过。

## 未验证与下一步

- 未在生产、真实 iLink、真实模型或员工手机验证标题显示、语义识别、实际投递、跨日及窗口恢复。P3-04 继续未勾选。
- PR 评审后按 P3 运维闸门发布；Joe 用真实微信检查三条标题、常见回复和失败兜底，再单独决定是否开启语义开关。员工更新条目保持 pending，由发布流程应用。

## PR #175 复审补充

- 复审发现中文逗号会被当成摘要完整句子的截断点，可能重新出现半句摘要；已在同一分支移除逗号截断点，并增加三条标题仍完整、逗号后长摘要被省略的回归用例。
- 补充验证：`notifications-core.standalone.test.ts` 5/5、`npm run typecheck`、`node scripts/check-doc-links.ts`（607 条）及 `git diff --check` 均通过。真实微信显示与模型语义仍待发布后验证。
