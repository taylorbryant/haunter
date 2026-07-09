import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.notNull()
		.default(false),
	image: text("image"),
	accessStatus: text("access_status").notNull().default("waitlisted"),
	// Better Auth admin plugin: app-wide role ("admin" grants the admin API;
	// null/"user" is a regular member) and the ban controls it manages.
	role: text("role"),
	banned: integer("banned", { mode: "boolean" }).default(false),
	banReason: text("ban_reason"),
	banExpires: integer("ban_expires", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
	id: text("id").primaryKey(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	// Better Auth organization plugin: the workspace the session is scoped to.
	activeOrganizationId: text("active_organization_id"),
	// Better Auth admin plugin: set on sessions created while impersonating.
	impersonatedBy: text("impersonated_by"),
});

export const account = sqliteTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: integer("access_token_expires_at", {
		mode: "timestamp",
	}),
	refreshTokenExpiresAt: integer("refresh_token_expires_at", {
		mode: "timestamp",
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// Better Auth organization plugin tables. A "workspace" in the product is an
// organization here; members carry the role that drives page/task/canvas
// authorization.
export const organization = sqliteTable("organization", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	logo: text("logo"),
	metadata: text("metadata"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const member = sqliteTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").notNull().default("member"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		orgUserIdx: uniqueIndex("member_org_user_idx").on(
			table.organizationId,
			table.userId,
		),
	}),
);

export const invitation = sqliteTable("invitation", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	role: text("role"),
	status: text("status").notNull().default("pending"),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	inviterId: text("inviter_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

// @better-auth/agent-auth plugin: an agent runtime (e.g. an MCP client or
// automation host) that agents register under.
export const agentHost = sqliteTable("agent_host", {
	id: text("id").primaryKey(),
	name: text("name"),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	defaultCapabilities: text("default_capabilities"),
	publicKey: text("public_key"),
	kid: text("kid"),
	jwksUrl: text("jwks_url"),
	enrollmentTokenHash: text("enrollment_token_hash"),
	enrollmentTokenExpiresAt: integer("enrollment_token_expires_at", {
		mode: "timestamp",
	}),
	status: text("status").notNull(),
	activatedAt: integer("activated_at", { mode: "timestamp" }),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
	lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// An AI agent identity. Delegated agents act for userId with capability
// grants scoped well below that user's own rights.
export const agent = sqliteTable("agent", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	hostId: text("host_id")
		.notNull()
		.references(() => agentHost.id, { onDelete: "cascade" }),
	status: text("status").notNull(),
	mode: text("mode").notNull(),
	publicKey: text("public_key").notNull(),
	kid: text("kid"),
	jwksUrl: text("jwks_url"),
	lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
	activatedAt: integer("activated_at", { mode: "timestamp" }),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
	metadata: text("metadata"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const agentCapabilityGrant = sqliteTable("agent_capability_grant", {
	id: text("id").primaryKey(),
	agentId: text("agent_id")
		.notNull()
		.references(() => agent.id, { onDelete: "cascade" }),
	capability: text("capability").notNull(),
	deniedBy: text("denied_by").references(() => user.id, {
		onDelete: "cascade",
	}),
	grantedBy: text("granted_by").references(() => user.id, {
		onDelete: "cascade",
	}),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	status: text("status").notNull(),
	reason: text("reason"),
	constraints: text("constraints"),
});

export const approvalRequest = sqliteTable("approval_request", {
	id: text("id").primaryKey(),
	method: text("method").notNull(),
	agentId: text("agent_id").references(() => agent.id, {
		onDelete: "cascade",
	}),
	hostId: text("host_id").references(() => agentHost.id, {
		onDelete: "cascade",
	}),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	capabilities: text("capabilities"),
	status: text("status").notNull(),
	userCodeHash: text("user_code_hash"),
	loginHint: text("login_hint"),
	bindingMessage: text("binding_message"),
	clientNotificationToken: text("client_notification_token"),
	clientNotificationEndpoint: text("client_notification_endpoint"),
	deliveryMode: text("delivery_mode"),
	interval: integer("interval").notNull(),
	lastPolledAt: integer("last_polled_at", { mode: "timestamp" }),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const pages = sqliteTable(
	"pages",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		parentPageId: text("parent_page_id").references(
			(): AnySQLiteColumn => pages.id,
			{ onDelete: "cascade" },
		),
		title: text("title").notNull(),
		icon: text("icon"),
		position: real("position").notNull(),
		content: text("content").notNull().default("[]"),
		searchText: text("search_text").notNull().default(""),
		deletedAt: text("deleted_at"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		workspaceIdx: index("pages_workspace_idx").on(table.workspaceId),
		workspaceDeletedPositionIdx: index(
			"pages_workspace_deleted_position_idx",
		).on(table.workspaceId, table.deletedAt, table.position),
		workspaceDeletedUpdatedIdx: index("pages_workspace_deleted_updated_idx").on(
			table.workspaceId,
			table.deletedAt,
			table.updatedAt,
		),
		parentIdx: index("pages_parent_idx").on(table.parentPageId),
	}),
);

export const tasks = sqliteTable(
	"tasks",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// The member a task is assigned to (null = unassigned). Drives "My Tasks"
		// once a workspace has more than one person.
		assigneeId: text("assignee_id").references(() => user.id, {
			onDelete: "set null",
		}),
		pageId: text("page_id").references(() => pages.id, {
			onDelete: "cascade",
		}),
		sourceBlockId: text("source_block_id"),
		title: text("title").notNull(),
		completed: integer("completed", { mode: "boolean" })
			.notNull()
			.default(false),
		dueDate: text("due_date"),
		completedAt: text("completed_at"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		pageBlockIdx: uniqueIndex("tasks_page_block_idx")
			.on(table.pageId, table.sourceBlockId)
			.where(sql`source_block_id IS NOT NULL`),
		workspaceIdx: index("tasks_workspace_idx").on(
			table.workspaceId,
			table.completed,
		),
		workspaceListIdx: index("tasks_workspace_list_idx").on(
			table.workspaceId,
			table.completed,
			table.dueDate,
			table.createdAt,
		),
		assigneeIdx: index("tasks_assignee_idx").on(
			table.workspaceId,
			table.assigneeId,
			table.completed,
		),
		assigneeListIdx: index("tasks_assignee_list_idx").on(
			table.workspaceId,
			table.assigneeId,
			table.completed,
			table.dueDate,
			table.createdAt,
		),
		overdueNotificationIdx: index("tasks_overdue_notification_idx").on(
			table.completed,
			table.dueDate,
			table.assigneeId,
		),
		pageIdx: index("tasks_page_idx").on(table.pageId),
		userIdx: index("tasks_user_idx").on(table.userId),
	}),
);

export const notificationPreferences = sqliteTable("notification_preferences", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	overdueTasksEnabled: integer("overdue_tasks_enabled", { mode: "boolean" })
		.notNull()
		.default(true),
	timezone: text("timezone").notNull().default("UTC"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const pushSubscriptions = sqliteTable(
	"push_subscriptions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		endpoint: text("endpoint").notNull(),
		expirationTime: integer("expiration_time"),
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(
			table.endpoint,
		),
		userIdx: index("push_subscriptions_user_idx").on(table.userId),
	}),
);

export const notifications = sqliteTable(
	"notifications",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		entityId: text("entity_id").notNull(),
		entityVersion: text("entity_version").notNull(),
		payload: text("payload").notNull(),
		readAt: text("read_at"),
		createdAt: text("created_at").notNull(),
		pushState: text("push_state").notNull().default("pending"),
		pushAttempts: integer("push_attempts").notNull().default(0),
		pushNextAttemptAt: text("push_next_attempt_at"),
		pushLeaseUntil: text("push_lease_until"),
		pushDeliveredAt: text("push_delivered_at"),
	},
	(table) => ({
		dedupeIdx: uniqueIndex("notifications_dedupe_idx").on(
			table.userId,
			table.kind,
			table.entityId,
			table.entityVersion,
		),
		userCreatedIdx: index("notifications_user_created_idx").on(
			table.userId,
			table.createdAt,
			table.id,
		),
		userUnreadIdx: index("notifications_user_unread_idx").on(
			table.userId,
			table.readAt,
			table.createdAt,
		),
		pushPendingIdx: index("notifications_push_pending_idx").on(
			table.pushState,
			table.pushNextAttemptAt,
			table.pushLeaseUntil,
		),
	}),
);

export const canvases = sqliteTable(
	"canvases",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		pageId: text("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		snapshot: text("snapshot").notNull().default("{}"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		pageIdx: index("canvases_page_idx").on(table.pageId),
	}),
);

// Page-to-page references (pageLink blocks and inline mentions), reconciled
// from the document on every content save. Backlinks are read from target.
export const pageLinks = sqliteTable(
	"page_links",
	{
		sourcePageId: text("source_page_id")
			.notNull()
			.references((): AnySQLiteColumn => pages.id, { onDelete: "cascade" }),
		targetPageId: text("target_page_id")
			.notNull()
			.references((): AnySQLiteColumn => pages.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: text("created_at").notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.sourcePageId, table.targetPageId] }),
		targetIdx: index("page_links_target_idx").on(table.targetPageId),
	}),
);

// Public read-only share links. One active link per page; the row's token is
// the capability — deleting the row revokes the link.
export const pageShares = sqliteTable(
	"page_shares",
	{
		id: text("id").primaryKey(),
		pageId: text("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		token: text("token").notNull().unique(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: text("created_at").notNull(),
	},
	(table) => ({
		pageIdx: uniqueIndex("page_shares_page_idx").on(table.pageId),
	}),
);

// Point-in-time snapshots of page documents. Written as checkpoints from the
// content-save path (at most one per interval) and always before a restore,
// so going back never loses the state you left.
export const pageVersions = sqliteTable(
	"page_versions",
	{
		id: text("id").primaryKey(),
		pageId: text("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		icon: text("icon"),
		content: text("content").notNull(),
		// What produced the snapshot: a periodic "checkpoint" or a "restore".
		cause: text("cause").notNull().default("checkpoint"),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: text("created_at").notNull(),
	},
	(table) => ({
		pageCreatedIdx: index("page_versions_page_created_idx").on(
			table.pageId,
			table.createdAt,
		),
	}),
);
