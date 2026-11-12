import type { TaskMetadata } from "../result-block.js";

/** An immutable copy of just the task fields of a step result, safe to embed in published events. */
export function taskOf(result: TaskMetadata): TaskMetadata {
  return Object.freeze({ task_id: result.task_id, task_plan_file: result.task_plan_file });
}
