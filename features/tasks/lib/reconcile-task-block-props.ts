import type { BlockJson } from "@/features/pages/schemas";

type TaskProps = {
	checked: boolean;
	due: string;
	assignee: string;
};

export type ReconcileTaskBlockPropsResult = {
	blocks: BlockJson[];
	changed: boolean;
};

function taskProps(block: BlockJson): TaskProps {
	const due = block.props.due;
	const assignee = block.props.assignee;
	return {
		checked: block.props.checked === true,
		due: typeof due === "string" ? due : "",
		assignee: typeof assignee === "string" ? assignee : "",
	};
}

function sameTaskProps(
	left: Record<string, unknown>,
	right: TaskProps,
): boolean {
	const checked = left.checked === true;
	const due = left.due;
	const assignee = left.assignee;
	return (
		checked === right.checked &&
		(typeof due === "string" ? due : "") === right.due &&
		(typeof assignee === "string" ? assignee : "") === right.assignee
	);
}

/**
 * Copy task-owned props from an authoritative document into a current editor
 * document by block id. Text, children, and non-task props stay local.
 */
export function reconcileTaskBlockProps(
	current: BlockJson[],
	authoritative: BlockJson[],
): ReconcileTaskBlockPropsResult {
	const authoritativeTasks = new Map<string, TaskProps>();
	function collect(nodes: BlockJson[]) {
		for (const block of nodes) {
			if (block.type === "task" && !authoritativeTasks.has(block.id)) {
				authoritativeTasks.set(block.id, taskProps(block));
			}
			if (block.children.length > 0) collect(block.children);
		}
	}

	function apply(nodes: BlockJson[]): ReconcileTaskBlockPropsResult {
		let changed = false;
		const blocks = nodes.map((block) => {
			let next = block;
			const authoritativeProps =
				block.type === "task" ? authoritativeTasks.get(block.id) : undefined;

			if (
				authoritativeProps &&
				!sameTaskProps(block.props, authoritativeProps)
			) {
				changed = true;
				next = {
					...next,
					props: {
						...next.props,
						checked: authoritativeProps.checked,
						due: authoritativeProps.due,
						assignee: authoritativeProps.assignee,
					},
				};
			}

			if (block.children.length > 0) {
				const result = apply(block.children);
				if (result.changed) {
					changed = true;
					next = { ...next, children: result.blocks };
				}
			}

			return next;
		});

		return { blocks: changed ? blocks : nodes, changed };
	}

	collect(authoritative);
	return apply(current);
}
