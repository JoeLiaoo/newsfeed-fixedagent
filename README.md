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

首次启动通过 `industry/sources.json` 导入示范信源；除人工智能外，新能源、新材料、先进制造和战略配售各有公开 RSS 来源。国内首批信源含海外独角兽（公开播客 RSS）、拾象科技（官网报告列表）、晚点 LatePost（官网晚点聊 RSS）、极客公园（官网 RSS）和机器之心（官网文章库 JSON 列表）。重新执行 `scripts/seed.ts` 只插入缺少的信源，不覆盖管理员在后台的修改。来源标签说明采集入口，文章所属赛道仍按文章内容分类。

本地代码检查：

```sh
npm ci
npm run typecheck
```

## 当前开发状态（2026-10-26）

阶段勾选与待验收事项见[可视化进度汇报](docs/PROGRESS-REPORT.md)；勾选比例不等于正式上线完成率。

| 阶段 | 代码状态 | 业务／上线状态 |
|---|---|---|
| P0 | 材料、接口矩阵与上游基线已整理；DeepSeek／新华财经完成单次隔离抽测 | P0-03 微信试投按用户决定并入 P3-04；P0 其他业务核验仍待完成 |
| P1 | 账号、兴趣、资讯与个人日报已实现；PR #32 修复信源提交错误归类，PR #33 重组侧栏 | 两项 PR 已合并并随 2026-10-24 的发布上线；需真实员工账号和信源覆盖验证 |
| P2 | 专家导入、任务、全景图、同业看板、前沿播客已实现；本分支新增地区上市公司基金参与专家，采用披露候选规则解析、有限发行人样本与 HTML/Markdown 产物 | 本功能待 PR 评审、发布及员工复验；地区发行人覆盖、公告解析和备案公示字段仍需真实样例核验 |
| P3 | GP 监测与微信管线已实现；本分支增加 iLink 会话近失效提醒，待评审 | 用户报告生产现为 `d0713cc`；两条连通性测试通知已在手机收到，GP 主体和事件、跨日送达及失效恢复仍待验收。四项开关按用户指示启用，普通聊天仍单独授权 |
| P4 | 新平台已部署并接管 HTTPS 入口；Hermes 网关已运行；旧组件及旧备份按授权退役，P4-02 已勾选 | 新平台备份恢复和员工试运行仍待验收 |
| P5 | 共享投研知识库支持文件与公开网页链接异步入库、自动识别材料信息、构建复核与带引用问答；本分支新增 PDF 的有界整页渲染（页图进同一套图表证据链路），待评审 | 生产迁移与部署已随 2026-10-24 的发布完成；本分支不部署；两名员工共库、真实材料归因与引用跳转待试用；识图与页面渲染质量尚未经真实模型与真实研报验证 |

生产四项 P3 开关已按用户指示启用；双用户连通性测试消息均获 iLink `accepted`，且两台手机均已确认收到。跨日投递、失效恢复与 GP 业务仍待验收，详见 [P3 运维与验收手册](docs/P3-OPERATIONS.md)。

WX-A 为新闻微信首推增加一条短摘要和按已推送版次的阅读追问，两个新开关默认关闭；完整日报仍在网页，GP 汇总格式不变。本地实现与验收边界见 [WX-A 工作日志](docs/logs/2026-10-27-WX-A-short-digest-reading.md)。

WX-B 为已授权员工的微信自由文本增加经宿主机隔离 Hermes CLI 的简短回复，默认关闭；“深读 N”等仍按 WX-A 的确定性路由处理。部署边界与剩余验收见 [WX-B 工作日志](docs/logs/2026-10-27-WX-B-hermes-headless.md)及 [runner 说明](deploy/hermes-headless-runner/README.md)。

WX-C1 把明确的微信知识库指令交给平台共用检索与带引用问答服务，默认关闭；多库需先选库，阅读指令与其他自由聊分别仍走 WX-A／WX-B。代码、迁移及待验收边界见 [WX-C1 工作日志](docs/logs/2026-10-27-WX-C1-knowledge.md)。

「赛道同业竞争看板」公开资料检索已随 PR #100 合并并部署：每个任务固定执行 4 次公开网页检索，至多抓取 3 个来源页，再整理为带来源链接与可得日期的 HTML 看板；没有可靠证据时保留“未披露／未检索到”提示。2026-10-26 首次员工试用发现模型 JSON 请求被拒，修复与验收边界见[故障记录](docs/logs/2026-10-26-P2-06-sector-peer-model-reject.md)；同日第二个任务又因模型回答里一条结论引用 5 个来源被结构上限拒绝而整份失败，改为宽松读取、保留来源边界的修复见[故障记录](docs/logs/2026-10-26-P2-06-sector-peer-output-invalid.md)。两次修复都尚未部署，不能视为真实业务验收通过。

「前沿播客」已随 [PR #93](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/93) 合并：员工提交中文或英文话题，平台用双语检索词读取公开播客文字库，优先展示标题直接提及话题的节目；宁德时代/CATL、机器人/具身智能等常见中英别名会扩展检索。英文源节目使用该库中文版，缺少中文版的集数跳过。网页摘要为单文件静态 HTML（按 beautiful-article / reacticle 的 press 主题排版），并提供 Markdown 产物；要点与摘要标明是该库的整理稿且平台未逐条核验。检索排序增强已随 [PR #104](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/104) 合并（`281ac12`），尚未部署或做真实员工验收。员工摘要调整与全部可用匹配节目的展示另见[本轮实施记录](docs/logs/2026-10-26-P2-frontier-podcast-ux.md)；检索探测、验证与限制见[检索排序改进记录](docs/logs/2026-10-26-P2-frontier-podcast-search-quality.md)和[双语改进记录](docs/logs/2026-10-25-P2-frontier-podcast-bilingual.md)。

「地区上市公司基金参与」已加入可运行专家目录：支持地区、报告期与代码输入，按公告候选与可选备案公示数据生成参与明细、统计摘要、缺口、HTML 预览和 Markdown 底稿。公告按发行人读取披露列表后在平台侧按标题和日期筛选；缺省地区发行人表只是有限浙江样本，备案查询地址未配置时会保留相关字段未知并在报告列出缺口。公告来源修复待 PR 评审、发布和员工真实样例复核，见[实施日志](docs/logs/2026-10-26-P2-07-listed-fund-participation.md)、[来源修复记录](docs/logs/2026-10-26-P2-07-listed-fund-announcement-source.md)及[分页与关键词跟进](docs/logs/2026-10-26-P2-07-eastmoney-pagination-keywords.md)。

全景图 HTML 预览、Markdown 下载及移除员工采集台账下载的改动已随 [PR #97](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/97) 合并（`aa1323a`）；未记录生产发布，真实 MCP 全景样例和员工产物体验仍待验收。

公开网页与公众号的正文配图可作为图表证据读入共享知识库：平台先冻结图片快照，再读图并独立复核，只有通过复核的事实进入知识页并可被引用，材料页与知识页显示实际处理范围。能力开关默认关闭，打开前需确认模型能看图。PDF 走同一条证据链：平台把材料的前 8 页画成图片再读图，文字层与页面识图的覆盖分开展示，长文档只算部分读取。实现与未验证边界见[实施记录](docs/logs/2026-10-27-P5-kb-figures-html.md)、[PDF 阶段记录](docs/logs/2026-10-27-P5-kb-figures-pdf.md)与[运行手册](docs/KNOWLEDGE-OPS.md#14-图表证据公开网页配图与-pdf-有界整页渲染)。
成功任务详情页的结果阅读区前置、任务信息后移，以及「我的任务与产物」列表按 HTML／Markdown 实际格式标注下载的 UI 维护见[工作日志](docs/logs/2026-10-27-P2-task-detail-flat-b.md)；本分支待评审，手机 iframe 双滚动仍需真机复核。
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
