# 2026-10-25 · P5 知识库详情功能测试修复

- 对应任务：P5-02～P5-04 的生产详细功能测试维护；真实员工验收标准尚未满足，实施计划勾选不变。
- 基线：用户报告生产与本分支基线均为 `46a5b38`。本轮没有连接或修改生产。

## 本次改动

1. 材料详情接口只对成功提取的 Markdown 版本返回 UTF-8 原件正文；员工详情页在元数据与下载入口之外显示正文。既有 Markdown 渲染器补上一级标题显示，并收紧链接协议与属性转义。
2. 无效库 ID 的 404 留在 `/knowledge/bases/:id` 显示「知识库不存在。」及返回链接；只有鉴权 401 转登录，其他读取失败显示重试提示。
3. 知识页详情返回同库已发布目标的标题、完整与本地 slug。已存在的关联被解析为可读标题和有效链接；同一批次内的关联不再被 lint 误报。历史遗留的 `related-target-missing` 仅在目标已经发布时从详情中隐藏，真实缺失的目标保留。页头来源数使用实际显示的引用条数。
4. 问答偶发 502 未改动。服务端模型调用由收据机制管理，未知结果不得在浏览器或同一请求里盲目重发。当前报告没有响应错误码或收据证据，无法判定是供应商暂时拒绝、超时还是输出未通过引用校验；需按运行手册核对脱敏错误码和收据状态后再确定措施。

## 修改文件

`modules/membership/knowledge/{routes,lint}.ts`、`modules/membership/pages/{knowledge-base,knowledge-document,knowledge-target}.tsx`、`apps/web/app/lib/markdown.ts`、知识库逻辑／访问／浏览器测试、`README.md`、`docs/{IMPLEMENTATION,KNOWLEDGE-OPS,README}.md` 与本日志。

## 最小验证

- `npx tsc -p modules --noEmit`、`npm run typecheck -w @aihot/web`、`npm run build -w @aihot/web` 通过。
- `node --import ./tests/standalone.ts --test modules/membership/tests/knowledge-core.standalone.test.ts`：29/29 通过，包括同批次关联 lint。
- 构建后 `node --test apps/web/tests/prod-smoke-remainders.test.ts`：7/7 通过，包括材料正文、无效库缺失态和关联标题／来源数。
- PostgreSQL 17 临时容器中运行 `knowledge-access.test.ts`：1/1 场景通过，覆盖其他已批准员工读取正文、历史误报过滤与真缺失问题保留；容器已停止。
- PostgreSQL 17 临时容器中运行 `tests/architecture.test.ts`：14/14 通过，包括圆角刻度规则；容器已停止。
- `node scripts/check-doc-links.ts`、`git diff --check` 通过。

## 未验证事项与下一步

未运行全量测试，未连接生产、未调用真实模型或使用员工会话复测；真实 Markdown 格式、历史关联和来源统计仍需发布后由员工核对。Q&A 502 需在不记录用户问题或接口原文的前提下，核对服务端错误码、收据状态与提供商失败类型，再决定是否需要调整模型或运维。无迁移、开关或凭据变更；本 PR 不承担发布或真实业务验收。
