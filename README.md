# 中信私募ai平台

公司内部使用的个性化资讯平台。员工注册并经管理员审核后，可选择关注赛道；首页按个人关注展示当天的公开资讯摘要和来源。实时新闻、专家入口、信源状态和账号管理可从导航进入。

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

本地代码检查：

```sh
npm ci
npm run typecheck
```

## 当前开发状态（2026-10-22）

| 阶段 | 代码状态 | 业务／上线状态 |
|---|---|---|
| P0 | 材料与方案预核已开展 | 真实凭据、微信试用、服务器边界核验未完成 |
| P1 | 账号、兴趣、资讯与个人日报已实现 | 需真实员工账号和信源覆盖验证 |
| P2 | 专家导入、任务、新华财经适配底稿已实现 | 仅一层直接投资；真实 MCP / DeepSeek 和完整规则仍待验收 |
| P3 | GP 监测与微信管线由 [PR #4](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/4) 引入；[PR #6](https://github.com/JoeLiaoo/newsfeed-fixedagent/pull/6) 合并了全仓审查整改及通知分片、并发投递修复 | **仍未上线**；真实服务商、Hermes sidecar 和双用户跨日投递均未验收，所有 P3 功能开关默认关闭 |
| P4 | 尚未部署试运行 | 清理旧服务前必须取得同事备份及可恢复性确认 |

生产运行与功能激活是两个独立关口。不要因为 P3 代码已合并，就打开 `P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED`，详见 [P3 运维与验收手册](docs/P3-OPERATIONS.md)。

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
- [P2 首个专家适配矩阵](docs/P2-EXPERT-ADAPTER.md)
- [P3 GP 与微信联调](docs/P3-OPERATIONS.md)
- [P0 资料盘点与外部阻碍](docs/P0-STATUS.md)
- [AIHOT 上游版本、许可证和适配记录](docs/UPSTREAM.md)
- [文档与日志索引](docs/README.md)

仓库为 **public**：不得提交 `.env`、`.config/`、私人名单、用户数据、供应商原始响应或其他敏感内容。生产环境上线前仍需完成人员试用和服务器部署核验。
