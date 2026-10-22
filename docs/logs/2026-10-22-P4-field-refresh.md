# P4 现场复核与公网入口切换

日期：2026-10-22（Asia/Shanghai）  
目标：火山云实例 `ai-work`（`115.190.114.65`）  
操作范围：只读复核新旧服务状态；按用户明确确认，将该 IP 的 HTTPS 入口切换至新平台。

## 切换前状态

- 新平台 Compose 项目 `citic-newsfeed-prod` 已运行；web、API、worker、PostgreSQL 状态正常，`/api/health` 返回 `ok=true`、`db=ok`，版本 `4a243981aa731e9860c203beead926872d18327c`。
- Nginx 活动站点 `/etc/nginx/sites-available/ai-work-mvp` 的 HTTPS 上游原为 `127.0.0.1:8787`，该端口由 `weknora-workbench-staging` 项目提供。旧入口 `/` 当时返回 502。
- 服务器 `.env` 中 `SITE_URL` 原为 `http://localhost:3000`；`TRUST_PROXY=true`。
- `weknora-workbench-staging`、主机 PostgreSQL 16、相关 Docker 卷以及 inactive 的旧 systemd 服务均保留。它们的业务归属仍未逐项确认，本次未停止、删除或清理。

## 执行与结果

用户确认：“将该 IP 入口切换到新平台”。随后按以下顺序操作：

1. 先备份共享环境文件及 Nginx 站点配置，备份位置分别为 `/opt/citic-newsfeed/shared/.env.codex-backup-20261022` 和 `/etc/nginx/sites-available/ai-work-mvp.codex-backup-20261022`。
2. 将 `SITE_URL` 更新为 `https://115.190.114.65`，保留 `TRUST_PROXY=true`。
3. 将活动站点 HTTPS 代理从 `127.0.0.1:8787` 改为新平台 `127.0.0.1:3000`。保留 Nginx TLS 配置及转发头。
4. 使用当前 Compose 项目配置更新 web 服务；Compose 同步重建了 setup、API 和 web 容器，数据库及 worker 未重建。setup 以成功状态退出。
5. `nginx -t` 通过后重载 Nginx。
6. 本机健康端点返回 `ok=true`、`db=ok`；从开发机校验证书的公网请求中，`https://115.190.114.65/api/health`、`/health`、`/login` 均返回 HTTP 200，`http://115.190.114.65/health` 跳转到 HTTPS `/api/health` 并返回 200。
7. 排查发现原配置另有一个仅用于 HTTP 的 `/health` 旧路由。已额外备份修改前配置到 `/etc/nginx/sites-available/ai-work-mvp.codex-backup-before-health-20261022` 和 `/etc/nginx/sites-available/ai-work-mvp.codex-backup-health-fix-20261022`，将 HTTP `/health` 改为 HTTPS 健康地址跳转，并使 HTTPS `/health` 内部转到新平台 `/api/health`。活动站点配置已无 `127.0.0.1:8787` 上游；再次 `nginx -t` 通过并重载。

公网检查时 TLS 证书校验通过。未输出、复制或记录任何凭据值。当前线上仍为 release `4a243981aa731e9860c203bead926872d18327c`；本地工作树中尚未提交的新华财经 schema 修正还未包含在此生产镜像中。此记录不代表旧应用资源归属或实例外备份恢复演练已核实。

## 回退

如新平台入口出现故障，可将 Nginx 配置恢复为备份 `/etc/nginx/sites-available/ai-work-mvp.codex-backup-20261022`，将 `.env` 恢复为 `/opt/citic-newsfeed/shared/.env.codex-backup-20261022`，然后依次执行 `nginx -t`、重载 Nginx，并重新启动原配置对应的旧入口服务。回退前先核验旧服务当前状态及负责人意见；不删除新平台容器或数据库卷。

## 尚待验收

- 证书现场记录有效期至 2026-10-26 UTC；需在到期前确认自动续期结果，或迁移到受控域名证书。
- 安全组、备案/合规与入口所有者仍需负责人核对；当前 IP 入口切换是用户明确授权的操作。
- 同事逐人备份范围、实例外恢复抽测和旧应用资源归属未核实，旧应用、Workbench、主机数据库及卷不做清理。
- 两名已注册员工尚待管理员审核，并分别完成登录、数据隔离及资讯流程试用。
