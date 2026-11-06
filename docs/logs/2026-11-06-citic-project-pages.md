# 2026-11-06 项目页、导入脚本与内网会话

- Agent：Cursor
- 对应任务：员工可见的已投 GP 与中信股权联盟清单调整，移除市场头部机构入口，并准备 GP 与知识库迁移脚本。P3-01～P3-04 的真实业务验收仍未完成。
- 完成状态：代码与脚本完成，待 PR 评审。未部署，未向中信主机写入数据。

## 本次改动

- 已投 GP 与中信股权联盟清单去掉“全部已核实”和“与我关注匹配”，默认显示全部已核实项目。母基金、子基金、赛道、省份筛选仍留在已投 GP。
- 中信股权联盟把母基金筛选改成投资机构，选项是“中信金石”和“中信建投资本”；去掉子基金下拉和卡片上的子基金。机构名仍写在 `mother_fund_name`。
- 移除市场头部机构导航、路由、页面和管理员勾选。接口不再接受 `group=market-leaders`。数据库约束仍允许旧值，本次不新增迁移。
- 没有可核对 https 来源的导入行会留在员工清单里，并标成“演示/导入占位”。审核时间固定在 2010-01-01，避免历史导入被当成新的当日投资推送。
- 新增 `npm run gp:import`、`npm run gp:import-alliance`、`npm run kb:export`、`npm run kb:import`。烯牛抄录和材料包放在 `uploads/`，不提交压缩包。
- 员工会话的 Secure 只在站点地址以 https:// 开头时设置。`http://10.236.133.2` 这类内网地址不再因为生产环境丢掉登录状态。

## 最小验证

- `npm run gp:import-alliance -- --dry-run`：55 个文件，1071 个去重项目（中信建投资本 509，中信金石 562），缺日期 0，省份未能识别 1。
- `npm run gp:import -- --file modules/membership/tests/fixtures/gp-investments.sample.json --dry-run`：1 个主体、1 条投资、1 条占位来源。
- `npm run kb:import -- --materials uploads/ai4s-materials.zip --name="AI for Science" --dry-run`：41 份 markdown，未写数据库。
- 清单状态、烯牛解析、GP 导入形状、会话 Cookie、注册文案、知识库导出形状、项目导航：22 项通过。本机 Node 24.20 不能直接剥 `node_modules` 里的 TypeScript，测试通过指向源码目录的加载器运行。
- `node scripts/check-doc-links.ts`：615 个本地链接通过。
- `npm run typecheck` 在本机停在既有的工作区包解析（`@aihot/industry/taxonomy`、`@citic/membership/module`），没有进入本次新增文件。单独对照源码目录检查本次改动文件时，这些文件本身没有类型错误。
- 数据库集成测试（员工清单权限、管理员分类）本机没有可用的测试库，未运行。

## 风险与交接

- 未分类的联盟导入使用机构简称作为 GP 名称。若库里已有同名主体，重复导入会合并到该主体，并加上 `citic-alliance`。已暂停的同名主体不会被重新启用。
- 联盟项目同时会出现在未按分类过滤的已投 GP 清单里。本次没有新增排除规则。
- 烯牛行业是粗分类，对不上平台赛道时记为“其他”。地区对不上省份时显示未知。这些不是新华财经核验过的省份。
- 知识库材料包只导入 markdown 原文，不排队编译，也不会生成知识页。页面只随完整导出目录一起迁移。
- 未部署，未用真实员工账号验收登录和清单。P3-01～P3-04 保持未勾选。
