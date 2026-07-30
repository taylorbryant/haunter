import { expect, test } from "bun:test";
import { buttonVariants } from "@/components/ui/button";

test("ghost buttons use the solid themed interaction surface", () => {
	const className = buttonVariants({ variant: "ghost" });

	expect(className).toContain("hover:bg-accent");
	expect(className).toContain("hover:text-accent-foreground");
	expect(className).toContain("aria-expanded:bg-accent");
	expect(className).not.toContain("dark:hover:bg-muted/50");
});
