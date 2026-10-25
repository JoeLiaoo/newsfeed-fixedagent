import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { EXPERT_TASK_ERROR_LABELS, EXPERT_TASK_STAGE_LABELS, EXPERT_TASK_STATE_LABELS, EXPERT_TASK_STATE_VARIANTS } from "../experts/catalog.ts";

const moduleSource = readFileSync(new URL("../module.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../pages/task-detail.tsx", import.meta.url), "utf8");
const expertDetail = readFileSync(new URL("../pages/expert-detail.tsx", import.meta.url), "utf8");
const tasksPage = readFileSync(new URL("../pages/tasks.tsx", import.meta.url), "utf8");

test("the task detail page is registered on its own path", () => {
  assert.match(moduleSource, /\{\s*path:\s*"tasks",\s*file:\s*"pages\/tasks\.tsx"\s*\}/, "任务历史页注册在 /tasks");
  assert.match(moduleSource, /\{\s*path:\s*"tasks\/:id",\s*file:\s*"pages\/task-detail\.tsx"\s*\}/, "任务详情页注册在 /tasks/:id");
});

test("the employee task history pages through all of the logged-in employee's expert tasks", () => {
  assert.match(tasksPage, /\/api\/v1\/membership\/expert-tasks\?limit=/, "历史页调用员工任务列表接口");
  assert.match(tasksPage, /pagination: \{ nextOffset: number \| null \}/, "读取服务端分页游标");
  assert.match(tasksPage, /下一页/, "可以访问更早的任务");
  assert.match(tasksPage, /上一页/, "可以返回较新的任务");
  assert.match(tasksPage, /全部任务/, "明确说明这是跨专家历史");
  assert.match(tasksPage, /查看任务/, "每条记录可打开详情");
  assert.match(expertDetail, /IntentLink to="\/tasks"/, "专家页可以发现全局任务历史");
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
  assert.match(page, /companyRelationLabel\(candidate, candidates, task\.result\?\.query\)/, "任务详情的主体选择也显示母公司／分支标签");
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
