import { createNoopErrorReporter } from "@beignet/core/error-reporting";
import { createGate, definePorts } from "@beignet/core/ports";
import { canvasPolicy } from "@/features/canvases/policy";
import { pagePolicy } from "@/features/pages/policy";
import { appError } from "@/features/shared/errors";
import { taskPolicy } from "@/features/tasks/policy";
import { workspacePolicy } from "@/features/workspaces/policy";
import type { AppPorts } from "@/ports";

const gate = createGate({
	policies: [workspacePolicy, pagePolicy, taskPolicy, canvasPolicy],
	onDeny(decision) {
		return appError("Forbidden", {
			message: decision.reason ?? "Forbidden",
			details: decision.details,
		});
	},
});

/**
 * App ports the server boots with.
 *
 * Bound ports are app-owned. Every deferred key is contributed by a provider
 * in server/providers.ts during startup; createNextServer(...) fails boot if
 * any of them is still unbound after providers have started.
 */
export const appPorts = definePorts<AppPorts>()({
	bound: {
		errorReporter: createNoopErrorReporter(),
		gate,
	},
	deferred: [
		"auth",
		"canvases",
		"idempotency",
		"logger",
		"pageLinks",
		"pages",
		"tasks",
		"uow",
		"workspaces",
		"storage",
	],
});
