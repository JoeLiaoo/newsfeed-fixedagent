# 2026-10-25 · 生产只读冒烟问题修复

- 对应任务：P5-04 问答真实验收、P3-01～P3-03 GP 证据、P1 员工信源视图的维护修复；均不改变原阶段勾选。
- 状态：[PR #70](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/70) 已合并；按用户 2026-10-25 提供的信息，生产现运行 `d0713cc`。本日志所记本地测试不等于员工真实业务验收。

## 做了什么

- 问答路由已由 `registerMembership` 在 API 入口安装。员工鉴权边界无会话返回 401；有会话但问题没有命中本库已发布知识页时，旧代码返回 `404 knowledge_no_coverage`，与路由缺失的 404 混淆。「这是什么知识库」是泛问句，路由要求具体标的或页面内容匹配，在示例库无相关已发布页时会走该分支。现改为 422，并让 GET 接口返回 405；表单下方持久显示后端中文错误或 API 缺失提示。未取得生产该请求的响应体，故生产 404 的具体来源仍需部署后核对，不能仅凭状态码断言。
- GP 员工接口对 `example.org`、`example.com`、`example.net` 的演示 URL 不再返回可点击来源；卡片标为「演示/导入占位 · 无可核对来源」。其他有效 HTTPS 来源仍返回链接。未更改历史审核数据，真实 GP 主体和投资事实待管理员核准。
- 员工信源接口继续读取与 About 统计相同的 `sources` 表，新增启用数；页面只有成功读到有效响应才显示空池，显示共享池总数，并解释赛道覆盖只计近七天已发布内容。若实时清单为空而 About 的缓存快照仍有信源，会明确提示两处不一致。当前代码无法证明生产当时为何显示两个空状态；发布后应比对员工接口、About 缓存快照和实际表行数。
- 专家企业名称空提交显示中文提示；受控文件上传入口显示中文选文件文案。

## 修改文件

`modules/membership/knowledge/routes.ts`、`modules/membership/pages/knowledge-base.tsx`、`modules/membership/server.ts`、`modules/membership/pages/sources.tsx`、`modules/membership/gp/routes.ts`、`modules/membership/gp/source.ts`、`modules/membership/pages/projects/invested-gp-state.ts`、`modules/membership/pages/projects/invested-gp.tsx`、`modules/membership/pages/expert-detail.tsx`、`modules/membership/pages/expert-new.tsx`、`apps/web/app/components/member-ui/file-input.tsx`、相关测试、`docs/KNOWLEDGE-OPS.md`、`docs/IMPLEMENTATION.md`、`docs/README.md` 与本日志。

## 最小验证与未验证事项

- `npm run typecheck`、`npm run build -w @aihot/web`、GP/知识库独立测试、文档链接及差异空白检查通过。
- 隔离 PostgreSQL 17 容器运行知识库访问、分库问答、GP 项目、员工信源四个数据库场景测试，4/4 通过。问答覆盖 200 回答、422 无覆盖、405 GET 和鉴权 401；GP 测试证实演示 URL 不下发；信源测试证实员工看到共享源与赛道覆盖。
- 全量 `npm run test:standalone` 未通过：原有页面元数据用例中的桩 Web 服务返回 503，公开只读端点方法用例期待 405 但员工鉴权边界返回 401；此前 GP 员工页日志已有同类记录。本次新增 GP 来源独立测试及知识库核心独立测试 29/29 通过。未扩大本 PR 去修无关用例。
- 全量 `npm test` 在同一隔离数据库执行，共 1060 项、917 通过、143 失败；最早的失败是旧公共 API 测试期待匿名 200/400，当前全站员工鉴权返回 401，另有备份等环境用例失败。相关四个成员模块场景已单独通过，不能把全量失败记为通过。
- 本轮修复时未连接生产数据库、未调用真实模型或用员工账号复测。此后用户报告 `d0713cc` 已在生产发布；发布操作与上线后验收证据未记录在本日志。代码自身没有新迁移。

## 下一步

用具体已发布知识页的问题验证 200 与引用，用泛问句验证 422 提示，并核对信源接口与 About 的实时／缓存差异、GP 真实来源与占位记录。
