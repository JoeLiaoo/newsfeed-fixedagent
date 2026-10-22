# 火山云部署准备清单

本手册面向现有火山云 `ai-work` Ubuntu 实例。已完成只读盘点、隔离预部署，并按用户明确确认将 IP 的 HTTPS 入口切换到新平台。旧版本已按用户决定在同机归档留存，无需为旧版本另做异地备份或恢复演练；P4 仍需完成新平台运维及员工验收。未经影响核对不得停止其他服务或删除数据。

## 当前前置状态

- [x] 已通过用户提供的 SSH 密钥访问实例并完成基础只读盘点；私钥内容未读取或写入文档。
- [x] 用户确认旧版本已过时，留存同机 root-only 归档即可；归档已校验，无需对旧版本进行异地备份或恢复演练。详见[旧应用归档日志](logs/2026-10-22-P4-old-app-archive.md)。
- [~] 基础资源只读盘点已完成；若退役仍运行的旧组件，需确认操作对象及共享服务影响。旧版本归档决定不授权清理其他服务或数据。
- [~] HTTPS 入口：现场有 Let's Encrypt IP 证书（SAN 匹配 `115.190.114.65`，有效期至 2026-10-26 UTC），Nginx 在 80/443 监听。用户确认后已把活动站点上游切换至新平台 `127.0.0.1:3000`；公网 `/api/health` 与 `/login` 返回 200。证书续期与合规核对仍待办。
- [ ] 核对安全组及备案/合规要求；若继续使用 IP 访问，记录无自有域名的限制。
- [~] 常见应用根目录和 root 家目录未发现 `.config/`；旧应用服务使用受限权限的系统环境文件。新平台凭据存放位置及读取用户待核实，不覆盖现有文件。
- [~] DeepSeek 与新华财经 MCP 已完成一次隔离抽测；信源采集、对象存储与 Hermes/iLink 尚未验证。真实凭据不写入日志。

### 已观测到的实例状态（2026-10-22，只读）

- Ubuntu 24.04 LTS；4 vCPU、约 8 GiB RAM、79 GiB 根盘（约 47 GiB 可用）。
- Docker 与 Compose 已安装；Nginx 正在监听 80/443，`nginx -t` 通过。活动 Nginx 配置文件仍沿用 `ai-work-mvp` 名称，但 HTTPS 上游已切到新平台。
- 旧应用由两个 systemd 服务运行，并使用版本目录/活动 symlink 部署；发布目录有约 360 个子目录。严禁对发布目录做通配清理。
- 另有约 11 个运行/已退出容器组成的独立 Compose 项目、多个具名/匿名 Docker 卷，以及主机 PostgreSQL 16 在线。其数据库、卷和容器归属尚未逐项确认，全部视为其他服务并保留。
- Docker 服务映射端口当前只绑定 loopback；Nginx 是现存公网入口。不得假设只有旧应用使用主机资源或证书。
- 初始只读盘点未读取 `.env`、容器环境变量、Nginx 配置正文、数据库记录或用户文件；后续入口切换读取并仅改动了站点上游与 `SITE_URL`，保留了原始备份。新平台自身的备份策略仍待验收。

用户已确认旧系统备份与迁移完成，并于 2026-10-22 明确旧版为上一版本、无需异地备份或恢复演练；旧版同机归档已经校验。公网入口已切换。新平台自身仍须完成备份与恢复运维验收；任何旧组件退役都需确认具体范围及共享服务影响。

### 现场复核（2026-10-22）

- 新平台 Compose 项目 `citic-newsfeed-prod` 的 web、api、worker、PostgreSQL 均运行；setup 容器以退出码 0 结束。`/api/health` 返回 `ok=true`、`db=ok`，release 为 `4a243981aa731e9860c203beead926872d18327c`。根盘约 79 GiB、已用 31 GiB、可用 45 GiB；4 vCPU、内存约 7.8 GiB。
- 另一个 Compose 项目 `weknora-workbench-staging` 有 10 个容器（8 个运行、2 个历史成功退出）；主机 PostgreSQL 16、Nginx 和 Docker 仍运行。Docker 卷共 8 个。`ai-work-mvp.service` 与 `ai-work-worker.service` 为 inactive；Nginx 唯一启用站点配置仍名为 `ai-work-mvp`，切换前 HTTPS 上游为 `127.0.0.1:8787`，该端口由 Workbench API 容器映射。活动服务、卷、数据库与 Workbench 业务归属尚无负责人确认，旧环境仍不能清理。
- 切换前 Nginx 配置检查通过；现场 IP 证书 SAN 匹配该 IP，至 2026-10-26 UTC 到期。用户确认将 IP 入口交给新平台后，已备份 Nginx 配置和新平台 `.env`，将站点 `proxy_pass` 更新为 `127.0.0.1:3000`，设置 `SITE_URL=https://115.190.114.65`，通过 `nginx -t` 后重载。公网 `/api/health` 和 `/login` 分别返回 HTTP 200。备份位置、验证和回退步骤见[现场复核与切换日志](logs/2026-10-22-P4-field-refresh.md)。Workbench 容器、旧应用、主机 PostgreSQL 及 Docker 卷未停止或删除。
- 已在同机创建 `/opt/archive/ai-work-old-archive-20261022`，包含旧应用发布/配置与 runtime 元数据、运维脚本/unit/timer、历史备份、host `ai_workbench` 逻辑转储、WeKnora 两个容器数据库逻辑转储、非 PostgreSQL 持久卷副本及当前/历史 Compose 镜像；11 个归档载荷文件 SHA-256 校验全部通过。目录为 `0700`、文件为 `0600`。用户确认旧版本留档即可，无需该版本异地备份或恢复演练；旧容器和源文件未停止或删除。旧服务 unit 仍 enabled/inactive，相关备份/恢复和证书续期 timer 保持启用。见[归档日志](logs/2026-10-22-P4-old-app-archive.md)。

## 部署拓扑基线

- 使用仓库 `docker-compose.yml`：`web`、`api`、`worker`、PostgreSQL；Hermes sidecar 依照 P3 运维合同单独核验。
- 保留系统 Nginx 作为公网 HTTPS 入口；新应用初期仅监听 `127.0.0.1:3000`，不启用 Compose 的 Caddy profile，避免和系统 Nginx争用 80/443。
- 数据库只在 Compose 内网提供服务；不要给 PostgreSQL 或 API 增加公网端口映射。
- 保留 Docker 命名卷、旧镜像和旧配置，直到新版本验证完成且回退窗口关闭。
- `.env` 与凭据只放服务器受限路径；确保 Docker build context 和镜像中不包含 `.env`、`.config/` 或个人数据。
- `P3_GP_SYNC_ENABLED`、`P3_NOTIFICATIONS_ENABLED`、`P3_DELIVERY_ENABLED` 初始及试运行期间保持 `false`。

### 隔离预部署现况（2026-10-22）

- 已在 `/opt/citic-newsfeed` 使用独立 Compose 项目 `citic-newsfeed-prod` 启动主分支提交 `4a243981aa731e9860c203beead926872d18327c`。新建独立 PostgreSQL 17 容器及 `db`、`data` 命名卷；旧应用、主机 PostgreSQL 16、其他 Compose 项目和 Nginx 均未停止或修改。
- `web` 仅映射 `127.0.0.1:3000`；数据库和 API 没有主机端口映射，Caddy profile 未启用。健康端点返回 `ok=true`、`db=ok` 与上述 release；管理员入口返回 HTTP 302。迁移/种子容器退出码为 0。
- 采集、模型调用、GP 同步、通知生成和投递均显式为 `false`。DeepSeek 与新华财经凭据放在 root-only 的共享父目录下，以只读卷挂载到后端；容器用户 UID/GID 1000 可读该挂载目录（目录 `0750`、文件 `0640`），主机 `.env` 为 `0600`。API 与 worker 内均通过 `test -r` 验证可读，未输出凭据内容。构建镜像内未发现 `.env` 或 `.config/`。
- 当前 `SITE_URL=https://115.190.114.65`，新应用只映射在 `127.0.0.1:3000`，Nginx 公网入口已切换至该端口。原 Nginx 与 `.env` 配置已有独立备份，可按现场复核日志回退。其他 Workbench/旧应用资源归属未确认，保持原样。
- 首次成员管理员已通过一次性 bootstrap 初始化：用户名 `admin`，展示名“系统管理员”；成员账号登录密码与 `.env` 中的独立后台口令不同。用户已反馈管理员成功登录，确认该账号的基础登录链路可用；其他权限、注册审核及多用户流程仍待验收。成员密码只返回给用户一次，数据库仅保存哈希。
- 部署后复核时，旧应用的 `ai-work-mvp.service` 与 `ai-work-worker.service` 均为 `inactive/dead`，systemd 记录退出时间为 2026-10-22 09:55 CST；Nginx 仍为 active。此次部署没有停止这两个服务，退出原因与执行方未知。**入口切换前**的旧 HTTPS 首页只读探测返回 HTTP 502；切换或恢复旧服务前先向实例所有者确认当前线上状态。
- 目标机无法直连 Docker Hub 与 Debian HTTPS 镜像；此次使用国内镜像完成 Docker 镜像、APT 和 npm 下载。本仓库现在包含 `Dockerfile.volcengine` 与 `compose.volcengine.yml`，补齐后续发布的版本化构建配置。
- 此次完成隔离部署、DeepSeek 与新华财经单次连通性抽测及用户授权的 HTTPS 入口切换；公网健康与登录页检查通过。注册审核、双用户隔离、新平台备份恢复、供应商成本/持续性、安全组与证书续期仍未完整验收。旧组件退役前仍需明确操作范围和共享服务影响；旧版本不要求恢复验证。

## 阶段 A：只读盘点

先记录时间、执行人、主机标识、命令和脱敏结果。只执行读取命令，不运行 `down`、`prune`、删除目录、清空卷或重启服务等操作。

初始基础核查已执行；后续只读补充盘点时可参考：

```sh
hostnamectl
lsb_release -a
nproc
free -h
df -h
sudo docker version
sudo docker compose version
sudo docker ps -a
sudo docker volume ls
sudo docker network ls
sudo ss -lntup
sudo nginx -T
sudo systemctl --no-pager --type=service --state=running
```

`nginx -T` 可能包含域名、路径或认证信息，证据应在本地受控保存并脱敏后再写入仓库。对每个容器、卷、站点、数据库、目录标记所有者及是否属于 `ai-work-mvp`；无法确定归属的资源视为其他服务并保留。

## 阶段 B：备份与隔离预部署

1. 旧版 `ai-work-mvp` 已按用户决定完成同机归档；无需为旧版本另做异地备份或恢复演练。新平台数据库、文件和配置按现行运维策略备份，并验证新平台恢复与回滚方案。
2. 确定新平台独立目录，例如 `/opt/citic-newsfeed`；不覆盖旧应用目录。源码使用确认过的固定提交或发布标签。
3. 为生产生成独立随机值：数据库密码、管理员临时密码、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`；凭据放入权限为 `0600`、仅部署用户可读的 `.env` 或受控 secret store。
4. 配置 `SITE_URL`、`SITE_DOMAIN`、`PORT=127.0.0.1:3000`、`TRUST_PROXY=true`、持久化数据目录及必要供应商凭据。先核对仓库 `.env.example`，不把示例占位符直接用于生产。
5. 检查安全组仅开放 SSH 管理来源、80/443；数据库、API、管理端口保持内网/回环可达。确认 DNS 指向目标公网 IP，HTTPS 证书签发路径可用。
6. 先内部启动并迁移，验证 `/api/health`、管理员登录、注册审核、两用户数据隔离、采集/模型关闭时的安全状态、任务队列、持久化卷、日志脱敏和重启恢复。

## 阶段 C：入口切换与回退

入口切换已在用户明确确认后执行：保存了切换前 Nginx 与 `.env` 配置，先验证新平台服务，再运行 `nginx -t` 并重载 Nginx；公网 HTTPS 健康与登录页均返回 200。证书续期和上线后观察仍待安排。旧服务和数据没有清理。

回退新平台发布时将 Nginx 入口恢复到上一新平台版本对应配置并重启/重载 Nginx；保留新容器和卷用于排查，不删除数据库。涉及新平台数据库迁移时，先核对相邻新版本 schema 兼容性，并使用新平台自己的备份回滚；旧版归档不是新平台数据库的恢复源。

## 等待用户或实例所有者提供

- 只读 SSH 连接目标/方式及允许的检查范围。
- 新平台备份保管目标及恢复/回滚验证责任人。
- 目标域名、DNS 管理方式、实例地域/规格及安全组变更审批。
- `.config/` 在服务器上的路径与读取用户；哪些供应商服务允许生产调用。
- 试运行员工名单、值班人、备份存储目标和发布窗口。

旧版本归档已完成 P4-01。新平台运维、员工试用等项目仍按 `docs/IMPLEMENTATION.md` 跟进；退役旧服务前核对目标对象及共享服务影响。旧版本异地备份和恢复演练不再作为 P4 前置条件。
