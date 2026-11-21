import type { Token, TokenKind } from "../types";

const isNewline = (c: string | undefined) => c === "\n" || c === "\r";

/**
 * Mirrors PIL's own lexer (source/lexer.cpp): `#` comments, quoted strings and characters with `\` escapes,
 * identifiers made of letters, digits, `_` and `-`, numbers made of digits and dots, and a fixed operator set.
 * Anything else becomes an `invalid` token, which the parser reports the way the interpreter does
 * ("Unexpected character"). That includes the removed `@directive` and `$register` syntax.
 */
export function lex(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const push = (kind: TokenKind, start: number, terminated?: boolean) => {
		const token: Token = { kind, text: text.slice(start, i), span: { start, end: i } };
		if (terminated !== undefined) token.terminated = terminated;
		tokens.push(token);
	};

	while (i < text.length) {
		const start = i;
		const ch = text[i];
		if (isNewline(ch)) {
			i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
			push("newline", start);
		} else if (/\s/.test(ch)) {
			i++;
		} else if (ch === "#") {
			while (i < text.length && !isNewline(text[i])) i++;
			push("comment", start);
		} else if (ch === '"' || ch === "'") {
			i++;
			let closed = false;
			while (i < text.length && !isNewline(text[i])) {
				if (text[i] === "\\") {
					i += text[i + 1] && !isNewline(text[i + 1]) ? 2 : 1;
					continue;
				}
				if (text[i++] === ch) {
					closed = true;
					break;
				}
			}
			push(ch === '"' ? "string" : "character", start, closed);
		} else if (/[A-Za-z_]/.test(ch)) {
			i++;
			while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
			push("identifier", start);
		} else if (/[0-9]/.test(ch)) {
			i++;
			while (i < text.length && /[0-9.]/.test(text[i])) i++;
			push("number", start);
		} else if (/[()[\],.:;]/.test(ch)) {
			i++;
			push("punctuation", start);
		} else if (/^(?:\*\*|&&|\|\||!=|==|<=|>=|<<|>>)/.test(text.slice(i, i + 2))) {
			i += 2;
			push("operator", start);
		} else if (/[+\-*/%^~&|=!<>]/.test(ch)) {
			i++;
			push("operator", start);
		} else {
			i++;
			push("invalid", start);
		}
	}
	return tokens;
}
