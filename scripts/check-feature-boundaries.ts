import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "@typescript/typescript6";

const FEATURE_ROOT = path.join(process.cwd(), "features");
const PEER_FEATURES = new Set(["pages", "tasks"]);

function isDomainFile(relativePath: string): boolean {
	const [, ...segments] = relativePath.split("/");
	const featurePath = segments.join("/");
	return !(
		/^(client|components|tests)\//.test(featurePath) ||
		/\.(test|spec)\.[jt]sx?$/.test(featurePath)
	);
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const candidate = path.join(directory, entry.name);
			if (entry.isDirectory()) return listTypeScriptFiles(candidate);
			return /\.(ts|tsx)$/.test(entry.name) ? [candidate] : [];
		}),
	);
	return files.flat();
}

function importedFeature(
	specifier: string,
	sourceFile: string,
	featureRoot: string,
): string | null {
	const match = specifier.match(/^@\/features\/([^/]+)(?:\/|$)/);
	if (match) return match[1] ?? null;
	if (!specifier.startsWith(".")) return null;

	const target = path.resolve(path.dirname(sourceFile), specifier);
	const relative = path.relative(featureRoot, target).replaceAll(path.sep, "/");
	if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
	return relative.split("/")[0] ?? null;
}

function importHasRuntimeValue(node: ts.ImportDeclaration): boolean {
	const clause = node.importClause;
	if (!clause) return true;
	if (clause.isTypeOnly) return false;
	if (clause.name) return true;
	const bindings = clause.namedBindings;
	if (!bindings) return false;
	if (ts.isNamespaceImport(bindings)) return true;
	return bindings.elements.some((element) => !element.isTypeOnly);
}

function exportHasRuntimeValue(node: ts.ExportDeclaration): boolean {
	if (node.isTypeOnly) return false;
	if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return true;
	return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

export async function findPageTaskDomainBoundaryViolations(
	featureRoot = FEATURE_ROOT,
): Promise<string[]> {
	const files = (await listTypeScriptFiles(featureRoot)).filter((file) => {
		const relative = path.relative(featureRoot, file).replaceAll(path.sep, "/");
		return isDomainFile(relative);
	});
	const violations: string[] = [];

	for (const file of files) {
		const relative = path.relative(featureRoot, file).replaceAll(path.sep, "/");
		const sourceFeature = relative.split("/")[0];
		if (!sourceFeature || !PEER_FEATURES.has(sourceFeature)) continue;

		const sourceText = await Bun.file(file).text();
		const sourceFile = ts.createSourceFile(
			file,
			sourceText,
			ts.ScriptTarget.Latest,
			true,
			file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);

		const record = (specifier: string, node: ts.Node) => {
			const targetFeature = importedFeature(specifier, file, featureRoot);
			if (
				targetFeature &&
				PEER_FEATURES.has(targetFeature) &&
				targetFeature !== sourceFeature
			) {
				const { line } = sourceFile.getLineAndCharacterOfPosition(
					node.getStart(sourceFile),
				);
				violations.push(
					`${relative}:${line + 1} imports runtime code from features/${targetFeature}`,
				);
			}
		};

		const visit = (node: ts.Node) => {
			if (
				ts.isImportDeclaration(node) &&
				ts.isStringLiteral(node.moduleSpecifier) &&
				importHasRuntimeValue(node)
			) {
				record(node.moduleSpecifier.text, node);
			} else if (
				ts.isExportDeclaration(node) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier) &&
				exportHasRuntimeValue(node)
			) {
				record(node.moduleSpecifier.text, node);
			} else if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				node.arguments.length === 1 &&
				ts.isStringLiteral(node.arguments[0])
			) {
				record(node.arguments[0].text, node);
			} else if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "require" &&
				node.arguments.length === 1 &&
				ts.isStringLiteral(node.arguments[0])
			) {
				record(node.arguments[0].text, node);
			}
			ts.forEachChild(node, visit);
		};

		visit(sourceFile);
	}

	return violations.sort();
}

if (import.meta.main) {
	const violations = await findPageTaskDomainBoundaryViolations();
	if (violations.length > 0) {
		console.error(
			[
				"Page/task domain boundary violations:",
				...violations.map((violation) => `- ${violation}`),
			].join("\n"),
		);
		process.exitCode = 1;
	} else {
		console.log("Page/task domain boundaries are cycle-free.");
	}
}
