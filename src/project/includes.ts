import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ParsedDocument, Span } from "../types";

/**
 * PIL resolves `include "path"` against the interpreter's working directory, not the including file's
 * directory. `workingDirectory` (the `pil.workingDirectory` setting) names that directory, relative to
 * the workspace folder; with no setting it is the workspace folder, or the entry file's directory.
 */
export function includeUri(entryUri: string, includePath: string, workspaceRoot?: string, workingDirectory?: string): string {
	const root = workspaceRoot ? fileURLToPath(workspaceRoot) : dirname(fileURLToPath(entryUri));
	const base = workingDirectory ? (isAbsolute(workingDirectory) ? workingDirectory : resolve(root, workingDirectory)) : root;
	return pathToFileURL(resolve(base, includePath)).href;
}

export interface IncludeCompletionContext {
	directoryPart: string;
	prefix: string;
	span: Span;
}

/** When the cursor is inside the quoted path of an `include "..."`, describes what to complete. */
export function includeCompletionContext(document: ParsedDocument, offset: number): IncludeCompletionContext | undefined {
	const include = document.includes.find((i) => {
		const closed = document.text[i.span.end - 1] === '"' && i.span.end - i.span.start > 1;
		return offset > i.span.start && offset <= (closed ? i.span.end - 1 : i.span.end);
	});
	if (!include) return;
	const typed = document.text.slice(include.span.start + 1, offset);
	const slash = Math.max(typed.lastIndexOf("/"), typed.lastIndexOf("\\"));
	const prefix = typed.slice(slash + 1);
	const base = typed.slice(0, slash + 1);
	return { directoryPart: base + ".", prefix, span: { start: offset - prefix.length, end: offset } };
}
