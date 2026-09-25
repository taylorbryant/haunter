import { defineContractGroup } from "@beignet/core/contracts";
import { errors } from "@/features/shared/errors";
import {
	PublishContextInputSchema,
	PublishContextOutputSchema,
} from "./schemas";

export const publishLiveContext = defineContractGroup()
	.namespace("liveContext")
	.meta({
		auth: "required",
		rateLimit: { max: 240, windowSec: 60, scope: "user" },
	})
	.post("/api/live-context")
	.body(PublishContextInputSchema)
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		LiveContextUnavailable: errors.LiveContextUnavailable,
		ActiveSessionNotFound: errors.ActiveSessionNotFound,
	})
	.responses({ 200: PublishContextOutputSchema });
