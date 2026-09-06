import { expect, test } from "bun:test";
import { useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { installTestDom, uninstallTestDom } from "./setup-dom";

test("DOM teardown drains queued React callbacks before removing window", async () => {
	installTestDom();
	let effects = 0;
	let cleanups = 0;
	function Probe() {
		useEffect(() => {
			effects++;
			return () => {
				cleanups++;
			};
		}, []);
		return <span>Mounted</span>;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	// A synchronous commit can leave a scheduled passive-effects callback even
	// after unmount flushes the effect. It still reads window when it runs.
	flushSync(() => root.render(<Probe />));
	flushSync(() => root.unmount());
	await uninstallTestDom();
	expect(effects).toBe(1);
	expect(cleanups).toBe(1);
	expect(typeof window).toBe("undefined");
	// Let the host scheduler run so callbacks leaked by teardown fail this test.
	await new Promise<void>((resolve) => setImmediate(resolve));
});
