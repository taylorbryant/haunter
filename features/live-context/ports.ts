import type { TenantScope } from "@beignet/core/ports";
import type { PublishContextInput, StoredContext } from "./schemas";

export type LiveContextPort = {
	isConfigured(): boolean;
	publish(
		scope: TenantScope,
		userId: string,
		input: PublishContextInput,
	): Promise<boolean>;
	list(scope: TenantScope, userId: string): Promise<StoredContext[]>;
};
