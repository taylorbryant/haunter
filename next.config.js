/** @type {import("next").NextConfig} */
const nextConfig = {
	// BlockNote's server codec uses JSDOM and React DOM internally. Keep its
	// Node-oriented runtime intact instead of folding it into Turbopack's route
	// chunks, which can evaluate React's server shim in the wrong context. Yjs
	// must be externalized with it so both sides share one constructor instance.
	serverExternalPackages: ["@blocknote/server-util", "yjs"],
	outputFileTracingIncludes: {
		"/changelog": ["./content/changelog/*.md"],
	},
};

export default nextConfig;
