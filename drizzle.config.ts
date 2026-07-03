export default {
	schema: "./infra/db/schema/index.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.SQLITE_DB_URL ?? "file:local.db",
		authToken: process.env.SQLITE_DB_AUTH_TOKEN,
	},
};
