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

## 当前开发状态（2026-10-25）

阶段勾选与待验收事项见[可视化进度汇报](docs/PROGRESS-REPORT.md)；勾选比例不等于正式上线完成率。

| 阶段 | 代码状态 | 业务／上线状态 |
|---|---|---|
| P0 | 材料、接口矩阵与上游基线已整理；DeepSeek／新华财经完成单次隔离抽测 | P0-03 微信试投按用户决定并入 P3-04；P0 其他业务核验仍待完成 |
| P1 | 账号、兴趣、资讯与个人日报已实现；PR #32 修复信源提交错误归类，PR #33 重组侧栏 | 两项 PR 已合并并随 2026-10-24 的发布上线；需真实员工账号和信源覆盖验证 |
| P2 | 专家导入、任务、新华财经适配底稿已实现；全景图逐层执行、预算、断点续跑与缺口说明已合并 | 用户报告生产现为 `d0713cc`；真实全景样例及员工产物体验仍待验收 |
| P3 | GP 监测与微信管线已实现；员工已核实直投项目清单、关注匹配视图及 GP 管理筛选分页已合并至 `main` | 用户报告生产现为 `d0713cc`；两条连通性测试通知已在手机收到，GP 主体和事件、跨日送达及失效恢复仍待验收。四项开关按用户指示启用，普通聊天仍单独授权 |
| P4 | 新平台已部署并接管 HTTPS 入口；Hermes 网关已运行；旧组件及旧备份按授权退役，P4-02 已勾选 | 新平台备份恢复和员工试运行仍待验收 |
| P5 | 共享投研知识库的上传、构建、独立复核、发布、浏览检索与问答已在 PR #34 合并，CI 与临时数据库场景检查通过 | 生产迁移与部署已随 2026-10-24 的发布完成；两名员工共库、真实材料归因与引用跳转待试用；原件与知识页长期保留 |

生产四项 P3 开关已按用户指示启用；双用户连通性测试消息均获 iLink `accepted`，且两台手机均已确认收到。跨日投递、失效恢复与 GP 业务仍待验收，详见 [P3 运维与验收手册](docs/P3-OPERATIONS.md)。

「赛道同业竞争看板」公开资料检索实现位于当前待评审分支：每个任务固定执行 4 次公开网页检索，至多抓取 3 个来源页，再整理为带来源链接与可得日期的 HTML 看板；没有可靠证据时保留“未披露／未检索到”提示。代码尚未合并、部署或由员工验收，见[实施记录](docs/logs/2026-10-26-P2-06-sector-peer-search.md)。

「前沿播客」已随 [PR #93](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/93) 合并：员工提交中文或英文话题，平台用双语检索词读取公开播客文字库，给出中文正文的网页摘要（单文件静态 HTML，按 beautiful-article / reacticle 的 press 主题排版）与 Markdown 产物；英文源节目使用该库中文版，缺少中文版的集数跳过。要点与摘要标明是该库的整理稿且平台未逐条核验。当前 PR 调整员工摘要的检索提示，并读取所有可用匹配节目；尚未部署或做真实员工验收，见[本轮实施记录](docs/logs/2026-10-26-P2-frontier-podcast-ux.md)与[双语改进记录](docs/logs/2026-10-25-P2-frontier-podcast-bilingual.md)。

全景图 HTML 预览、Markdown 下载及移除员工采集台账下载的改动已随 [PR #97](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/97) 合并（`aa1323a`）；未记录生产发布，真实 MCP 全景样例和员工产物体验仍待验收。
扫码后由服务端确认绑定的修复已随 PR #18 合并（`4a8299f`），并随 [PR #19 发布](docs/logs/2026-10-23-P4-pr19-deployment.md)。二维码新标签页与互动状态框已随 [PR #22 部署](docs/logs/2026-10-23-P4-pr22-deployment.md)。

按用户 2026-10-25 详细复测信息，生产现运行 `46a5b38`（含此前身份与知识库加载残余修复）；该次发布暂无仓库内独立运维日志。合并、发布与真实业务验收分别记录；发布上线不代表真实业务验收完成。材料正文、无效库页面与关联来源显示的后续维护见[工作日志](docs/logs/2026-10-25-P5-kb-detail-functional-fixes.md)，尚未合并或部署。

[2026-10-24 本地进度核查](docs/logs/2026-10-24-progress-check-release-readiness.md)已覆盖专家、GP、通知、知识库及临时库恢复；PR #50～#54 的后续代码仍待生产发布和真实员工验收，任务勾选保持 17/27。

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
- [P2 企业一层对外投资核查与对外投资全景图](docs/P2-EXPERT-ADAPTER.md)
- [共享投研知识库运行手册](docs/KNOWLEDGE-OPS.md)
- [P3 GP 与微信联调](docs/P3-OPERATIONS.md)
- [微信扫码绑定设计与部署后验收](docs/P3-ILINK-QR-DESIGN.md)
- [P0-03/P0-04 外部验收手册](docs/P0-03-04-OPERATIONS.md)
- [P0 资料盘点与外部阻碍](docs/P0-STATUS.md)
- [AIHOT 上游版本、许可证和适配记录](docs/UPSTREAM.md)
- [文档与日志索引](docs/README.md)

仓库为 **public**：不得提交 `.env`、`.config/`、私人名单、用户数据、供应商原始响应或其他敏感内容。后续功能发布及阶段验收仍需完成人员试用和服务器部署核验。
