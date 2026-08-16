import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import { createTaskAssignmentDeliveryPort } from "@/features/tasks/notifications/assigned";
import type { AppPorts } from "@/ports";

export const taskAssignmentDeliveryProvider = createProvider<
	Pick<AppPorts, "bestEffortWork" | "logger" | "notifications">
>()({
	name: "task-assignment-delivery",
	setup({ ports }) {
		return {
			ports: {
				taskAssignmentDelivery: createTaskAssignmentDeliveryPort({
					bestEffortWork: ports.bestEffortWork,
					logger: ports.logger,
					notifications: ports.notifications,
				}),
			},
		};
	},
});
