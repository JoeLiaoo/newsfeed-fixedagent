# WX-C2 微信专家指令前缀宽容度修复 · 2026-10-27

任务：手机 B4 现场问题——Joe 于 2026-10-27 在微信发送 `帮我跑同业看板：宁德时代`，入站正文与该字符串完全一致，却被路由到 Hermes 自由对话而不是微信专家。本分支只施工，不合并、不部署、不改生产开关。

## 现象与定位

- `modules/membership/conversation/experts.ts` 的 `parseExpertIntent` 创建语法为 `^跑\s*(全景图|…|同业看板|…)\s*[:：]\s*(…)$`，必须以 `跑` 开头；自然句式只认 `^帮我跑一个(.{2,80})赛道同业看板[。.]?$`。
- `isExpertCommand` 为 `^(列专家|专家列表|跑|…)`，`帮我跑…` 不匹配任何专家前缀。
- 帮助文案只示范 `跑同业看板：企业或赛道`，但中文口语常加 `帮我`／`请`／`麻烦`。`阅读` 侧另有同类问题：Joe 在 A2 输入 `深度1`，`readingIntent` 只认 `深读`／`第 N`，`深度1` 落到 unknown。

## 实施

- `conversation/experts.ts`：抽出 `POLITE='(?:请?帮我|请|麻烦)?\\s*'`，`列专家／专家列表`、自然句式、创建指令与 `isExpertCommand` 四个正则统一前置该可选前缀。`帮我跑同业看板：宁德时代`、`请帮我跑全景图：xxx`、`麻烦跑前沿播客：话题`、`帮我跑一个储能赛道同业看板` 与原 `跑…：…` 等价；`进度 A`、`取消 A`、`任务 A 选 N`、`停止任务 A 提醒` 的解析规则未改，`请列专家` 同时可用。前缀只影响指令入口，候选白名单、输入长度与 `unsafeInput` 拒绝规则保持原样。
- `conversation/intent.ts`：`深度` 与 `深读` 同义，`深度1`／`深度 1` 解析为 detail 1；只放宽到 1–5，`深度6` 与 `深度` 仍为 unknown。
- 未改轮询间隔、未改无效输入的统一帮助逻辑、未做其他重构。

## 验证

- `npm run typecheck` 通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/wx-experts.standalone.test.ts modules/membership/tests/notifications-core.standalone.test.ts`：5 个用例通过（含新增“礼貌前缀”用例与 `深度1` 断言）。
- `DATABASE_URL=…/newsfeed_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/membership/tests/wx-experts.test.ts modules/membership/tests/wx-reading.test.ts`：2 个用例通过；新增 `帮我跑同业看板：宁德时代` 真实入站建任务（slug `sector-peer-landscape`、输入 `宁德时代`、别名 B）与 `深度1` 展开第 1 条。
- `modules/membership/tests/wx-*.test.ts`、`expert-*.test.ts` 与同名 standalone 一起跑：25 个用例通过。

## 未验证与边界

- 未在真实手机复测“帮我跑…”与“深度1”的实际投递；`accepted` 只代表渠道受理。
- 未部署、未合并；生产 `P3_ILINK_EXPERTS_ENABLED` 等开关状态不变。
- 供应商返回、任务额度与跨日报回报仍按 WX-C2 原边界，P3-04 保持 `[ ]`。
- 放宽前缀后，诸如 `请进度 A` 这类不完整指令仍按专家帮助文案提示，不触发任务动作。

下一步：PR 评审；发布后由员工在手机上重发 `帮我跑同业看板：宁德时代` 与 `深度1` 复核。回退只需还原 `conversation/experts.ts` 与 `conversation/intent.ts` 两处正则，无迁移与数据影响。
