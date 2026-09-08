import { expect, test } from "bun:test";
import * as Y from "yjs";
import { seedPageBody } from "@/infra/documents/codec";
import { validateDocumentUpdate } from "@/infra/documents/validate-update";
import { firstText, paragraph } from "./helpers";

test("candidate validation preserves the live body and rejects incompatible schemas or block types before broadcast", () => {
	const live = seedPageBody([paragraph("Keep me")]);
	const client = new Y.Doc();
	try {
		Y.applyUpdate(client, Y.encodeStateAsUpdate(live));
		firstText(client).insert(0, "New ");
		expect(() =>
			validateDocumentUpdate(live, Y.encodeStateAsUpdate(client)),
		).not.toThrow();
		expect(firstText(live).toString()).toBe("Keep me");
		client.getMap("haunter").set("schemaVersion", 999);
		expect(() =>
			validateDocumentUpdate(live, Y.encodeStateAsUpdate(client)),
		).toThrow();
		expect(live.getMap("haunter").get("schemaVersion")).toBe(1);
		client.getMap("haunter").set("schemaVersion", 1);
		const group = client.getXmlFragment("body").get(0) as Y.XmlElement;
		group.insert(0, [new Y.XmlElement("unsupported-node")]);
		expect(() =>
			validateDocumentUpdate(live, Y.encodeStateAsUpdate(client)),
		).toThrow();
		expect(firstText(live).toString()).toBe("Keep me");
	} finally {
		live.destroy();
		client.destroy();
	}
});
