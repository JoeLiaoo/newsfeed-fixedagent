# P3 微信扫码绑定与聊天入口

日期：2026-10-22（Asia/Shanghai）

## 本次完成

- 按用户决定取消独立 P0-03 原生渠道试投，将微信用户产品链路并入 P3-04；P0-03 标为转入，不标记已完成。
- 产品计划明确员工从「我的 → 微信通知」扫描已核验的 Hermes 联系二维码进入私聊；绑定网页账号后可以聊天，并按个人赛道收资讯和 GP 推送。
- 通知 API 仅向已登录用户返回管理员配置的 `P3_HERMES_BOT_CONTACT_QR_URL`；只接受无用户名/密码的 HTTPS URL。通知页展示配置的联系人二维码，未配置时显示明确占位提示；绑定挑战提示已改为向该 Hermes 私聊发送。
- 按进一步澄清，绑定资格只给管理员批准的 `active` 平台账号；数据库新建订阅默认为资讯与 GP 均开启、未暂停。微信绑定/推送权限与普通 Hermes 私聊权限分开，普通聊天继续要求 Hermes 管理员批准；页面和验收计划已表达这一区分。
- 核对 `memberSession` 与迁移 `0122`：待审核用户不能访问成员 API；首次创建通知设置时 `news_enabled`、`gp_enabled` 默认 `true`。既有用户的退订选择不会被重绑覆盖。
- 实施计划、P0 状态、P0/P3 运维手册、README、文档索引和进度汇报同步了 P0-03 转移及 P3-04 验收范围。
- 增加 Hermes 网关插件 `deploy/hermes-citic-bridge/`：在 `pre_gateway_dispatch` 钩子消费 24 位一次性绑定码，经 HMAC 向平台 claim；普通聊天仍由 Hermes pairing 控制。插件复用当前 Weixin 适配器发送，并用 SQLite 持久记录出站幂等键。
- 平台 worker 通过 Docker host gateway 访问插件 HTTP 入口；`deploy/configure-p3-bridge.py` 为平台与 Hermes 配置匹配的密钥、备份旧环境文件，并保持三个 P3 开关关闭。
- 火山云发布目录 `/opt/citic-newsfeed/releases/d7f515e-p3wechat-20261022` 已构建并启动 API、worker、web；Hermes 插件已启用，桥接监听在 Docker host gateway。旧版归档、WeKnora 和数据库卷均未清理。

## 关键决定与边界

- 员工二维码须是 Hermes bot 联系二维码，不能复用管理员执行 `hermes gateway setup` 时使用的 iLink 登录二维码。
- 锁定版 Hermes 官方 Weixin 文档进一步确认：员工不能扫网关登录二维码来添加 bot，需在微信里联系已连接 bot/contact；目前没有证据证明当前 iLink 账户能提供员工共享的联系人二维码。
- 二维码建立/打开私聊不等于网页账号身份认证。员工仍需发送十分钟绑定码并在网页确认；Hermes pairing 审批仍按网关策略执行。
- 网站和 Hermes bridge 已部署；真实 bot 联系二维码目前没有，微信端到端绑定、聊天和投递尚未验收。因此 P3-04 保持未勾选，P3 运行开关保持关闭。

## 修改文件

- `docs/PLAN.md`
- `docs/IMPLEMENTATION.md`
- `docs/P0-STATUS.md`
- `docs/P0-03-04-OPERATIONS.md`
- `docs/P3-OPERATIONS.md`
- `docs/PROGRESS-REPORT.md`
- `docs/README.md`
- `README.md`
- `.env.example`
- `modules/membership/notifications/routes.ts`
- `modules/membership/notifications/outbox.ts`
- `modules/membership/pages/notifications.tsx`
- `compose.volcengine.yml`
- `deploy/hermes-citic-bridge/plugin.yaml`
- `deploy/hermes-citic-bridge/__init__.py`
- `deploy/configure-p3-bridge.py`

## 最小检查

- `node scripts/check-doc-links.ts`：通过，检查 188 个本地 Markdown 链接。
- `npx tsc -p modules`：通过。
- `git diff --check`：通过。
- 火山云 `docker compose config --quiet`、镜像构建、迁移 setup 和服务启动：通过；网页通知页未登录返回 302，worker 到 bridge 的未授权请求返回 401，平台 claim 未签名请求返回 403。
- Hermes 插件 Python 编译检查通过；网关服务运行且监听桥接端口。未运行全量测试，未用员工微信执行真实绑定或发送。

## 未验证事项与风险

- 管理员确认目前没有可供员工扫描的机器人联系人二维码；Hermes 官方资料也未确认当前 iLink bot 能提供共享联系人码。网页因此显示缺失提示，扫码绑定尚不可用。
- 入站 hook 已实现并部署，但尚未用未批准聊天的真实员工微信消息证明它能先于 pairing 门消费绑定码；出站也未以真实收件人验证。
- 当前发布来自本地工作分支，尚未并入 `main`；生产运行开关和二维码 URL 未启用。
- pairing 审批、员工私聊、同一 Hermes 会话收发、两个用户数据隔离、独立定向推送和跨日送达均未做真实账号验收。
- HTTPS 图片地址运行时可加载但未检查其二维码内容；必须由管理员核验图片指向已授权的 bot 联系入口。

## 下一步

确认当前 iLink bot 是否有员工可用的联系入口（其登录码不能代替联系人二维码）。若渠道不提供，应先决定是否改用能提供用户扫码入口的正式渠道。取得真实入口后，由两名同意参与的员工完成绑定、不同兴趣推送及普通聊天另行审批、退订/解绑和跨日真实送达验收；达标后才能更新 P3-04 勾选与运行开关。
