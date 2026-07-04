import type { ErrorReporterPort } from "@beignet/core/error-reporting";
import type { IdempotencyPort } from "@beignet/core/idempotency";
import type { MailerPort } from "@beignet/core/mail";
import type {
	BoundGate,
	GatePort,
	LoggerPort,
	StoragePort,
	UnitOfWorkPort,
} from "@beignet/core/ports";
import type { ResendMailEscapeHatch } from "@beignet/provider-mail-resend";
import type { CanvasRepository } from "@/features/canvases/ports";
import type { canvasPolicy } from "@/features/canvases/policy";
import type {
	PageLinkRepository,
	PageRepository,
} from "@/features/pages/ports";
import type { pagePolicy } from "@/features/pages/policy";
import type { AuthorizationContext } from "@/features/shared/authorization";
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
	pageLinks: PageLinkRepository;
	pages: PageRepository;
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
	mailer: MailerPort;
	pageLinks: PageLinkRepository;
	pages: PageRepository;
	resend: ResendMailEscapeHatch;
	tasks: TaskRepository;
	uow: UnitOfWorkPort<AppTransactionPorts>;
	storage: StoragePort;
};
