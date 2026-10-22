# P4 旧应用火山云归档

日期：2026-10-22（Asia/Shanghai）  
目标主机：`115.190.114.65`  
归档目录：`/opt/archive/ai-work-old-archive-20261022`

## 范围与动作

归档范围按资源引用与部署关系确定：`ai-work-mvp` 的 `/opt/ai-work` 发布树、`/opt/ai-work-weknora` 配置/集成树、`/opt/ai-work-weknora-runtime` staging 环境与部署元数据、`/etc/ai-work-mvp.env`、两个 systemd unit、切换前 Nginx 站点配置备份、host PostgreSQL 的 `ai_workbench` 数据库，以及与旧应用 WeKnora 集成关联的 `weknora-workbench-staging` Compose 配置、数据库、非 PostgreSQL 数据卷和容器镜像。

归档目录包括：

- `files-and-config.tar.gz`：旧应用完整发布/配置目录和服务配置，含受限环境文件。
- `operational-files.tar.gz`：专用 Node 运行时、visual-preview 配置、备份/恢复/预览脚本，所有 `ai-work-*` systemd unit/timer 与启用链接，以及 `/var/backups/ai-work-mvp`。
- `weknora-runtime-metadata.tar.gz`：独立 runtime staging 环境目录与部署元数据。
- `host-ai_workbench.dump`：主机 PostgreSQL `ai_workbench` 的 custom-format `pg_dump`。
- `weknora-paradedb-all.sql.gz` 与 `workbench-postgres-all.sql.gz`：Compose 内两个 PostgreSQL 服务的 `pg_dumpall` 逻辑转储。
- `weknora-file-volumes.tar.gz`：WeKnora 文件、docreader、workbench 和 Redis 非 PostgreSQL 卷。
- `weknora-project-images.tar`：该 Compose 项目实际使用的 9 个 Docker 镜像标签；`weknora-retired-images.tar` 另外保存已留存的 WeKnora UI/staging 镜像标签。
- `container-map.txt`：Compose 容器名称、镜像和当时状态；不含容器环境变量。
- `ARCHIVE-README.txt`、`SHA256SUMS`：范围说明和校验和。

## 验证和影响

- 归档目录权限 `0700`，归档文件权限 `0600`，属主均为 `root`。
- 归档目录实占约 5.0 GiB；最终复核时服务器仍有约 40 GB 可用磁盘。
- 文件/配置、runtime、运维文件、非数据库卷和 Docker 镜像 tar 的结构检查通过；数据库压缩转储 `gzip -t` 通过，主机数据库 dump 的目录可由 `pg_restore --list` 读取；`SHA256SUMS` 覆盖全部 11 个归档载荷文件。
- 旧 systemd 服务在归档前已经 inactive；归档过程未启停容器、未停止数据库、未删除或移动源文件。`weknora-workbench-staging` 和新平台保持运行。
- `ai-work-mvp.service` 与 `ai-work-worker.service` 当前仍为 enabled 但 inactive，主机重启时可能自动启动；备份、恢复验证和证书续期 timer 当前 active/enabled。归档未改变这些状态。证书续期任务所管理的 IP 证书也供新平台入口使用，因此本次保留运行。

## 限制

- 这是旧版本留档，不作为新平台的灾备方案。用户于 2026-10-22 确认旧版本已过时，不要求对旧版本另做异地备份或恢复演练；新平台自身的备份与恢复验收仍适用。
- PostgreSQL 采用在线逻辑转储，未保存原始 PG 数据目录；非 PostgreSQL 文件及 Redis 卷在服务运行期间复制，属于在线文件系统副本。该归档用于留存旧版本，不承诺将旧应用恢复为可运行服务。
- 本次只创建归档副本，没有停止旧 Compose 项目或清理其容器、卷、镜像、旧发布版本。后续若退役组件，应明确具体对象及对共享服务的影响；本次决定不构成删除授权。
