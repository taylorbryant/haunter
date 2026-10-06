/** Read cell inline content from both BlockNote's shorthand and persisted cells. */
export function tableCellRows(content: unknown): unknown[][] {
	if (
		!content ||
		typeof content !== "object" ||
		!("type" in content) ||
		content.type !== "tableContent" ||
		!("rows" in content) ||
		!Array.isArray(content.rows)
	)
		return [];
	return content.rows.map((row: unknown) => {
		if (
			!row ||
			typeof row !== "object" ||
			!("cells" in row) ||
			!Array.isArray(row.cells)
		)
			return [];
		return row.cells.map((cell: unknown) => {
			if (Array.isArray(cell)) return cell;
			if (cell && typeof cell === "object" && "content" in cell)
				return cell.content;
			return [];
		});
	});
}
