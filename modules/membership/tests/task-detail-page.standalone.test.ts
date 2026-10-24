import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { EXPERT_TASK_ERROR_LABELS, EXPERT_TASK_STAGE_LABELS, EXPERT_TASK_STATE_LABELS, EXPERT_TASK_STATE_VARIANTS } from "../experts/catalog.ts";

const moduleSource = readFileSync(new URL("../module.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/task-detail.tsx", import.meta.url), "utf8");
const expertDetail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");

test("the task detail page is registered on its own path", () => {
  assert.match(moduleSource, /\{\s*path:\s*"tasks\/:id",\s*file:\s*"pages\/task-detail\.tsx"\s*\}/, "任务详情页注册在 /tasks/:id");
});

test("the task page reads the one task it shows, and keeps the states of the employee flow", () => {
  assert.match(page, /\/api\/v1\/membership\/expert-tasks\/\$\{encodeURIComponent\(id \?\? ""\)\}/, "页面按任务编号读取单个任务");
  assert.match(page, /response\.status === 401/, "未登录回到登录页");
  assert.match(page, /location\.href = "\/login"/, "未登录回到登录页");
  assert.match(page, /response\.status === 404/, "任务不存在或已清理时显示空状态");
  assert.match(page, /正在加载任务/, "加载状态");
  assert.match(page, /任务加载失败，请重试。/, "读失败时给出可重试的提示");
  assert.match(page, /setInterval/, "任务进行中时定时刷新");
  for (const state of ["queued", "running", "waiting_input"]) assert.ok(page.includes(`"${state}"`), `进行中的状态 ${state} 会被刷新`);
  assert.match(page, /act\("retry"\)/, "失败后可重试");
  assert.match(page, /act\("cancel"\)/, "进行中可取消");
  assert.match(page, /\/entity`/, "等待选择主体时可确认主体");
  assert.match(page, /\/artifact`/, "可下载产物");
  assert.match(page, /\/checkpoint`/, "可下载采集台账");
  assert.match(page, /\/materials\/\$\{material\.id\}/, "可下载材料");
  assert.match(page, /method: "DELETE"/, "任务结束后可删除材料");
  assert.match(page, /IntentLink to=\{`\/experts\//, "任务所属专家可回到专家页");
});

test("the employee sees capability words, never the service or model behind the task", () => {
  const visible = `${page}\n${expertDetail}\n${Object.values(EXPERT_TASK_ERROR_LABELS).join("\n")}\n${Object.values(EXPERT_TASK_STAGE_LABELS).join("\n")}\n${Object.values(EXPERT_TASK_STATE_LABELS).join("\n")}`;
  assert.ok(!/悟道|新华财经|DeepSeek|BettaFish|微舆|wudao/i.test(visible), "员工界面不得出现供应商品牌名");
  assert.equal(EXPERT_TASK_STATE_LABELS.failed, "失败");
  assert.equal(EXPERT_TASK_STATE_LABELS.waiting_input, "等待选择主体");
  assert.equal(EXPERT_TASK_STATE_VARIANTS.succeeded, "success");
  assert.ok(EXPERT_TASK_STAGE_LABELS.choose_entity, "每个步骤都有员工看得懂的说明");
});

test("each task on the expert page opens its own page", () => {
  assert.match(expertDetail, /<IntentLink to=\{`\/tasks\/\$\{task\.id\}`\}>查看详情<\/IntentLink>/, "任务列表里每个任务都能打开详情页");
});
