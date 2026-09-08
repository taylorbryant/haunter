import { rq } from "@/client";
import { importRecovery } from "../contracts";

export const importRecoveryMutationOptions = () =>
	rq(importRecovery).mutationOptions();
