import { expect, test } from "bun:test";

test("task scheduling uses a scrollable bottom drawer on mobile", async () => {
	const source = await Bun.file(
		new URL("../../../components/due-date-picker.tsx", import.meta.url),
	).text();

	expect(source).toContain("const isMobile = useIsMobile();");
	expect(source).toContain(
		"<Drawer showSwipeHandle open={open} onOpenChange={changeOpen}>",
	);
	expect(source).toContain(
		'<DrawerContent className="h-[90dvh] max-h-[90dvh]">',
	);
	expect(source).toContain(
		'className="min-h-0 flex-1 overflow-y-auto overscroll-contain"',
	);
	expect(source).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
	expect(source).toContain("<Popover open={open} onOpenChange={changeOpen}>");
});
