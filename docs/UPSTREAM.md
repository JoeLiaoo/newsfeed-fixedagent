# AIHOT 上游基线与适配记录

- 上游：[`KKKKhazix/AIHOT`](https://github.com/KKKKhazix/AIHOT)
- 固定版本：`47531faa635c7f4313e526dd0b56312c1a23ba30`（2026-10-21 核对）
- 许可：MIT；保留上游 `LICENSE` 和 `NOTICE`。第三方字体仍按其独立许可说明。
- 技术基线：Node.js 24、TypeScript、React Router、Fastify、PostgreSQL、pg-boss。

本仓库引入 AIHOT 的 API、worker、web、共享包、数据库迁移、部署文件、站点与行业引擎和示范 RSS 信源。保留本项目自己的 `AGENTS.md`、`README.md`、`docs/`、`reference/` 和 `.gitignore`，没有覆盖业务需求与项目约定。

适配改动：

- 站点文字改为“中信私募ai平台”，不使用 AIHOT 名称或上游图标；采用浅色页面与克制的红色强调。
- 通用模型凭据兼容 `DEEPSEEK_API_KEY`；保留 AIHOT 原有 `LLM_API_KEY` 配置方式。员工账号的初始管理员通过一次性命令创建。
- 在 `modules/membership` 增加员工注册、管理员审核、会话、兴趣赛道、RSS/网页列表信源和个人日报模块。
- 将用户确定的五个投资方向及预置细分标签加入内容结构化标签白名单。

首版仍沿用 AIHOT 的公共内容发布层。员工页面只读取已发布且可公开展示的摘要；未发布、撤回或被隔离的采集内容不会进入个人日报。网站列表抓取使用 AIHOT 的公开页面采集器，无法读取登录或付费内容。

上游尚未包含本项目的专家任务、新华财经 MCP、GP 事件和个人微信投递；这些不能视为已接入。上游代码复制后尚未在有真实数据库和采集 worker 的环境中做双账号端到端试用，实际文章来源可达性和分类效果仍待业务试用反馈。
