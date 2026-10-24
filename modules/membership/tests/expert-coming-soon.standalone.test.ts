import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { COMING_SOON_EXPERT, COMING_SOON_EXPERT_SLUG, COMING_SOON_EXPERT_STATUS, EXPERT_STATUS_BADGES, expertStatusBadge } from "../experts/catalog.ts";

test("the planned expert entry names the capability and says it is still in development", () => {
  assert.equal(COMING_SOON_EXPERT_STATUS, "coming_soon");
  assert.match(COMING_SOON_EXPERT_SLUG, /^[a-z0-9]+(-[a-z0-9]+)*$/, "slug 用稳定的 kebab 写法");
  assert.equal(COMING_SOON_EXPERT.name, "企业舆情报告");
  assert.ok(COMING_SOON_EXPERT.description.includes("开发中"), "描述说明仍在开发中");
  assert.ok(COMING_SOON_EXPERT.skillMd.includes("开发中"), "技能文本说明仍在开发中");
  assert.deepEqual(COMING_SOON_EXPERT.missingDependencies, [], "开发中的条目不写缺少依赖");
  const visible = `${COMING_SOON_EXPERT.name}\n${COMING_SOON_EXPERT.description}\n${COMING_SOON_EXPERT.skillMd}`;
  assert.ok(!/悟道|新华财经|DeepSeek|BettaFish|微舆|wudao/i.test(visible), "开发中条目不得出现供应商品牌名");
});

test("the badge of a planned expert reads 开发中, not 可运行 or 缺少依赖", () => {
  assert.equal(expertStatusBadge("available").label, "可运行");
  assert.equal(expertStatusBadge("coming_soon").label, "开发中");
  assert.equal(expertStatusBadge("blocked").label, "缺少依赖");
  assert.equal(expertStatusBadge("coming_soon").variant, EXPERT_STATUS_BADGES.coming_soon.variant);
});

test("the catalog and the detail page show the planned state and take no task", () => {
  const list = readFileSync(new URL("../pages/experts.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../experts/routes.ts", import.meta.url), "utf8");
  assert.ok(list.includes("COMING_SOON_EXPERT_STATUS"), "目录卡片按状态区分开发中");
  assert.ok(detail.includes("开发中，敬请期待"), "详情页醒目说明开发中");
  assert.ok(detail.includes('expert.status === "available" && <Card>'), "提交任务的表单只对可运行的专家显示");
  assert.ok(routes.includes("status IN ('available', ${COMING_SOON_EXPERT_STATUS})"), "目录对所有角色返回开发中的条目");
  assert.ok(routes.includes("expert_coming_soon"), "新建任务按开发中拒绝");
  assert.ok(!/悟道|新华财经|DeepSeek|BettaFish|微舆|wudao/i.test(`${list}\n${detail}`), "页面不得出现供应商品牌名");
});
