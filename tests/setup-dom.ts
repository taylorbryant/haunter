import { GlobalRegistrator } from "@happy-dom/global-registrator";

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

export function uninstallTestDom() {
	if (installedResizeObserver) {
		Reflect.deleteProperty(globalThis, "ResizeObserver");
		installedResizeObserver = false;
	}
	if (installedIntersectionObserver) {
		Reflect.deleteProperty(globalThis, "IntersectionObserver");
		installedIntersectionObserver = false;
	}
	GlobalRegistrator.unregister();
}
