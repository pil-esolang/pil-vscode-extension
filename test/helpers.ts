import { ProjectIndex } from "../src/project/index";
import { parseDocument } from "../src/language/parser";
import type { Issue, Project, ProjectIssue } from "../src/types";

/** Messages (and severities) the parser alone reports for one file. */
export function parse(source: string) {
	return parseDocument("file:///main.pil", source, 0);
}

export function issuesOf(source: string): Issue[] {
	return parse(source).issues;
}

export const messages = (issues: Issue[]) => issues.map((i) => i.message);

/** The source text an issue's span points at. */
export const underlined = (source: string, issue: Issue) => source.slice(issue.span.start, issue.span.end);

/** Builds a whole program from in-memory files. `include "x"` resolves to file:///x (PIL uses the working directory). */
export async function buildProject(files: Record<string, string>, entry = "main.pil"): Promise<Project> {
	const index = new ProjectIndex(
		async (uri) => {
			const text = files[uri.replace("file:///", "")];
			if (text === undefined) throw new Error("not found");
			return text;
		},
		(_entry, path) => "file:///" + path,
	);
	return index.snapshot("file:///" + entry);
}

export const projectMessages = (project: Project, uri = "file:///main.pil"): ProjectIssue[] => project.issues.filter((i) => i.uri === uri);
