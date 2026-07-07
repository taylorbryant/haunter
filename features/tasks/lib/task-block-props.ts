export const AUTO_TASK_ASSIGNEE = "__haunter_auto_assignee__";

export function isAutoTaskAssignee(value: unknown): boolean {
	return value === AUTO_TASK_ASSIGNEE;
}
