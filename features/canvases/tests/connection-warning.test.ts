import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCanvasConnectionWarning } from "../client/use-connection-warning";
import { installTestDom, uninstallTestDom } from "@/tests/setup-dom";

beforeEach(() => {
	installTestDom();
	jest.useFakeTimers();
});
afterEach(async () => {
	cleanup();
	jest.useRealTimers();
	await uninstallTestDom();
});

const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

test("short reconnects stay quiet and each disconnect gets its own grace period", () => {
	const { result, rerender } = renderHook(
		({ connected }) => useCanvasConnectionWarning(connected),
		{ initialProps: { connected: true } },
	);
	rerender({ connected: false });
	advance(3000);
	expect(result.current).toBe(false);
	rerender({ connected: true });
	advance(3000);
	expect(result.current).toBe(false);
	rerender({ connected: false });
	advance(4999);
	expect(result.current).toBe(false);
	advance(1);
	expect(result.current).toBe(true);
	rerender({ connected: true });
	expect(result.current).toBe(false);
});

test("an initial connection that stays unavailable eventually offers recovery", () => {
	const { result } = renderHook(() => useCanvasConnectionWarning(false));
	expect(result.current).toBe(false);
	advance(5000);
	expect(result.current).toBe(true);
});

test("disposing a canvas cancels its pending warning", () => {
	const before = jest.getTimerCount();
	const { unmount } = renderHook(() => useCanvasConnectionWarning(false));
	expect(jest.getTimerCount()).toBeGreaterThan(before);
	unmount();
	expect(jest.getTimerCount()).toBe(before);
});
