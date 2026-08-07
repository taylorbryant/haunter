export class HtmlExportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HtmlExportError";
	}
}
