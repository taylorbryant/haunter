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
	inviterId: text("inviter_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
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
		deletedAt: text("deleted_at"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		workspaceIdx: index("pages_workspace_idx").on(table.workspaceId),
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
		userIdx: index("tasks_user_idx").on(table.userId),
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
