// Shared data model. Offsets are UTF-16 code unit offsets into the document text.

export interface Span {
	start: number;
	end: number;
}

export type TokenKind = "newline" | "comment" | "string" | "character" | "identifier" | "number" | "punctuation" | "operator" | "invalid";

export interface Token {
	kind: TokenKind;
	text: string;
	span: Span;
	/** string/character literals only: false when the closing quote is missing */
	terminated?: boolean;
}

export type SymbolKind = "function" | "struct" | "field" | "label" | "constant" | "global" | "enum" | "enumMember" | "variable" | "parameter";

export interface ParameterInfo {
	name: string;
	variadic: boolean;
	optional?: boolean;
	role?: "input" | "output" | "inout";
	description?: string;
}

export interface PilSymbol {
	id: string;
	name: string;
	kind: SymbolKind;
	uri: string;
	nameSpan: Span;
	span: Span;
	parameters: ParameterInfo[];
	parentId?: string;
	documentation?: string;
	/** const/global/enum member value as written in the source */
	value?: string;
	/** array enumerations expose their members without the `Enum.` prefix */
	unqualified?: boolean;
	/** const/global only: the tokens of the initializer expression */
	initializer?: Token[];
}

export type StatementKind = "include" | "struct" | "enum" | "function" | "label" | "local" | "const" | "global" | "call";

export interface Statement {
	kind: StatementKind;
	tokens: Token[];
	span: Span;
}

export type Severity = "error" | "warning";

export interface Issue {
	message: string;
	span: Span;
	/** defaults to "error": PIL's own parser rejects the code */
	severity?: Severity;
}

export interface IncludeRef {
	path: string;
	span: Span;
}

export interface ParsedDocument {
	uri: string;
	text: string;
	version: number;
	tokens: Token[];
	declarations: PilSymbol[];
	references: Token[];
	includes: IncludeRef[];
	issues: Issue[];
	statements: Statement[];
}

export interface ProjectIssue extends Issue {
	uri: string;
}

export interface Project {
	entryUri: string;
	documents: Map<string, ParsedDocument>;
	symbols: PilSymbol[];
	order: Map<string, number>;
	issues: ProjectIssue[];
	includeTargets: Map<string, string>;
}

export type ParameterRole = "input" | "output" | "inout";
export type BuiltinStrategy = "sum" | "jmptable" | "call" | "func-call" | "catch" | "valtable" | "make";

export interface RawBuiltin {
	name: string;
	args: number;
	params: [name: string, role: ParameterRole, flag?: "variadic" | "optional"][];
	docs: string;
	code?: string;
	strategy?: BuiltinStrategy;
}

export interface RawEvaluatorFunction {
	name: string;
	params: string[];
	docs: string;
}

export interface BuiltinInfo {
	name: string;
	minimumArity: number;
	variadic: boolean;
	parameters: ParameterInfo[];
	documentation: string;
	signature: string;
	strategy?: BuiltinStrategy;
}
