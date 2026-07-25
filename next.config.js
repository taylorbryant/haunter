/** @type {import("next").NextConfig} */
const nextConfig = {
	outputFileTracingIncludes: {
		"/changelog": ["./content/changelog/*.md"],
	},
};

export default nextConfig;
