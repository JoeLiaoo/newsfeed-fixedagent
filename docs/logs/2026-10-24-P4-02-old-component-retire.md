# P4-02 旧组件退役（火山云实例，2026-10-24）

- Agent：pi coding agent
- 对应任务：`docs/IMPLEMENTATION.md` 中的 P4-02
- 完成状态：完成（退役范围已执行并留存本文档；P4-03、P4-04 状态不变）

## 本次改动

- 修改文件：本日志；`docs/IMPLEMENTATION.md` 的 P4-02 行；`docs/README.md` 索引；`docs/PROGRESS-REPORT.md` 计数与说明；`docs/DEPLOY-VOLCENGINE.md` 一行状态。未改动任何应用代码、镜像或运行配置。
- 实际完成：按用户授权（"旧服务能删就删，不需要备份"）在火山云实例 `115.190.114.65` 上完成旧应用与旧 Workbench 组件的退役清理，范围覆盖 Docker Compose 项目、systemd 单元、旧发布树、旧环境文件、旧运维脚本、主机 PostgreSQL 旧库与旧归档目录；新平台、Hermes 网关、系统 Nginx 与共享 IP 证书续期链路保持不变且已复验。
- 关键决定及理由：
  - 旧应用退役后 `/opt/ai-work` 只保留 `certbot/` 虚拟环境。`ai-work-cert-renew.service` 的 `ExecStart` 指向该虚拟环境，而它正是 `115.190.114.65` 现场 IP 证书的续期入口，属于共享 HTTPS 资源，故保留路径不变，只删除同目录下的旧发布树。
  - `dsh-native-web.service`（DeepSeek Harness 原生会话，旧应用 MVP 的外部任务执行依赖）随旧应用一并退役：新平台使用独立镜像与 `LLM_BASE_URL`，Hermes 网关使用自身 Python 虚拟环境，两者均不引用该服务或 `127.0.0.1:3090`。
  - 主机 PostgreSQL 16 只承载旧库 `ai_workbench`，删除该库与角色后已停用服务，但**保留软件包**，以便确有其他用途时可重新启用。
  - Docker 只删除明确属于旧应用的镜像标签，未执行全局 prune；新平台历史 release 镜像与构建基础镜像保留。
  - 活动 Nginx 站点文件名仍为 `ai-work-mvp`（旧应用遗留命名），其内容已是新平台上游 `127.0.0.1:3000`，故只删除三份旧配置备份，不改动站点本身。

## 退役前盘点（保留／退役判定）

| 对象 | 判定 | 依据 |
|---|---|---|
| Compose 项目 `citic-newsfeed-prod`（web/api/worker/db） | 保留 | 新平台在用 |
| `/opt/citic-newsfeed`（releases、shared、当前版本） | 保留 | 新平台发布目录与共享 `.env`、凭据挂载 |
| `/opt/hermes-agent`、`hermes-agent-gateway.service`、`hermes` 用户 | 保留 | Hermes Weixin/iLink 网关在用 |
| 系统 Nginx、活动站点 `/etc/nginx/sites-available/ai-work-mvp` | 保留 | 新平台公网 HTTPS 入口（上游 `127.0.0.1:3000`） |
| `ai-work-cert-renew.timer`/`.service`、`/opt/ai-work/certbot`、`/etc/letsencrypt` | 保留 | 共享 IP 证书续期链路（2026-10-26 到期） |
| Compose 项目 `weknora-workbench-staging`（11 个容器、5 个具名卷 + 1 个匿名卷、1 个网络） | 退役 | 旧应用 WeKnora/Workbench 集成；新平台与 Hermes 均无引用 |
| 旧应用镜像（`weknora-*`、`wechatopenai/weknora-*`、`paradedb/*`、`postgres:16-alpine`、`redis:7.0-alpine`、`nginx:1.27/1.30-alpine`、旧 `node:22*` 基础镜像） | 退役 | 仅旧项目使用 |
| `/opt/ai-work`（除 `certbot/`）、`/opt/ai-work-weknora`、`/opt/ai-work-weknora-runtime`、`/opt/node-v22.23.2` | 退役 | 旧应用发布树、集成树与运行时 |
| `/opt/archive/ai-work-old-archive-20261022`（约 5.0 GiB） | 退役 | 用户明确不再需要旧栈备份 |
| `/var/lib/ai-work`（旧应用数据、备份、DSH home） | 退役 | 旧应用运行数据 |
| `ai-work-mvp` / `ai-work-worker` / `ai-work-visual-preview` / `ai-work-weknora` / `dsh-native-web` 服务 | 退役 | 仅服务旧应用（`dsh-native-web` 为旧 MVP 的外部执行依赖） |
| `ai-work-backup` / `ai-work-restore-verify` 服务与定时器 | 退役 | 旧应用专用的备份与恢复校验；主机 PG 已无旧库可备 |
| `/etc/ai-work-mvp.env`（含 `.bak`/`.save`）、`/etc/ai-work-visual-preview.env`、`/etc/ai-wor-mvp.env`、`/etc/ai-work/` | 退役 | 旧应用专用环境文件与 WeKnora 托管认证文件 |
| `/usr/local/libexec/ai-work-backup.sh`、`ai-work-restore-verify.sh` | 退役 | 旧应用运维脚本 |
| 三份 Nginx 旧站点配置备份（`ai-work-mvp.codex-backup-*`） | 退役 | 旧配置备份副本，非活动配置 |
| 主机 PostgreSQL 库 `ai_workbench` 与角色 `aiwork_app` | 退役 | 46 张表全部属旧应用；新平台用 Compose 内网 PostgreSQL 17 库 `aihot` |
| 主机 `postgresql.service` | 停用（软件包保留） | 退役后无任何库与单元依赖 |
| 系统账号 `aiwork` | 退役 | 仅旧应用单元使用 |

## 执行命令摘要（不含任何凭据）

远程操作用台式机受控 SSH 密钥连接，未读取或输出密钥、`.env` 与凭据内容。命令按"先停、再禁用、最后删文件"顺序执行：

```bash
# 1) 旧 Compose 项目：停止并移除容器、卷、网络
cd /opt/ai-work-weknora/upstream/weknora
docker compose -p weknora-workbench-staging \
  -f docker-compose.yml -f /opt/ai-work-weknora/deploy/compose.workbench-overlay.yml \
  down --volumes --remove-orphans
# 早期 compose 版本以 replace 标签重建的容器不被项目识别，逐个停止并移除后再次 down 完成网络清理
# 2) 删除仅属旧项目的镜像标签（未执行全局 prune）
docker image rm <旧项目镜像标签...>
# 3) 旧 systemd 单元：停止 -> 禁用 -> 删除单元文件 -> daemon-reload
systemctl stop <旧单元...> && systemctl disable <旧单元...>
rm /etc/systemd/system/ai-work-mvp.service /etc/systemd/system/ai-work-worker.service \
   /etc/systemd/system/ai-work-visual-preview.service /etc/systemd/system/ai-work-weknora.service \
   /etc/systemd/system/dsh-native-web.service /etc/systemd/system/ai-work-backup.{service,timer} \
   /etc/systemd/system/ai-work-restore-verify.{service,timer}
systemctl daemon-reload
# 4) 旧文件与归档（保留 /opt/ai-work/certbot）
rm -rf /opt/ai-work-weknora /opt/ai-work-weknora-runtime /opt/archive/ai-work-old-archive-20261022 \
       /var/lib/ai-work /opt/node-v22.23.2
find /opt/ai-work -mindepth 1 -maxdepth 1 ! -name certbot -exec rm -rf {} +
rm /etc/ai-work-mvp.env* /etc/ai-work-visual-preview.env /etc/ai-wor-mvp.env /etc/ai-work -r
rm /usr/local/libexec/ai-work-backup.sh /usr/local/libexec/ai-work-restore-verify.sh
rm /etc/nginx/sites-available/ai-work-mvp.codex-backup-*
# 5) 主机 PostgreSQL 旧库与角色，然后停用服务（软件包保留）
psql -c "DROP DATABASE IF EXISTS ai_workbench;" && psql -c "DROP ROLE IF EXISTS aiwork_app;"
systemctl disable --now postgresql
userdel -r aiwork
```

## 最小验证

执行的检查及结果：

- 公网健康检查（清理后）：

  ```json
  {"ok":true,"db":"ok","ms":1,"release":"4a911997af24e149c2a1880981d504b7f1305a2c"}
  ```

  `https://115.190.114.65/api/health` 返回 `ok=true`、`db=ok`，release 为当前生产版本 `4a91199…`；根路径返回 HTTP 302（登录跳转）。
- `docker ps -a` 仅剩 `citic-newsfeed-prod` 的 web、api、worker、db 与已退出码 0 的 setup 容器；`db` 容器 `healthy`。`docker volume ls` 仅剩 `citic-newsfeed-prod_data`、`citic-newsfeed-prod_db`；`docker network ls` 仅剩 `citic-newsfeed-prod_default` 与系统默认网络。`docker compose ls` 只显示 `citic-newsfeed-prod`（running(4)）。
- `hermes-agent-gateway.service` 为 `active`；`nginx.service` 为 `active`，`nginx -t` 通过。
- 证书续期链路可用：`ai-work-cert-renew.timer` 仍为 `enabled` 且下次触发时间正常；用保留的虚拟环境执行 `certbot renew --dry-run --no-random-sleep-on-renew` 返回 "Congratulations, all simulated renewals succeeded"，`certbot certificates` 显示 SAN 匹配 `115.190.114.65`、有效期至 2026-10-26。
- 旧端口（`3090`/`8787`/`8797`/`18080`/`18081`/`18088`/`18787`/`8791`）已无监听；无旧应用残留进程；无 `ai-work`/`workbench`/`weknora` 残留 systemd 单元（仅保留 `ai-work-cert-renew.*`）。
- 磁盘：清理前约 45 GiB 已用 / 31 GiB 可用，清理后约 20 GiB 已用 / 56 GiB 可用，释放约 25 GiB。

未执行或需用户试用的检查：

- 未做旧应用功能回归：旧应用及其数据、备份与归档已按授权删除，无法再回归，仅以新平台健康检查与共享服务状态作为间接证据。
- 未执行 Docker 构建缓存清理与新平台历史 release 镜像清理，二者不属于旧应用范围。
- 未卸载主机 PostgreSQL 软件包，也未变更新平台、Hermes 网关配置或 Nginx 站点内容。

## 风险与交接

已知限制／缺失依赖：

- 旧应用数据、WeKnora/Workbench 知识库内容与 2026-10-22 归档副本已不可恢复。依据是用户明确表示旧服务能删就删、不需要备份；如后续需要旧 WeKnora 内容只能重建。
- IP 证书 2026-10-26 到期，续期依赖保留在旧目录名下的 `/opt/ai-work/certbot` 虚拟环境与 `ai-work-cert-renew.timer`。若将来清理 `/opt/ai-work`，必须同步改写该单元的 `ExecStart` 并重新验证续期。
- 主机 PostgreSQL 16 已停用（软件包仍在）。若有脚本依赖主机 PG 需先 `systemctl enable --now postgresql`。
- 主机名仍为 `ai-work`，Nginx 活动站点文件名仍为 `ai-work-mvp`；两者只是遗留命名，不影响功能，重命名留待后续独立变更。
- Docker 构建缓存仍约 6.7 GiB 未清理；如需释放空间应按构建缓存单独处理，避免全局 prune 影响新平台构建。

下一步：

- P4-03（监控、费用、备份恢复验证、操作说明与回退路径）与 P4-04（员工试用与试运行结论）状态不变，仍待完成；本次清理不构成这两项的验收证据。
- 若实例需要再次发布，新平台发布流程与凭据路径不变（`/opt/citic-newsfeed/shared/.env` 与 root-only 凭据目录只读挂载），本次清理未触及该路径。
