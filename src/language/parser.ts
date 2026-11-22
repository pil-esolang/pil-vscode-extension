import { getBuiltin } from "../catalog/builtins";
import type { IncludeRef, Issue, ParsedDocument, PilSymbol, Severity, Span, Statement, StatementKind, SymbolKind, Token } from "../types";
import { lex } from "./lexer";

/** Words that start a declaration/statement of their own at the top level of a PIL file. */
const KEYWORDS = new Set(["struct", "enum", "local", "const", "global", "include"]);
/** Escape codes PIL's lexer knows (source/lexer.cpp: escapeCodeMap). */
const ESCAPES = new Set([..."abtnvfre\\'\"{"]);

export interface ListSplit {
	items: Token[][];
	/** commas that have no value before them (`a,,b` or `(,a)`). A single trailing comma is fine in PIL. */
	strayCommas: Token[];
}

/** Splits the inside of a `( ... )` list at its depth-0 commas. */
export function splitList(tokens: Token[]): ListSplit {
	const items: Token[][] = [[]];
	const strayCommas: Token[] = [];
	let depth = 0;
	for (const t of tokens) {
		if (t.text === "," && depth === 0) {
			if (!items.at(-1)!.length) strayCommas.push(t);
			items.push([]);
			continue;
		}
		items.at(-1)!.push(t);
		if (t.text === "[" || t.text === "(") depth++;
		if (t.text === "]" || t.text === ")") depth--;
	}
	return { items: items.filter((p) => p.length), strayCommas };
}

export function numericLiteral(value: string): number | undefined {
	const raw = value.replace(/^\[\s*|\s*\]$/g, "").trim();
	return /^[+-]?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined;
}

export interface ValueScan {
	/** index just past the value */
	end: number;
	/** set when the value itself is malformed */
	problem?: { message: string; token: Token };
}

/**
 * Scans one PIL value starting at `start`: a literal, `name`, `name.field.field`, or a `[ ... ]` constant
 * evaluator expression. `stop` lets callers end an unterminated `[` early (at a statement boundary).
 */
export function scanValue(tokens: Token[], start: number, stop?: (index: number) => boolean): ValueScan {
	const first = tokens[start];
	if (first.text === "[") {
		let depth = 0;
		let k = start;
		for (; k < tokens.length; k++) {
			const t = tokens[k];
			if (t.text === "[") depth++;
			else if (t.text === "]" && --depth === 0) return { end: k + 1 };
			else if (t.text === ";" || (k > start && stop?.(k))) break;
		}
		return { end: k, problem: { message: "Unterminated constant evaluator, expected ']'", token: first } };
	}
	let k = start + 1;
	if (first.kind === "identifier") {
		while (tokens[k]?.text === ".") {
			if (tokens[k + 1]?.kind === "identifier") k += 2;
			else return { end: k + 1, problem: { message: "Expected a field name after '.'", token: tokens[k] } };
		}
	}
	return { end: k };
}

export const isValueStart = (t: Token) => ["identifier", "number", "string", "character"].includes(t.kind) || t.text === "[";

/** Why `t` cannot begin a value. PIL has no signed number literals: `-1` must be written `[-1]`. */
function notAValue(t: Token, next?: Token): string {
	return `Unexpected ${describe(t)}: expected a value`;
}

function describe(t: Token): string {
	if (t.kind === "string") return "string";
	if (t.kind === "character") return "character";
	if (t.kind === "number") return `number '${t.text}'`;
	return `'${t.text}'`;
}

export function parseDocument(uri: string, text: string, version: number): ParsedDocument {
	const tokens = lex(text);
	const code = tokens.filter((t) => t.kind !== "comment" && t.kind !== "newline");
	const declarations: PilSymbol[] = [];
	const includes: IncludeRef[] = [];
	const issues: Issue[] = [];
	const statements: Statement[] = [];
	const declared = new Set<number>();
	const syntax = new Set<number>();
	let current: PilSymbol | undefined;
	let i = 0;

	const issue = (message: string, at: { span: Span }, severity: Severity = "error") => issues.push({ message, span: at.span, severity });
	const documentation = (offset: number) => {
		const lines = text.slice(0, offset).split(/\r?\n/);
		lines.pop();
		const comments: string[] = [];
		for (let n = lines.length - 1; n >= 0; n--) {
			const match = lines[n].match(/^\s*#\s?(.*)$/);
			if (!match) break;
			comments.unshift(match[1]);
		}
		return comments.join("\n");
	};
	const add = (token: Token, kind: SymbolKind, parentId?: string) => {
		const s: PilSymbol = { id: `${uri}#${token.span.start}`, name: token.text, kind, uri, nameSpan: { ...token.span }, span: { ...token.span }, parameters: [], parentId };
		declarations.push(s);
		declared.add(token.span.start);
		return s;
	};
	// An unterminated string/character swallows the rest of its line, `;` included. That is already reported once,
	// so do not add a second "Missing ';'" on top of it.
	const missingSemi = (prev: Token) => {
		if (prev.terminated === false) return;
		issue(`Missing ';' after '${prev.text}'`, prev);
	};
	const lineStart = (t: Token) => text.lastIndexOf("\n", t.span.start - 1) + 1;
	const atLineStart = (t: Token) => !text.slice(lineStart(t), t.span.start).trim();
	const column = (t: Token) => t.span.start - lineStart(t);
	const startsNewLine = (index: number) => index > 0 && text.slice(code[index - 1].span.end, code[index].span.start).includes("\n");

	// A line that begins a function, label or keyword statement: where a broken statement stops.
	const recoveryBoundary = (index: number) => {
		const t = code[index];
		return !!t && atLineStart(t) && t.kind === "identifier" && (KEYWORDS.has(t.text) || [`(`, `:`].includes(code[index + 1]?.text));
	};

	// Names declared as functions in this file, used to tell a new statement from a forgotten comma.
	const functionNames = new Set<string>();
	code.forEach((t, k) => {
		if (t.kind === "identifier" && code[k + 1]?.text === "(" && atLineStart(t)) functionNames.add(t.text);
	});
	const isCommandWord = (t: Token) => t.kind === "identifier" && (KEYWORDS.has(t.text) || !!getBuiltin(t.text) || functionNames.has(t.text));

	const unmatchedBrackets = new Set<number>();
	const bracketStack: number[] = [];
	code.forEach((token, index) => {
		if (token.text === "[") bracketStack.push(index);
		if (token.text === "]") bracketStack.pop();
	});
	bracketStack.forEach((index) => unmatchedBrackets.add(index));

	const record = (kind: StatementKind, start: number, end: number, spanEnd: number) => statements.push({ kind, tokens: code.slice(start, end), span: { start: code[start].span.start, end: spanEnd } });

	// End of a `( ... )` list. Stops early at a statement boundary when the closing parenthesis is missing.
	const listEnd = (open: number, header: Token) => {
		let round = 0;
		let square = 0;
		let j = open;
		let unfinishedExpression = false;
		for (; j < code.length; j++) {
			const t = code[j];
			if (j > open && recoveryBoundary(j) && ((square === 0 && round === 1) || (unfinishedExpression && column(t) <= column(header)))) break;
			if (unmatchedBrackets.has(j)) unfinishedExpression = true;
			if (t.text === "[") square++;
			if (t.text === "]") square = Math.max(0, square - 1);
			if (t.text === "(") round++;
			if (t.text === ")" && --round === 0) return { end: j, closed: true };
			if (t.text === ";" && square === 0) break;
		}
		return { end: j, closed: false };
	};

	// Reads a value inside a statement that began at `first`, reporting a malformed one.
	const readValue = (j: number, first: Token) => {
		const scan = scanValue(code, j, (k) => recoveryBoundary(k) && column(code[k]) <= column(first));
		if (scan.problem) issue(scan.problem.message, scan.problem.token);
		return scan.end;
	};

	// ---- lexical checks -------------------------------------------------------------------------------------
	tokens.forEach((t, k) => {
		if (t.kind === "invalid") {
			issue(`Unexpected character '${t.text}'`, t);
		} else if (t.kind === "number" && t.text.split(".").length > 2) {
			issue(`Number '${t.text}' contains multiple decimal points`, t);
		} else if (t.kind === "string" || t.kind === "character") {
			const what = t.kind === "string" ? "string" : "character";
			if (!t.terminated) {
				issue(`Unterminated ${what}`, t);
				return;
			}
			const inner = t.text.slice(1, -1);
			for (let n = 0; n < inner.length; n++) {
				if (inner[n] !== "\\") continue;
				if (inner[n + 1] !== undefined && !ESCAPES.has(inner[n + 1])) {
					const at = t.span.start + 1 + n;
					issue(`Unknown escape code '\\${inner[n + 1]}'`, { span: { start: at, end: at + 2 } }, "warning");
				}
				n++;
			}
			if (t.kind === "character" && inner.replace(/\\./, "x").length !== 1) issue("A character literal must contain exactly one character", t);
		}
	});

	// ---- statements -----------------------------------------------------------------------------------------
	while (i < code.length) {
		const start = i;
		const first = code[i];

		if (first.kind === "invalid") {
			i++; // already reported by the lexical checks
			continue;
		}
		if (first.text === ";") {
			issue("Unexpected ';': PIL does not allow empty statements, and only calls and const/global/local declarations end with ';'", first);
			i++;
			continue;
		}

		// include "file.pil"  (no semicolon)
		if (first.kind === "identifier" && first.text === "include") {
			syntax.add(first.span.start);
			const arg = code[i + 1];
			if (arg?.kind === "string") {
				includes.push({ path: arg.text.slice(1, arg.terminated ? -1 : undefined), span: arg.span });
				i += 2;
				record("include", start, i, arg.span.end);
				if (code[i]?.text === ";") {
					issue("'include' does not take a ';'. PIL would report this as an unexpected semicolon", code[i]);
					i++;
				}
			} else {
				issue("Expected a quoted file path after 'include'", first);
				i++;
				record("include", start, i, first.span.end);
			}
			continue;
		}

		// struct [array] Name ( a, b, c )  /  enum [array] Name ( A, B = 2 )
		if (first.kind === "identifier" && (first.text === "struct" || first.text === "enum")) {
			syntax.add(first.span.start);
			i++;
			const array = code[i]?.text === "array";
			if (array) {
				syntax.add(code[i].span.start);
				i++;
			}
			const name = code[i];
			if (name?.kind !== "identifier" || (atLineStart(name) && column(name) <= column(first) && text.slice(first.span.end, name.span.start).includes("\n") && recoveryBoundary(i))) {
				issue(`Expected ${first.text} name`, first);
				continue;
			}
			i++;
			const isEnum = first.text === "enum";
			const s = add(name, isEnum ? "enum" : "struct");
			s.documentation = documentation(first.span.start);
			if (code[i]?.text !== "(") {
				issue(`Expected '(' after ${first.text} name`, name);
				record(first.text as StatementKind, start, i, name.span.end);
				continue;
			}
			const { end: end2, closed } = listEnd(i, first);
			const { items, strayCommas } = splitList(code.slice(i + 1, end2));
			for (const c of strayCommas) issue("Unexpected ',': expected a name before it", c);
			let next: number | undefined = 0;
			for (const part of items) {
				const member = part[0];
				if (member.kind !== "identifier") {
					issue("Expected member name", member);
					continue;
				}
				const field = add(member, isEnum ? "enumMember" : "field", s.id);
				const comment = tokens.find((t) => t.kind === "comment" && t.span.start >= member.span.end && !text.slice(member.span.end, t.span.start).includes("\n"));
				field.documentation = comment?.text.slice(1).trim();
				const assign = part.findIndex((t) => t.text === "=");
				if (isEnum) {
					field.unqualified = array;
					if (assign === 1) {
						field.initializer = part.slice(2);
						if (part.length === 2) {
							issue("Expected a value after '='", part[1]);
						} else if (!isValueStart(part[2])) {
							issue(notAValue(part[2], part[3]), part[2]);
						} else {
							const scan = scanValue(part, 2);
							if (scan.problem) issue(scan.problem.message, scan.problem.token);
							else if (scan.end < part.length) issue(`Missing ',' after '${part[scan.end - 1].text}'`, part[scan.end - 1]);
						}
						field.value = part[2] ? text.slice(part[2].span.start, part.at(-1)!.span.end) : undefined;
						next = field.value ? numericLiteral(field.value) : undefined;
					} else {
						if (part.length > 1) issue(`Missing ',' after '${member.text}'`, member);
						if (next !== undefined) field.value = String(next);
					}
					if (next !== undefined) next++;
				} else {
					if (part.length > 1) issue(`Missing ',' after '${member.text}'`, member);
					s.parameters.push({ name: member.text, variadic: false, description: field.documentation });
				}
			}
			if (!closed) issue(`Unterminated ${first.text}: expected ')'`, first);
			if (!declarations.some((d) => d.parentId === s.id)) issue(`${first.text} needs at least one member`, name);
			s.span = { start: first.span.start, end: closed ? code[end2].span.end : (code[end2]?.span.start ?? text.length) };
			i = closed ? end2 + 1 : end2;
			record(first.text as StatementKind, start, i, s.span.end);
			continue;
		}

		// name(param, param)
		if (first.kind === "identifier" && code[i + 1]?.text === "(") {
			if (current) current.span.end = first.span.start;
			current = add(first, "function");
			current.span.end = text.length;
			current.documentation = documentation(first.span.start);
			const { end: end2, closed } = listEnd(i + 1, first);
			const { items, strayCommas } = splitList(code.slice(i + 2, end2));
			for (const c of strayCommas) issue("Unexpected ',': expected a parameter name before it", c);
			for (const part of items) {
				if (part[0].kind === "identifier") {
					current.parameters.push({ name: part[0].text, variadic: false });
					add(part[0], "parameter", current.id);
					if (part.length > 1) issue(`Missing ',' after '${part[0].text}'`, part[0]);
				} else {
					issue("Expected parameter name", part[0]);
				}
			}
			if (!closed) issue("Unterminated function parameters: expected ')'", first);
			i = closed ? end2 + 1 : end2;
			record("function", start, i, closed ? code[end2].span.end : (code[end2]?.span.start ?? text.length));
			continue;
		}

		// label:
		if (first.kind === "identifier" && code[i + 1]?.text === ":") {
			add(first, "label", current?.id);
			i += 2;
			record("label", start, i, code[i - 1].span.end);
			continue;
		}

		// local a, b;   const A = 1, B = 2;   global g, h = 3;
		if (first.kind === "identifier" && (first.text === "local" || first.text === "const" || first.text === "global")) {
			syntax.add(first.span.start);
			const kind = first.text as "local" | "const" | "global";
			if (kind === "local" && !current) issue("Local variables require a function", first);
			const docs = documentation(first.span.start);
			let j = i + 1;
			let lastComma: Token | undefined;
			let terminatorIndex = -1;

			for (;;) {
				// -- a name
				const t = code[j];
				if (!t || recoveryBoundary(j)) {
					issue(lastComma ? "Expected a name after ','" : `Expected a name after '${first.text}'`, lastComma ?? first);
					break;
				}
				if (t.text === ";") {
					if (!lastComma) issue(`Expected a name after '${first.text}'`, first);
					else issue("Expected a name after ','", lastComma);
					terminatorIndex = j;
					break;
				}
				if (t.kind !== "identifier") {
					if (t.kind !== "invalid") issue(`Expected a name, found ${describe(t)}`, t);
					j++;
					continue;
				}
				const symbolKind: SymbolKind = kind === "local" ? "variable" : kind === "global" ? "global" : "constant";
				const s = add(t, symbolKind, kind === "local" ? current?.id : undefined);
				s.documentation = docs;
				j++;
				lastComma = undefined;

				// -- an optional initial value
				if (code[j]?.text === "=") {
					const assign = code[j];
					if (kind === "local") {
						issue("A local cannot be given a value here. Declare it with 'local', then use 'set VALUE, name;'", assign);
						j++;
						if (code[j] && isValueStart(code[j]) && !recoveryBoundary(j)) j = readValue(j, first);
					} else {
						j++;
						if (!code[j] || code[j].text === ";" || code[j].text === "," || recoveryBoundary(j)) {
							issue("Expected a value after '='", assign);
						} else if (!isValueStart(code[j])) {
							issue(notAValue(code[j], code[j + 1]), code[j]);
							j += code[j + 1]?.kind === "number" ? 2 : 1;
						} else {
							const end = readValue(j, first);
							s.initializer = code.slice(j, end);
							s.value = text.slice(code[j].span.start, code[end - 1].span.end);
							j = end;
						}
					}
				} else if (kind === "const") {
					issue("Constants require '= VALUE'", t);
				}

				// -- what follows: ',' (more names), ';' (done), or something forgotten
				const after = code[j];
				if (!after) {
					missingSemi(code[j - 1]);
					break;
				}
				if (after.text === ",") {
					lastComma = after;
					j++;
					continue;
				}
				if (after.text === ";") {
					terminatorIndex = j;
					break;
				}
				if (recoveryBoundary(j) || startsNewLine(j)) {
					missingSemi(code[j - 1]);
					break;
				}
				if (after.kind === "identifier") {
					issue(`Missing ',' after '${code[j - 1].text}'`, code[j - 1]);
					continue; // treat `after` as the next name
				}
				// junk on the same line: report once, then skip to the end of the statement
				if (after.kind !== "invalid") issue(`Expected ',' or ';' after '${code[j - 1].text}', found ${describe(after)}`, after);
				while (code[j] && code[j].text !== ";" && !recoveryBoundary(j) && !startsNewLine(j)) j++;
				if (code[j]?.text === ";") terminatorIndex = j;
				break;
			}

			const endIndex = terminatorIndex >= 0 ? terminatorIndex : j;
			record(kind, start, Math.min(endIndex, code.length), code[endIndex]?.span.start ?? text.length);
			i = terminatorIndex >= 0 ? terminatorIndex + 1 : Math.max(j, start + 1);
			continue;
		}

		// a statement that is not a call
		if (first.kind !== "identifier") {
			issue(`Unexpected ${describe(first)}`, first);
			let j = i + 1;
			while (code[j] && code[j].text !== ";" && !recoveryBoundary(j)) j++;
			i = code[j]?.text === ";" ? j + 1 : Math.max(j, start + 1);
			continue;
		}

		// command arg, arg, ... ;
		{
			let j = i + 1;
			let values = 0;
			let lastComma: Token | undefined;
			let terminated = false;
			for (;;) {
				const t = code[j];
				if (!t) {
					missingSemi(code[j - 1]);
					break;
				}
				if (t.text === ";") {
					if (lastComma) issue("Trailing ',' before ';'", lastComma);
					terminated = true;
					break;
				}
				if (t.text === ",") {
					if (!values || lastComma) issue(values ? "Unexpected ',': expected a value between the commas" : "Unexpected ',': expected a value first", t);
					lastComma = t;
					j++;
					continue;
				}
				if (recoveryBoundary(j)) {
					if (lastComma) issue("Expected a value after ','", lastComma);
					else missingSemi(code[j - 1]);
					break;
				}
				if (isValueStart(t)) {
					if (values && !lastComma) {
						// two values side by side: a forgotten ',' (same line / continued list) or ';' (next statement)
						if (startsNewLine(j) && (column(t) <= column(first) || isCommandWord(t))) {
							missingSemi(code[j - 1]);
							break;
						}
						issue(`Missing ',' after '${code[j - 1].text}'`, code[j - 1]);
					}
					j = readValue(j, first);
					values++;
					lastComma = undefined;
					continue;
				}
				if (t.kind !== "invalid") issue(notAValue(t, code[j + 1]), t);
				j += (t.text === "-" || t.text === "+") && code[j + 1]?.kind === "number" ? 2 : 1;
				if (values) values++; // the skipped value still counts, so a following ',' is not reported as stray
				lastComma = undefined;
			}
			const end = Math.min(j, code.length);
			record("call", start, end, code[end]?.span.start ?? text.length);
			i = terminated ? j + 1 : Math.max(j, start + 1);
		}
	}

	// Names that may repeat only within their own parent: struct fields, enum members, a function's locals/parameters.
	const seen = new Set<string>();
	for (const s of declarations) {
		if (!["field", "enumMember", "variable", "parameter", "enum"].includes(s.kind)) continue;
		const key = `${s.kind === "enum" ? "enums" : s.parentId}:${s.name}`;
		if (seen.has(key)) {
			if (s.kind === "variable" || s.kind === "parameter") issues.push({ message: `Redefined variable '${s.name}'`, span: s.nameSpan, severity: "error" });
			else issues.push({ message: `Duplicate ${s.kind === "enum" ? "enumeration" : s.kind === "field" ? "field" : "enumeration entry"} '${s.name}'`, span: s.nameSpan, severity: "warning" });
		}
		seen.add(key);
	}

	const references = tokens.filter((t) => t.kind === "identifier" && !declared.has(t.span.start) && !syntax.has(t.span.start));
	return { uri, text, version, tokens, declarations, references, includes, issues, statements };
}
