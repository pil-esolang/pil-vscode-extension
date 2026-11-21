import { parseDocument } from "../language/parser";
import type { ParsedDocument, Project, Span } from "../types";
import { checkProject } from "./checks";

type Reader = (uri: string) => Promise<string>;
type IncludeResolver = (entryUri: string, path: string) => string;

/** Parsed documents (open buffers win over disk) and the per-entry-file program snapshots built from them. */
export class ProjectIndex {
	private buffers = new Map<string, ParsedDocument>();
	private generation = 0;

	constructor(
		private read: Reader,
		private resolveInclude: IncludeResolver,
	) {}

	update(uri: string, text: string, version: number): void {
		if ((this.buffers.get(uri)?.version ?? -1) > version) return;
		if (this.buffers.get(uri)?.version === version && this.buffers.get(uri)?.text === text) return;
		this.buffers.set(uri, parseDocument(uri, text, version));
		this.generation++;
	}

	remove(uri: string): void {
		this.buffers.delete(uri);
		this.generation++;
	}

	async snapshot(entryUri: string): Promise<Project> {
		for (;;) {
			const generation = this.generation;
			const result = await this.buildSnapshot(entryUri);
			if (generation === this.generation) return result;
		}
	}

	private async buildSnapshot(entryUri: string): Promise<Project> {
		const project: Project = { entryUri, documents: new Map(), symbols: [], order: new Map(), issues: [], includeTargets: new Map() };
		let ordinal = 0;
		const visit = async (uri: string, from?: { uri: string; span: Span; path: string }): Promise<void> => {
			if (project.documents.has(uri)) return;
			let d = this.buffers.get(uri);
			if (!d) {
				try {
					const text = await this.read(uri);
					d = this.buffers.get(uri) ?? parseDocument(uri, text, 0);
				} catch {
					project.issues.push({ uri: from?.uri ?? uri, span: from?.span ?? { start: 0, end: 0 }, message: `Could not read ${from?.path ?? uri}`, severity: "error" });
					return;
				}
			}
			project.documents.set(uri, d);
			project.symbols.push(...d.declarations);
			project.issues.push(...d.issues.map((i) => ({ ...i, uri })));
			// PIL splices an included file's tokens in right after the `include "path"` tokens, so ordering follows that.
			const includes = new Map(d.includes.map((i) => [i.span.start, i]));
			for (const t of d.tokens) {
				project.order.set(`${uri}#${t.span.start}`, ordinal++);
				const include = includes.get(t.span.start);
				if (include) {
					try {
						const target = this.resolveInclude(entryUri, include.path);
						project.includeTargets.set(`${uri}#${include.span.start}`, target);
						await visit(target, { uri, span: include.span, path: include.path });
					} catch {
						project.issues.push({ uri, span: include.span, message: `Could not resolve include ${include.path}`, severity: "error" });
					}
				}
			}
		};
		await visit(entryUri);
		checkProject(project);
		return project;
	}
}
