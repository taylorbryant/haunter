type AuthAllowedHostsInput = {
	appUrl: string;
	betterAuthUrl: string;
	additionalHosts?: readonly string[];
	vercelUrl?: string;
	vercelBranchUrl?: string;
	vercelProjectProductionUrl?: string;
};

/**
 * Builds Better Auth's request-host allowlist from deployer-owned canonical
 * URLs, optional self-hosting patterns, and exact Vercel deployment aliases.
 */
export function buildAuthAllowedHosts({
	appUrl,
	betterAuthUrl,
	additionalHosts = [],
	vercelUrl,
	vercelBranchUrl,
	vercelProjectProductionUrl,
}: AuthAllowedHostsInput): string[] {
	const hosts = [
		new URL(appUrl).host,
		new URL(betterAuthUrl).host,
		vercelUrl,
		vercelBranchUrl,
		vercelProjectProductionUrl,
		...additionalHosts,
	];

	return [
		...new Set(
			hosts
				.map((host) => host?.trim())
				.filter((host): host is string => Boolean(host)),
		),
	];
}
