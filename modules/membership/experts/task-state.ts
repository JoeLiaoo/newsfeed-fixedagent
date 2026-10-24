/** How a task's state reads on the employee's pages: one wording and one badge for every state. */
export const TASK_STATE_TEXT: Record<string, string> = {
  queued: "排队中",
  waiting_input: "等待选择主体",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const TASK_STATE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  queued: "warning",
  waiting_input: "warning",
  running: "default",
  succeeded: "success",
  failed: "destructive",
  cancelled: "secondary",
};

/** The step a task reached, in the reader's words; a step the platform has not named keeps its own name. */
export const TASK_STAGE_TEXT: Record<string, string> = {
  queued: "等待开始",
  processing: "处理中",
  entity_search: "查找主体",
  choose_entity: "等待选择主体",
  complete: "已完成",
  failed: "未完成",
  recovered: "重新排队",
  cancelled: "已取消",
};

/** The states a task has not left yet: only those rows still say which step they reached. */
export const TASK_STATES_RUNNING = ["queued", "waiting_input", "running"];

