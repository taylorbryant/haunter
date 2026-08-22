import type { ErrorReporterPort } from "@beignet/core/error-reporting";
import type { IdempotencyPort } from "@beignet/core/idempotency";
import type { MailerPort } from "@beignet/core/mail";
import type {
	BestEffortWorkPort,
	BoundGate,
	GatePort,
	LoggerPort,
	RateLimitPort,
	StoragePort,
	UnitOfWorkPort,
} from "@beignet/core/ports";
import type { ResendMailEscapeHatch } from "@beignet/provider-mail-resend";
import type { AdminUserRepository } from "@/features/admin/ports";
import type {
	AgentAdminRepository,
	McpConnectionRepository,
	McpOAuthClientRepository,
	McpOAuthRequestVerifier,
	McpServerConfigurationPort,
} from "@/features/agents/ports";
import type { canvasPolicy } from "@/features/canvases/policy";
import type {
	CanvasNavigationRepository,
	CanvasRepository,
} from "@/features/canvases/ports";
import type { ChangelogStateRepository } from "@/features/changelog/ports";
import type {
	WorkspaceEventPublisherPort,
	WorkspaceEventStreamLeasePort,
	WorkspaceEventSubscriberPort,
} from "@/features/collab/workspace-events";
import type { MemberRepository } from "@/features/members/ports";
import type {
	NotificationRepository,
	WebPushPort,
} from "@/features/notifications/ports";
import type { pagePolicy } from "@/features/pages/policy";
import type {
	PageLinkRepository,
	PageNavigationRepository,
	PageRepository,
	PageVersionRepository,
} from "@/features/pages/ports";
import type { AuthorizationContext } from "@/features/shared/authorization";
import type { ShareRepository } from "@/features/shares/ports";
import type { taskPolicy } from "@/features/tasks/policy";
import type {
	EmbeddedTaskProjectionPort,
	TaskAssignmentDeliveryPort,
	TaskRepository,
	TaskSourceDocumentPort,
} from "@/features/tasks/ports";
import type { AuthPort } from "./auth";

export type AppPolicies = [
	typeof pagePolicy,
	typeof taskPolicy,
	typeof canvasPolicy,
];

export type AppTransactionPorts = {
	adminUsers: AdminUserRepository;
	agents: AgentAdminRepository;
	mcpConnections: McpConnectionRepository;
	mcpOAuthClients: McpOAuthClientRepository;
	canvasNavigation: CanvasNavigationRepository;
	canvases: CanvasRepository;
	changelogState: ChangelogStateRepository;
	idempotency: IdempotencyPort;
	members: MemberRepository;
	notificationInbox: NotificationRepository;
	pageLinks: PageLinkRepository;
	pageNavigation: PageNavigationRepository;
	pages: PageRepository;
	pageVersions: PageVersionRepository;
	pageTaskProjection: EmbeddedTaskProjectionPort;
	shares: ShareRepository;
	tasks: TaskRepository;
	taskSourceDocuments: TaskSourceDocumentPort;
};

export type AppGate = BoundGate<AppPolicies>;

export type AppPorts = {
	adminUsers: AdminUserRepository;
	agents: AgentAdminRepository;
	mcpConnections: McpConnectionRepository;
	mcpOAuthClients: McpOAuthClientRepository;
	mcpOAuthRequests: McpOAuthRequestVerifier;
	mcpServerConfiguration: McpServerConfigurationPort;
	auth: AuthPort;
	bestEffortWork: BestEffortWorkPort;
	canvasNavigation: CanvasNavigationRepository;
	canvases: CanvasRepository;
	changelogState: ChangelogStateRepository;
	errorReporter: ErrorReporterPort;
	gate: GatePort<AuthorizationContext, AppPolicies>;
	idempotency: IdempotencyPort;
	logger: LoggerPort;
	members: MemberRepository;
	notificationInbox: NotificationRepository;
	notifications: import("@beignet/core/notifications").NotificationPort;
	mailer: MailerPort;
	pageLinks: PageLinkRepository;
	pageNavigation: PageNavigationRepository;
	pages: PageRepository;
	pageVersions: PageVersionRepository;
	pageTaskProjection: EmbeddedTaskProjectionPort;
	rateLimit: RateLimitPort;
	resend: ResendMailEscapeHatch;
	shares: ShareRepository;
	tasks: TaskRepository;
	taskAssignmentDelivery: TaskAssignmentDeliveryPort;
	taskSourceDocuments: TaskSourceDocumentPort;
	uow: UnitOfWorkPort<AppTransactionPorts>;
	storage: StoragePort;
	webPush: WebPushPort;
	workspaceEvents: WorkspaceEventPublisherPort;
	workspaceEventStreamLeases: WorkspaceEventStreamLeasePort;
	workspaceEventSubscriptions: WorkspaceEventSubscriberPort;
};
