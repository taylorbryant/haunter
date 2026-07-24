import { describe, expect, it } from "bun:test";
import { agentCapabilities } from "@/lib/agent-capability-registry";
import {
	AGENT_PERMISSION_PROFILE_IDS,
	AGENT_PERMISSION_PROFILES,
	ALL_HAUNTER_AGENT_CAPABILITIES,
	agentHostPermissionStateForCapabilities,
	agentPermissionProfilesAtOrAbove,
	minimumAgentPermissionProfileForCapabilities,
} from "../permission-profiles";

describe("agent permission profiles", () => {
	it("maps every registered capability into the full profile", () => {
		expect([...ALL_HAUNTER_AGENT_CAPABILITIES].sort()).toEqual(
			agentCapabilities.map((capability) => capability.name).sort(),
		);
	});

	it("keeps each profile as a strict superset of the previous profile", () => {
		for (let index = 1; index < AGENT_PERMISSION_PROFILE_IDS.length; index++) {
			const previous =
				AGENT_PERMISSION_PROFILES[
					AGENT_PERMISSION_PROFILE_IDS[index - 1] ?? "view"
				].capabilities;
			const current =
				AGENT_PERMISSION_PROFILES[AGENT_PERMISSION_PROFILE_IDS[index] ?? "full"]
					.capabilities;
			const currentCapabilities = new Set<string>(current);

			expect(current.length).toBeGreaterThan(previous.length);
			expect(
				previous.every((capability) => currentCapabilities.has(capability)),
			).toBe(true);
		}
	});

	it("derives the lowest profile that covers a request", () => {
		expect(minimumAgentPermissionProfileForCapabilities([])).toBeNull();
		expect(
			minimumAgentPermissionProfileForCapabilities([
				"list_workspaces",
				"read_page",
			]),
		).toBe("view");
		expect(
			minimumAgentPermissionProfileForCapabilities([
				"read_page",
				"update_page",
			]),
		).toBe("edit");
		expect(minimumAgentPermissionProfileForCapabilities(["delete_task"])).toBe(
			"full",
		);
		expect(
			minimumAgentPermissionProfileForCapabilities(["unknown_capability"]),
		).toBeNull();
	});

	it("recognizes exact remembered profiles without inflating partial access", () => {
		expect(agentHostPermissionStateForCapabilities([])).toBe("ask");
		expect(
			agentHostPermissionStateForCapabilities(
				AGENT_PERMISSION_PROFILES.view.capabilities,
			),
		).toBe("view");
		expect(agentHostPermissionStateForCapabilities(["list_workspaces"])).toBe(
			"custom",
		);
	});

	it("offers only the requested minimum and broader profiles", () => {
		expect(agentPermissionProfilesAtOrAbove("view")).toEqual([
			"view",
			"edit",
			"full",
		]);
		expect(agentPermissionProfilesAtOrAbove("edit")).toEqual(["edit", "full"]);
		expect(agentPermissionProfilesAtOrAbove("full")).toEqual(["full"]);
	});
});
