import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useDeviceTimeOrLocalFallback } from "./device-time-provider";

function OutsideAppClock() {
	const deviceTime = useDeviceTimeOrLocalFallback();
	return (
		<output data-ready={deviceTime.ready}>
			{deviceTime.ready ? deviceTime.today : "pending"}
		</output>
	);
}

describe("device time provider", () => {
	it("provides a local clock outside the authenticated app shell", () => {
		const markup = renderToStaticMarkup(<OutsideAppClock />);

		expect(markup).toContain('data-ready="true"');
		expect(markup).toMatch(/\d{4}-\d{2}-\d{2}/);
	});
});
