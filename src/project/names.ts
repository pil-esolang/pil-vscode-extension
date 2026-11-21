import { getBuiltin } from "../catalog/builtins";
import { getEvaluatorBuiltin } from "../catalog/evaluator";
import { isValueStart, scanValue } from "../language/parser";
import type { BuiltinInfo, ParsedDocument, PilSymbol, Project, Severity, Span, Token } from "../types";

/**
 * Name resolution and argument counts, mirroring source/parser.cpp (`parseToken`, `internalParse`, the call-statement
 * branch) and source/mee.cpp (the `[ ... ]` constant evaluator).
 *
 * What the interpreter does, which this file reproduces:
 *  - the command word of a statement is looked up in the global namespace only (never among locals);
 *  - functions, labels and structures are visible everywhere; const/global declarations and array-enum entries only
 *    after the point they are declared; enumerations are looked up by `Enum.Entry` in declaration order;
 *  - an argument is a local/parameter declared earlier in the same function, or a global-namespace name;
 *  - `.field` is only understood after a local/parameter, never after a global or constant;
 *  - the argument count of a user function or built-in is checked while parsing, `call` checks its callee's.
 */

type Order = number;

const KIND_LABEL: Record<string, string> = {
	function: "function",
	label: "label",
	struct: "structure",
	constant: "constant",
	global: "global",
	enum: "enumeration",
	enumMember: "array enumeration entry",
	variable: "local variable",
	parameter: "parameter",
};

type Resolved = { kind: "literal" | "expression" | "local" | "enum" | "unknown" } | { kind: "symbol"; symbol: PilSymbol } | { kind: "builtin"; builtin: BuiltinInfo };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function checkNames(project: Project): void {
	const report = (uri: string, span: Span, message: string, severity: Severity = "error") => project.issues.push({ uri, span, message, severity });
	const orderOfKey = (key: string): Order => project.order.get(key) ?? Number.POSITIVE_INFINITY;
	const symbolOrder = (s: PilSymbol) => orderOfKey(s.id);
	const tokenOrder = (uri: string, t: Token) => orderOfKey(`${uri}#${t.span.start}`);

	// main() must exist for the program to run. A file with no `main` is a library, or a program that is not finished
	// yet, and its unresolved names usually live in whichever file includes it, so name resolution would only add noise.
	const mains = project.symbols.filter((s) => s.kind === "function" && s.name === "main");
	for (const m of mains) if (m.parameters.length) report(m.uri, m.nameSpan, "Expected function 'main' to not have any parameters");
	if (!mains.length) {
		const entry = project.documents.get(project.entryUri);
		const first = entry?.tokens.find((t) => t.kind !== "comment" && t.kind !== "newline");
		if (first) report(project.entryUri, first.span, "No 'main' function, so PIL cannot run this file as a program. Ignore this if the file is only meant to be included", "warning");
		return;
	}

	// ---- the shared namespace -------------------------------------------------------------------------------------
	const prepass = new Map<string, PilSymbol>(); // functions, labels, structures: visible from anywhere
	const declared = new Map<string, PilSymbol[]>(); // const/global/array-enum entries, in declaration order
	const enums = new Map<string, PilSymbol[]>();
	const entriesOf = new Map<string, PilSymbol[]>(); // enum symbol id -> its entries
	const locals = new Map<string, PilSymbol[]>(); // function symbol id -> its parameters and locals
	const functionsByUri = new Map<string, PilSymbol[]>();
	for (const s of project.symbols) {
		if (s.kind === "function" || s.kind === "label" || s.kind === "struct") {
			if (!prepass.has(s.name)) prepass.set(s.name, s);
			if (s.kind === "function") functionsByUri.set(s.uri, [...(functionsByUri.get(s.uri) ?? []), s]);
		} else if (s.kind === "constant" || s.kind === "global" || (s.kind === "enumMember" && s.unqualified)) {
			declared.set(s.name, [...(declared.get(s.name) ?? []), s]);
		}
		if (s.kind === "enum") enums.set(s.name, [...(enums.get(s.name) ?? []), s]);
		if (s.kind === "enumMember" && s.parentId) entriesOf.set(s.parentId, [...(entriesOf.get(s.parentId) ?? []), s]);
		if ((s.kind === "variable" || s.kind === "parameter") && s.parentId) locals.set(s.parentId, [...(locals.get(s.parentId) ?? []), s]);
	}
	for (const list of functionsByUri.values()) list.sort((a, b) => a.nameSpan.start - b.nameSpan.start);

	const lookup = (name: string, ctx: Order): PilSymbol | undefined => prepass.get(name) ?? declared.get(name)?.find((s) => symbolOrder(s) < ctx);
	const laterDeclaration = (name: string, ctx: Order) => declared.get(name)?.find((s) => symbolOrder(s) >= ctx);
	const functionAt = (uri: string, offset: number) => functionsByUri.get(uri)?.filter((f) => f.nameSpan.start < offset).at(-1);
	const localAt = (uri: string, offset: number, name: string) => {
		const fn = functionAt(uri, offset);
		return fn ? locals.get(fn.id)?.find((v) => v.name === name && v.nameSpan.start < offset) : undefined;
	};
	const enumEntry = (enumName: string, entry: string, ctx: Order) => {
		for (const e of enums.get(enumName) ?? []) {
			if (symbolOrder(e) >= ctx) continue;
			const member = entriesOf.get(e.id)?.find((m) => m.name === entry && symbolOrder(m) < ctx);
			if (member) return member;
		}
		return undefined;
	};

	// whether a const's value is a number, which is all the constant evaluator can read
	const isNumeric = (s: PilSymbol, depth = 0): boolean => {
		if (s.kind === "enumMember") return true;
		if (s.kind !== "constant") return false;
		const init = s.initializer;
		if (!init?.length || depth > 8) return true;
		if (init[0].kind === "string" || init[0].kind === "character") return false;
		if (init[0].kind === "identifier" && init.length === 1) {
			const target = lookup(init[0].text, symbolOrder(s));
			return target ? isNumeric(target, depth + 1) : getBuiltin(init[0].text) === undefined;
		}
		return true;
	};

	// ---- `[ ... ]` --------------------------------------------------------------------------------------------------
	const levels = [["||"], ["&&"], ["==", "!="], ["<", ">", "<=", ">="], ["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
	function checkExpression(uri: string, arg: Token[], ctx: Order): void {
		const closed = arg.length > 1 && arg.at(-1)!.text === "]";
		const e = arg.slice(1, closed ? -1 : undefined);
		const anchor = closed ? arg.at(-1)! : arg[0];
		let p = 0;
		let failed = false;
		const fail = (message: string, at: Token) => {
			if (!failed) report(uri, at.span, message);
			failed = true;
		};
		const isOp = (t: Token | undefined, ops: string[]) => !!t && t.kind === "operator" && ops.includes(t.text);

		const level = (k: number): void => {
			if (k === levels.length) return exponent();
			level(k + 1);
			while (!failed && isOp(e[p], levels[k])) {
				p++;
				level(k + 1);
			}
		};
		const exponent = (): void => {
			unary();
			if (!failed && isOp(e[p], ["**"])) {
				p++;
				exponent();
			}
		};
		const unary = (): void => {
			if (isOp(e[p], ["-", "+", "~", "!"])) {
				p++;
				unary();
			} else primary();
		};
		const primary = (): void => {
			const t = e[p];
			if (!t) return fail("Expected a value in the constant evaluator expression", anchor);
			if (t.text === "(") {
				p++;
				level(0);
				if (failed) return;
				if (e[p]?.text !== ")") return fail("Expected ')' in the constant evaluator expression", e[p] ?? t);
				p++;
				return;
			}
			if (t.kind === "identifier" && e[p + 1]?.text === "(") {
				const fn = getEvaluatorBuiltin(t.text);
				if (!fn) return fail(`No such constant evaluator function '${t.text}'`, t);
				p += 2;
				let count = 0;
				while (!failed && e[p] && e[p].text !== ")") {
					level(0);
					count++;
					if (e[p]?.text === ",") p++;
					else break;
				}
				if (failed) return;
				if (e[p]?.text !== ")") return fail(`Expected ')' to close the call to '${t.text}'`, e[p] ?? t);
				p++;
				if (count !== fn.minimumArity) fail(`${t.text}() expects ${plural(fn.minimumArity, "argument")}, got ${count}`, t);
				return;
			}
			if (t.kind === "identifier") {
				const symbol = lookup(t.text, ctx);
				p++;
				if (symbol && (symbol.kind === "constant" || symbol.kind === "enumMember") && isNumeric(symbol)) return;
				if (symbol || getBuiltin(t.text)) {
					const what = symbol ? KIND_LABEL[symbol.kind] + (symbol.kind === "constant" ? " with a non-numeric value" : "") : "built-in function";
					return fail(`'${t.text}' cannot be used in the constant evaluator: it is a ${what}. Only numeric constants and array enumeration entries can`, t);
				}
				let hint = "";
				if (laterDeclaration(t.text, ctx)) hint = ". Constants must be declared before they are used";
				else if (enums.has(t.text)) hint = ". Enumeration entries cannot be read here; use an array enumeration or a const";
				else if (t.text.includes("-")) hint = ". Names may contain '-', so write subtraction with spaces: a - b";
				else if (getEvaluatorBuiltin(t.text)) hint = `. Did you mean ${t.text}()?`;
				return fail(`Variable '${t.text}' does not exist${hint}`, t);
			}
			if (t.kind === "number") {
				p++;
				return;
			}
			if (t.kind === "string" || t.kind === "character") return fail(`Invalid value in constant evaluator: a ${t.kind} is not a number`, t);
			return fail(`Unexpected '${t.text}' in the constant evaluator expression`, t);
		};

		level(0);
		if (!failed && p < e.length) fail(`Unexpected '${e[p].text}' in the constant evaluator expression`, e[p]);
	}

	// ---- one value ------------------------------------------------------------------------------------------------
	function resolveValue(uri: string, arg: Token[], ctx: Order, allowLocals: boolean): Resolved {
		const first = arg[0];
		if (first.text === "[") {
			checkExpression(uri, arg, ctx);
			return { kind: "expression" };
		}
		if (first.kind !== "identifier") return { kind: "literal" };

		// Enum.Entry is looked up before anything else, so it wins over a local with the enumeration's name
		if (arg[1]?.text === "." && arg[2]?.kind === "identifier" && enumEntry(first.text, arg[2].text, ctx)) return { kind: "enum" };

		const hasField = arg[1]?.text === ".";
		if (allowLocals && localAt(uri, first.span.start, first.text)) return { kind: "local" };

		const symbol = lookup(first.text, ctx);
		const builtin = symbol ? undefined : getBuiltin(first.text);
		if (symbol || builtin) {
			if (hasField) {
				const what = symbol ? KIND_LABEL[symbol.kind] : "built-in function";
				report(uri, arg[1].span, `Field access only works on local variables and parameters, but '${first.text}' is a ${what}`);
			}
			return symbol ? { kind: "symbol", symbol } : { kind: "builtin", builtin: builtin! };
		}

		let hint = "";
		if (laterDeclaration(first.text, ctx)) hint = ". Constants, globals and array enumerations must be declared before they are used";
		else if (hasField && enums.has(first.text)) hint = `. Enumeration '${first.text}' has no entry '${arg[2]?.text ?? ""}'`;
		else if (enums.has(first.text)) hint = `. '${first.text}' is an enumeration: write ${first.text}.ENTRY`;
		else if (!allowLocals) hint = ". Constants and globals can only use values declared before them, never locals";
		report(uri, first.span, `Variable '${first.text}' does not exist${hint}`);
		return { kind: "unknown" };
	}

	const argumentsOf = (tokens: Token[]): Token[][] => {
		const out: Token[][] = [];
		for (let k = 0; k < tokens.length; ) {
			if (tokens[k].text === "," || !isValueStart(tokens[k])) {
				k++;
				continue;
			}
			const { end } = scanValue(tokens, k);
			out.push(tokens.slice(k, end));
			k = Math.max(end, k + 1);
		}
		return out;
	};

	const arityProblem = (name: string, target: PilSymbol | BuiltinInfo, got: number, lead = ""): string | undefined => {
		const isBuiltin = !("kind" in target);
		const min = isBuiltin ? target.minimumArity : target.parameters.length;
		const variadic = isBuiltin && target.variadic;
		if (variadic ? got >= min : got === min) return;
		return `${lead}'${name}' expects ${variadic ? "at least " : ""}${plural(min, "argument")}, but got ${got}`;
	};

	// ---- const/global/enum values ----------------------------------------------------------------------------------
	for (const s of project.symbols) {
		const init = s.initializer;
		if (!init?.length || !["constant", "global", "enumMember"].includes(s.kind)) continue;
		const arg = argumentsOf(init)[0];
		if (!arg) continue;
		const value = resolveValue(s.uri, arg, symbolOrder(s), false);
		// a const that holds a number is fine (PIL substitutes its value); functions, labels and globals are not numbers
		const numeric = value.kind === "symbol" && (value.symbol.kind === "enumMember" || (value.symbol.kind === "constant" && isNumeric(value.symbol)));
		if (s.kind === "enumMember" && (arg[0].kind === "string" || arg[0].kind === "character" || value.kind === "builtin" || (value.kind === "symbol" && !numeric))) {
			report(s.uri, arg[0].span, "Expected a number after '='; enumeration values must be numbers");
		}
	}

	// ---- call statements ------------------------------------------------------------------------------------------
	for (const doc of project.documents.values()) checkStatements(doc);

	function checkStatements(doc: ParsedDocument): void {
		const uri = doc.uri;
		for (const statement of doc.statements) {
			if (statement.kind !== "call") continue;
			const command = statement.tokens[0];
			if (command?.kind !== "identifier") continue;
			const ctx = tokenOrder(uri, command);
			if (!functionAt(uri, command.span.start)) report(uri, command.span, "Statements outside of a function are never run", "warning");

			const symbol = lookup(command.text, ctx);
			const builtin = symbol ? undefined : getBuiltin(command.text);
			if (!symbol && !builtin) {
				// like the interpreter, give up on this statement instead of piling errors onto its arguments
				report(uri, command.span, laterDeclaration(command.text, ctx) ? `'${command.text}' is a constant or global, not a function` : `No such function '${command.text}'`);
				continue;
			}
			if (symbol && symbol.kind !== "function") {
				report(uri, command.span, `'${command.text}' is a ${KIND_LABEL[symbol.kind]}, not a function`);
				continue;
			}
			const target = (symbol ?? builtin)!;

			const args = argumentsOf(statement.tokens.slice(1));
			const values = args.map((arg) => resolveValue(uri, arg, tokenOrder(uri, arg[0]), true));

			// a statement that is already malformed has an unreliable argument list; its syntax error is enough
			const malformed = doc.issues.some((i) => i.severity !== "warning" && i.span.start >= statement.span.start && i.span.start <= statement.span.end);
			if (malformed) continue;

			const problem = arityProblem(command.text, target, args.length);
			if (problem) report(uri, command.span, problem);

			if (command.text === "call" && builtin) {
				const functions = args.map((a, k) => ({ a, k, v: values[k] })).filter((x) => x.a.length === 1 && (x.v.kind === "builtin" || (x.v.kind === "symbol" && x.v.symbol.kind === "function")));
				if (!functions.length) {
					report(uri, command.span, "call: expected the name of a function to call");
				} else if (functions.length > 1) {
					report(uri, functions[1].a[0].span, "call: cannot call multiple functions in a single call. Arguments cannot be function names");
				} else {
					const callee = functions[0].v;
					const calleeTarget = callee.kind === "symbol" ? callee.symbol : (callee as { builtin: BuiltinInfo }).builtin;
					const p = arityProblem(functions[0].a[0].text, calleeTarget, args.length - functions[0].k - 1, "call: ");
					if (p) report(uri, functions[0].a[0].span, p);
				}
			}
		}
	}
}
