import { expect, test } from "bun:test";

test("task scheduling uses a presets-first bottom drawer on mobile", async () => {
	const source = await Bun.file(
		new URL("../../../components/due-date-picker.tsx", import.meta.url),
	).text();
	const mobileFields = source.slice(
		source.indexOf("const mobilePickerFields"),
		source.indexOf("const pickerActions"),
	);

	expect(source).toContain("const isMobile = useIsMobile();");
	expect(source).toContain(
		"<Drawer showSwipeHandle open={open} onOpenChange={changeOpen}>",
	);
	expect(source.match(/<Drawer showSwipeHandle/g)).toHaveLength(1);
	expect(source).toContain(
		'<DrawerContent className="h-[90dvh] max-h-[90dvh]">',
	);
	expect(source).toContain(
		'className="min-h-0 flex-1 overflow-y-auto overscroll-contain"',
	);
	expect(source).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
	expect(source).toContain("<Popover open={open} onOpenChange={changeOpen}>");
	expect(mobileFields.indexOf("MOBILE_DATE_PRESETS.map")).toBeGreaterThan(-1);
	expect(mobileFields.indexOf("MOBILE_DATE_PRESETS.map")).toBeLessThan(
		mobileFields.indexOf("<Calendar"),
	);
	expect(mobileFields).toContain("No date");
	expect(mobileFields).toContain('name="mobileDueTime"');
	expect(mobileFields).toContain('aria-label="Task reminder"');
});
