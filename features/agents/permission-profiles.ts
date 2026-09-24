export const AGENT_PERMISSION_PROFILE_IDS = ["view", "edit", "full"] as const;

export type AgentPermissionProfile =
	(typeof AGENT_PERMISSION_PROFILE_IDS)[number];

export type AgentHostPermissionState =
	| "ask"
	| AgentPermissionProfile
	| "custom";

const VIEW_CAPABILITIES = [
	"read_canvas",
	"preview_canvas",
	"list_workspaces",
	"list_workspace_members",
	"list_pages",
	"search_pages",
	"read_page",
	"list_tasks",
] as const;

const EDIT_CAPABILITIES = [
	...VIEW_CAPABILITIES,
	"create_canvas_block",
	"edit_canvas",
	"create_page",
	"append_to_page",
	"edit_page_blocks",
	"update_page",
	"create_task",
	"update_task",
	"complete_task",
	"reopen_task",
] as const;

export const ALL_HAUNTER_AGENT_CAPABILITIES = [
	...EDIT_CAPABILITIES,
	"delete_canvas_shapes",
	"archive_page",
	"restore_page",
	"delete_task",
	"replace_page_content",
] as const;

export type HaunterAgentCapability =
	(typeof ALL_HAUNTER_AGENT_CAPABILITIES)[number];

type AgentPermissionProfileDefinition = {
	label: string;
	description: string;
	details: readonly string[];
	capabilities: readonly HaunterAgentCapability[];
};

export const AGENT_PERMISSION_PROFILES = {
	view: {
		label: "View only",
		description: "Find and read your pages, canvases, and tasks.",
		details: [
			"View and search pages",
			"Read canvas shapes and history",
			"Preview canvas drawings",
			"View tasks",
			"View workspaces and members",
		],
		capabilities: VIEW_CAPABILITIES,
	},
	edit: {
		label: "View and edit",
		description: "Create and update pages, canvases, and tasks.",
		details: [
			"Everything in View only",
			"Create and edit pages",
			"Add canvas blocks and edit shapes",
			"Create, update, complete, and reopen tasks",
		],
		capabilities: EDIT_CAPABILITIES,
	},
	full: {
		label: "Full access",
		description:
			"Manage pages, canvases, and tasks, including destructive actions.",
		details: [
			"Everything in View and edit",
			"Archive and restore pages",
			"Delete page blocks and replace page bodies",
			"Delete canvas shapes",
			"Delete tasks",
		],
		capabilities: ALL_HAUNTER_AGENT_CAPABILITIES,
	},
} as const satisfies Record<
	AgentPermissionProfile,
	AgentPermissionProfileDefinition
>;

const CAPABILITY_LABELS = {
	create_canvas_block: "Add canvas blocks",
	read_canvas: "Read canvases",
	preview_canvas: "Preview canvases",
	edit_canvas: "Edit canvas shapes",
	delete_canvas_shapes: "Delete canvas shapes",
	list_workspaces: "View workspaces",
	list_workspace_members: "View workspace members",
	list_pages: "View page lists",
	search_pages: "Search pages",
	read_page: "Read pages",
	list_tasks: "View tasks",
	create_page: "Create pages",
	append_to_page: "Add to pages",
	edit_page_blocks: "Edit page blocks",
	replace_page_content: "Replace page bodies and delete blocks",
	update_page: "Edit pages",
	create_task: "Create tasks",
	update_task: "Edit tasks",
	complete_task: "Complete tasks",
	reopen_task: "Reopen tasks",
	archive_page: "Archive pages",
	restore_page: "Restore pages",
	delete_task: "Delete tasks",
} as const satisfies Record<HaunterAgentCapability, string>;

const PROFILE_CAPABILITY_SETS = Object.fromEntries(
	AGENT_PERMISSION_PROFILE_IDS.map((profile) => [
		profile,
		new Set<string>(AGENT_PERMISSION_PROFILES[profile].capabilities),
	]),
) as Record<AgentPermissionProfile, Set<string>>;

export function capabilitiesForAgentPermissionProfile(
	profile: AgentPermissionProfile,
): readonly HaunterAgentCapability[] {
	return AGENT_PERMISSION_PROFILES[profile].capabilities;
}

export function minimumAgentPermissionProfileForCapabilities(
	capabilities: readonly string[],
): AgentPermissionProfile | null {
	if (capabilities.length === 0) return null;
	return (
		AGENT_PERMISSION_PROFILE_IDS.find((profile) =>
			capabilities.every((capability) =>
				PROFILE_CAPABILITY_SETS[profile].has(capability),
			),
		) ?? null
	);
}

export function agentHostPermissionStateForCapabilities(
	capabilities: readonly string[],
): AgentHostPermissionState {
	if (capabilities.length === 0) return "ask";

	const unique = new Set(capabilities);
	const exactProfile = AGENT_PERMISSION_PROFILE_IDS.find((profile) => {
		const expected = PROFILE_CAPABILITY_SETS[profile];
		return (
			expected.size === unique.size &&
			[...unique].every((capability) => expected.has(capability))
		);
	});

	return exactProfile ?? "custom";
}

export function agentPermissionProfilesAtOrAbove(
	minimum: AgentPermissionProfile,
): readonly AgentPermissionProfile[] {
	const minimumIndex = AGENT_PERMISSION_PROFILE_IDS.indexOf(minimum);
	return AGENT_PERMISSION_PROFILE_IDS.slice(minimumIndex);
}

export function agentHostPermissionStateLabel(
	state: AgentHostPermissionState,
): string {
	if (state === "ask") return "Ask every time";
	if (state === "custom") return "Custom access";
	return AGENT_PERMISSION_PROFILES[state].label;
}

export function agentCapabilityLabel(capability: string): string {
	return capability in CAPABILITY_LABELS
		? CAPABILITY_LABELS[capability as HaunterAgentCapability]
		: "Additional access";
}
