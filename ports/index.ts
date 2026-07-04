import type { ErrorReporterPort } from "@beignet/core/error-reporting";
import type { IdempotencyPort } from "@beignet/core/idempotency";
import type { MailerPort } from "@beignet/core/mail";
import type {
	BoundGate,
	GatePort,
	LoggerPort,
	RateLimitPort,
	StoragePort,
	UnitOfWorkPort,
} from "@beignet/core/ports";
import type { ResendMailEscapeHatch } from "@beignet/provider-mail-resend";
import type { CanvasRepository } from "@/features/canvases/ports";
import type { canvasPolicy } from "@/features/canvases/policy";
import type { MemberRepository } from "@/features/members/ports";
import type {
	PageLinkRepository,
	PageRepository,
	PageVersionRepository,
} from "@/features/pages/ports";
import type { pagePolicy } from "@/features/pages/policy";
import type { AuthorizationContext } from "@/features/shared/authorization";
import type { ShareRepository } from "@/features/shares/ports";
import type { TaskRepository } from "@/features/tasks/ports";
import type { taskPolicy } from "@/features/tasks/policy";
import type { AuthPort } from "./auth";

export type AppPolicies = [
	typeof pagePolicy,
	typeof taskPolicy,
	typeof canvasPolicy,
];

export type AppTransactionPorts = {
	canvases: CanvasRepository;
	idempotency: IdempotencyPort;
	members: MemberRepository;
	pageLinks: PageLinkRepository;
	pages: PageRepository;
	pageVersions: PageVersionRepository;
	shares: ShareRepository;
	tasks: TaskRepository;
};

export type AppGate = BoundGate<AppPolicies>;

export type AppPorts = {
	auth: AuthPort;
	canvases: CanvasRepository;
	errorReporter: ErrorReporterPort;
	gate: GatePort<AuthorizationContext, AppPolicies>;
	idempotency: IdempotencyPort;
	logger: LoggerPort;
	members: MemberRepository;
	mailer: MailerPort;
	pageLinks: PageLinkRepository;
	pages: PageRepository;
	pageVersions: PageVersionRepository;
	rateLimit: RateLimitPort;
	resend: ResendMailEscapeHatch;
	shares: ShareRepository;
	tasks: TaskRepository;
	uow: UnitOfWorkPort<AppTransactionPorts>;
	storage: StoragePort;
};
