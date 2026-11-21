import type { Project } from "../types";

/**
 * Picks which program (entry file + everything it includes) a document belongs to. A file can be included by
 * several independent programs; `pil.entryFile` disambiguates, otherwise an ambiguity warning is attached.
 */
export function selectProgram(documentUri: string, projects: Project[], entryUri?: string): Project {
	const own = projects.find((p) => p.entryUri === documentUri)!;
	if (entryUri) {
		const chosen = projects.find((p) => p.entryUri === entryUri && p.documents.has(documentUri));
		if (chosen) return chosen;
	}
	const candidates = projects.filter((p) => p.documents.has(documentUri));
	const roots = candidates.filter((p) => !candidates.some((q) => q.entryUri !== p.entryUri && q.documents.has(p.entryUri) && !p.documents.has(q.entryUri)));
	if (roots.length === 1) return roots[0];
	if (roots.length > 1) {
		const names = roots.map((p) => p.entryUri.split("/").at(-1)).join(", ");
		return { ...own, issues: [...own.issues, { uri: documentUri, span: { start: 0, end: 0 }, severity: "warning", message: `Multiple PIL entry files include this document. Set pil.entryFile to select the program context (${names}).` }] };
	}
	return own;
}
