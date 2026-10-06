import * as Y from "yjs";
import {
	EditableTableContentSchema,
	MAX_TABLE_COLUMNS,
	MAX_TABLE_ROWS,
	type EditableTableContent,
	type TableOperation,
} from "@/features/pages/block-editing";
import { appError } from "@/features/shared/errors";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";
import { seedPageBody } from "./codec";
import { updateInlineContent } from "./inline-edits";

function invalid(message: string): never {
	throw appError("InvalidPageContent", { message });
}

export function editableTableContent(value: unknown): EditableTableContent {
	// BlockNote's in-memory projection includes undefined keys (e.g. mention
	// content); normalize to the JSON representation returned to MCP clients.
	const parsed = EditableTableContentSchema.safeParse(
		JSON.parse(JSON.stringify(value) ?? "null"),
	);
	if (!parsed.success)
		invalid(
			"Table edits require a rectangular table with unmerged cells, at most 200 rows and 50 columns, and supported inline content. Read the page with format=blocks.",
		);
	return parsed.data;
}

function element(
	parent: Y.XmlElement | Y.XmlFragment,
	index: number,
	names: string[],
): Y.XmlElement {
	const node = parent.get(index);
	if (!(node instanceof Y.XmlElement) || !names.includes(node.nodeName))
		invalid("Invalid table structure. Read the page again.");
	return node;
}

function withSourceTable(
	content: EditableTableContent,
	apply: (source: Y.XmlElement) => void,
) {
	const source = seedPageBody([
		{ id: "table-source", type: "table", props: {}, content, children: [] },
	]);
	try {
		const group = element(source.getXmlFragment(PAGE_BODY_FRAGMENT), 0, [
			"blockGroup",
		]);
		apply(element(element(group, 0, ["blockContainer"]), 0, ["table"]));
	} finally {
		source.destroy();
	}
}

/** Retain existing rows, cells, and text nodes so unrelated concurrent typing survives. */
export function editTable(
	table: Y.XmlElement,
	content: EditableTableContent,
	operation: TableOperation,
) {
	const rows = content.rows.length;
	const columns = content.rows[0]!.cells.length;
	if (table.nodeName !== "table" || table.length !== rows)
		invalid("Invalid table structure.");
	const rowNodes = content.rows.map((_, i) => {
		const row = element(table, i, ["tableRow"]);
		if (row.length !== columns) invalid("Invalid table structure.");
		return row;
	});
	if (operation.op === "update_table_cell") {
		if (operation.row >= rows || operation.column >= columns)
			invalid("The table cell is outside the current table.");
		const cell = element(rowNodes[operation.row]!, operation.column, [
			"tableCell",
			"tableHeader",
		]);
		if (cell.length !== 1)
			invalid(
				"Editing cells with multiple paragraphs is not supported. Split or normalize this cell in the editor first.",
			);
		withSourceTable(
			{ type: "tableContent", rows: [{ cells: [operation.content] }] },
			(source) => {
				const paragraph = element(
					element(element(source, 0, ["tableRow"]), 0, ["tableCell"]),
					0,
					["tableParagraph"],
				);
				updateInlineContent(element(cell, 0, ["tableParagraph"]), paragraph);
			},
		);
		return;
	}
	const isRow =
		operation.op === "insert_table_row" || operation.op === "delete_table_row";
	const size = isRow ? rows : columns;
	const inserting =
		operation.op === "insert_table_row" ||
		operation.op === "insert_table_column";
	if (operation.index > size || (!inserting && operation.index === size))
		invalid("The table index is outside the current table.");
	if (!inserting && size === 1)
		invalid(
			"A table must retain at least one row and column. Delete the table block to remove it.",
		);
	if (inserting && size >= (isRow ? MAX_TABLE_ROWS : MAX_TABLE_COLUMNS))
		invalid("The table has reached the supported row or column limit.");
	if (operation.op === "delete_table_row") {
		table.delete(operation.index, 1);
		return;
	}
	if (operation.op === "delete_table_column") {
		for (const row of rowNodes) row.delete(operation.index, 1);
		return;
	}
	if (operation.cells.length !== (isRow ? columns : rows))
		invalid(
			"Provide exactly one cell per existing column for a new row, or per existing row for a new column.",
		);
	if (operation.op === "insert_table_row") {
		withSourceTable(
			{
				type: "tableContent",
				columnWidths: content.columnWidths,
				headerRows: operation.index < (content.headerRows ?? 0) ? 1 : 0,
				headerCols: content.headerCols,
				rows: [{ cells: operation.cells }],
			},
			(source) =>
				table.insert(operation.index, [
					element(source, 0, ["tableRow"]).clone(),
				]),
		);
	} else {
		withSourceTable(
			{
				type: "tableContent",
				columnWidths: [operation.width ?? null],
				headerRows: content.headerRows,
				headerCols: operation.index < (content.headerCols ?? 0) ? 1 : 0,
				rows: operation.cells.map((cell) => ({ cells: [cell] })),
			},
			(source) => {
				for (let i = 0; i < rows; i++)
					rowNodes[i]!.insert(operation.index, [
						element(element(source, i, ["tableRow"]), 0, [
							"tableCell",
							"tableHeader",
						]).clone(),
					]);
			},
		);
	}
}
