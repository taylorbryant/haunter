import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";

let installedResizeObserver = false;
let installedIntersectionObserver = false;

export function installTestDom() {
	GlobalRegistrator.register({ url: "http://localhost:3000" });

	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: (query: string) => {
			const maxWidth = query.match(/max-width:\s*(\d+)px/);
			const minWidth = query.match(/min-width:\s*(\d+)px/);
			const matches =
				(maxWidth ? window.innerWidth <= Number(maxWidth[1]) : true) &&
				(minWidth ? window.innerWidth >= Number(minWidth[1]) : true);
			return {
				matches,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			};
		},
	});

	if (!("ResizeObserver" in globalThis)) {
		installedResizeObserver = true;
		class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
		Object.defineProperty(globalThis, "ResizeObserver", {
			configurable: true,
			value: ResizeObserver,
		});
	}

	if (!("IntersectionObserver" in globalThis)) {
		installedIntersectionObserver = true;
		class IntersectionObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
		Object.defineProperty(globalThis, "IntersectionObserver", {
			configurable: true,
			value: IntersectionObserver,
		});
	}

	if (!("scrollIntoView" in HTMLElement.prototype)) {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: () => {},
		});
	}
}

/** Unmount components first, then await teardown before starting another test. */
export async function uninstallTestDom() {
	// React can leave passive callbacks queued after a synchronous unmount.
	// Drain them while window still exists, before Happy DOM restores globals.
	await act(async () => {});
	if (installedResizeObserver) {
		Reflect.deleteProperty(globalThis, "ResizeObserver");
		installedResizeObserver = false;
	}
	if (installedIntersectionObserver) {
		Reflect.deleteProperty(globalThis, "IntersectionObserver");
		installedIntersectionObserver = false;
	}
	await GlobalRegistrator.unregister();
}
