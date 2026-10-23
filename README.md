# 中信私募ai平台

公司内部使用的个性化资讯平台。员工注册并经管理员审核后，可选择关注赛道；首页按个人关注展示当天的公开资讯摘要和来源。实时新闻、专家入口、信源状态和账号管理可从导航进入。全公司共享的投研知识库把员工上传的研究材料编译成观点页、预编译问答、判断框架与监测指标，并支持带引用的问答。

## 本地启动

需要 Node.js 24.11 或更高版本、npm 和 Docker Compose。

```sh
cp .env.example .env
# 填写 SITE_URL、POSTGRES_PASSWORD、ADMIN_PASSWORD、SESSION_SECRET、IMG_PROXY_SIGN_SECRET，以及 DeepSeek API 配置
docker compose up -d --build
```

平台首次启动后，设置一次性管理员变量 `INITIAL_ADMIN_USERNAME`、`INITIAL_ADMIN_NAME`、`INITIAL_ADMIN_PASSWORD`，然后执行：

```sh
docker compose up -d api
docker compose exec api npm run member:bootstrap-admin
```

管理员账号可审核员工注册。员工密码至少 12 位；账号审核通过后才能登录。配置好 DeepSeek 后，后台模型调用仍由 `MODEL_CALLS_ENABLED` 控制。

首次启动通过 `industry/sources.json` 导入示范信源；除人工智能外，新能源、新材料、先进制造和战略配售各有公开 RSS 来源。重新执行 `scripts/seed.ts` 只插入缺少的信源，不覆盖管理员在后台的修改。来源标签说明采集入口，文章所属赛道仍按文章内容分类。

本地代码检查：

```sh
npm ci
npm run typecheck
```

## 当前开发状态（2026-10-24）

阶段勾选与待验收事项见[可视化进度汇报](docs/PROGRESS-REPORT.md)；勾选比例不等于正式上线完成率。

| 阶段 | 代码状态 | 业务／上线状态 |
|---|---|---|
| P0 | 材料、接口矩阵与上游基线已整理；DeepSeek／新华财经完成单次隔离抽测 | P0-03 微信试投按用户决定并入 P3-04；P0 其他业务核验仍待完成 |
| P1 | 账号、兴趣、资讯与个人日报已实现；PR #32 修复信源提交错误归类，PR #33 重组侧栏 | 两项 PR 已合并、未记录生产发布；需真实员工账号和信源覆盖验证 |
| P2 | 专家导入、任务、新华财经适配底稿已实现；独立真实 MCP 调用得到候选、画像与一层直接投资数据 | PR #32 修复已合并、未记录生产发布；完整任务、规则和报告质量仍待联调 |
| P3 | GP 监测与微信管线由 [PR #4](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/4) 引入；[PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 合并了全仓审查整改及通知分片、并发投递修复 | [PR #22](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/22) 已部署（release `8a84319`），两条测试通知获 iLink `accepted`，两台手机均已确认收到；跨日送达、失效恢复及 GP 业务仍待验收。四项开关按用户指示启用，普通聊天仍单独授权 |
| P4 | 新平台已部署并接管 HTTPS 入口；Hermes 网关已运行；旧版归档已完成 | 新平台备份恢复、旧组件处置和员工试运行仍待验收 |
| P5 | 共享投研知识库的上传、构建、独立复核、发布、浏览检索与问答已在 PR #34 合并，CI 与临时数据库场景检查通过 | 尚未记录生产发布；两名员工共库、真实材料归因与引用跳转待试用；原件与知识页长期保留 |

生产四项 P3 开关已按用户指示启用；双用户连通性测试消息均获 iLink `accepted`，且两台手机均已确认收到。跨日投递、失效恢复与 GP 业务仍待验收，详见 [P3 运维与验收手册](docs/P3-OPERATIONS.md)。
扫码后由服务端确认绑定的修复已随 PR #18 合并（`4a8299f`），并随 [PR #19 发布](docs/logs/2026-10-23-P4-pr19-deployment.md)。二维码新标签页与互动状态框已随 [PR #22 部署](docs/logs/2026-10-23-P4-pr22-deployment.md)。

已记录的最新生产发布为 [PR #29](docs/logs/2026-10-23-P4-pr29-deployment.md)（`bd53dcbb`）。[PR #32～#34 的状态与剩余验收](docs/logs/2026-10-24-status-governance.md)按合并、部署、真实业务验收分别记录；Issue 关闭不代表生产验收完成。

## 开发检查

```sh
npm ci
npm run typecheck
npm run test:standalone
node scripts/check-doc-links.ts
```

`npm test` 需要临时 PostgreSQL 环境，不能将未运行的测试视为通过。具体集成检查见 [CI 工作流](.github/workflows/p3-checks.yml)；文档链接检查见 [Docs 工作流](.github/workflows/docs-checks.yml)。

## 文档

- [贡献与仓库治理、合并及上线门槛](CONTRIBUTING.md)
- [Agent 工作约定](AGENTS.md)
- [建设需求基线](docs/PLAN.md)
- [实施状态和剩余验收](docs/IMPLEMENTATION.md)
- [可视化进度汇报](docs/PROGRESS-REPORT.md)
- [P2 首个专家适配矩阵](docs/P2-EXPERT-ADAPTER.md)
- [共享投研知识库运行手册](docs/KNOWLEDGE-OPS.md)
- [P3 GP 与微信联调](docs/P3-OPERATIONS.md)
- [微信扫码绑定设计与部署后验收](docs/P3-ILINK-QR-DESIGN.md)
- [P0-03/P0-04 外部验收手册](docs/P0-03-04-OPERATIONS.md)
- [P0 资料盘点与外部阻碍](docs/P0-STATUS.md)
- [AIHOT 上游版本、许可证和适配记录](docs/UPSTREAM.md)
- [文档与日志索引](docs/README.md)

仓库为 **public**：不得提交 `.env`、`.config/`、私人名单、用户数据、供应商原始响应或其他敏感内容。后续功能发布及阶段验收仍需完成人员试用和服务器部署核验。
