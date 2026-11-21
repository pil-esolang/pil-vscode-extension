import { getBuiltin } from "../catalog/builtins";
import type { PilSymbol, Project, Severity, Span } from "../types";
import { checkNames } from "./names";

/**
 * Whole-program symbol checks that mirror source/parser.cpp.
 *
 * PIL resolves names in two phases over the include-expanded token stream:
 *   1. a prepass registers every built-in that is mentioned, then every struct, function and label, anywhere in the program;
 *   2. the main pass walks the tokens in order and registers const/global declarations and array-enum entries as it reaches them.
 * All of these share one flat namespace (`constants`). A new name that collides with an existing one is an error, which is why
 * a local called `size`, or a const called like a function, is rejected. Order matters only for phase 2 names.
 */

const PREPASS_KINDS = new Set(["function", "label", "struct"]);
const kindLabel: Record<string, string> = { function: "function", label: "label", struct: "structure", constant: "constant", global: "global", enumMember: "array enumeration entry" };

export function checkProject(project: Project): void {
	const orderOf = (s: PilSymbol) => project.order.get(s.id) ?? Number.MAX_SAFE_INTEGER;
	const byOrder = (a: PilSymbol, b: PilSymbol) => orderOf(a) - orderOf(b);
	const report = (uri: string, span: Span, message: string, severity: Severity = "error") => project.issues.push({ uri, span, message, severity });

	const prepass = project.symbols.filter((s) => PREPASS_KINDS.has(s.kind)).sort(byOrder);
	const mainPass = project.symbols.filter((s) => s.kind === "constant" || s.kind === "global" || (s.kind === "enumMember" && s.unqualified)).sort(byOrder);

	// -- redefinitions in the shared namespace
	const prepassByName = new Map<string, PilSymbol>();
	for (const s of prepass) {
		const previous = prepassByName.get(s.name);
		if (getBuiltin(s.name)) report(s.uri, s.nameSpan, `'${s.name}' is a built-in and cannot be redefined as a ${kindLabel[s.kind]}`);
		else if (previous) report(s.uri, s.nameSpan, `${kindLabel[s.kind]} '${s.name}' redefined (already a ${kindLabel[previous.kind]})`);
		else prepassByName.set(s.name, s);
	}
	const mainByName = new Map<string, PilSymbol>();
	for (const s of mainPass) {
		const previous = prepassByName.get(s.name) ?? mainByName.get(s.name);
		if (getBuiltin(s.name)) report(s.uri, s.nameSpan, `'${s.name}' is a built-in and cannot be redefined as a ${kindLabel[s.kind]}`);
		else if (previous) report(s.uri, s.nameSpan, `Symbol '${s.name}' redefined (already a ${kindLabel[previous.kind]})`);
		else mainByName.set(s.name, s);
	}

	// -- locals and parameters may not reuse any name that is already taken at that point
	for (const s of project.symbols) {
		if (s.kind !== "variable" && s.kind !== "parameter") continue;
		const taken = prepassByName.get(s.name) ?? (mainByName.has(s.name) && orderOf(mainByName.get(s.name)!) < orderOf(s) ? mainByName.get(s.name) : undefined);
		if (getBuiltin(s.name)) report(s.uri, s.nameSpan, `Redefined variable '${s.name}': it is a built-in`);
		else if (taken) report(s.uri, s.nameSpan, `Redefined variable '${s.name}': it is already a ${kindLabel[taken.kind]}`);
	}

	// -- names used in statements, const/global/enum values and `[ ... ]` expressions, and argument counts
	checkNames(project);
}
