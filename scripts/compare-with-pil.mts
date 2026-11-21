// Compares the extension's diagnostics with the real PIL interpreter.
//
//   npm run compare-with-pil -- /path/to/built/pil /path/to/PIL-checkout
//
// Build the interpreter first (for example: g++ -std=c++20 -O1 -w -Iinclude source/*.cpp -o pil).
// Two passes, both using `pil compile` as the oracle and counting only error-severity diagnostics:
//   1. a table of small programs covering const/global/enum/struct rules, the [ ] evaluator, arity, calls and syntax;
//   2. mutated copies of <checkout>/examples/*.pil (deleted/doubled/stray ; and ,, removed brackets, renamed names...).
// Exit code 1 when the extension reports an error that the interpreter accepts (a false positive).
// Misses are listed too, except the ones that are deliberate: a missing `main` is only a warning here because
// library files have none.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { lex } from "../src/language/lexer";
import { ProjectIndex } from "../src/project/index";

const [pilArg, repoArg] = process.argv.slice(2);
if (!pilArg || !repoArg) {
	console.error("usage: compare-with-pil <path to built pil binary> <path to PIL checkout>");
	process.exit(2);
}
const PIL = resolve(pilArg);
const REPO = resolve(repoArg);
const MUTANTS_PER_SEED = Number(process.env.N ?? 100);

// Cases where the extension is deliberately stricter than the interpreter (the interpreter has undefined behaviour there).
const STRICTER = new Set(["struct as command", "const as command"]);
// Cases the extension only warns about.
const WARN_ONLY = new Set(["no main"]);

const MAIN = "main()\n   println 1;\n";
const cases: [string, string][] = [
	// ---- const / global
	["const chain ok", "const a = 1, b = a;\n" + MAIN],
	["const forward ref", "const b = a, a = 1;\n" + MAIN],
	["const trailing comma", "const a = 1,;\n" + MAIN],
	["global trailing comma", "global g = 1,;\n" + MAIN],
	["global no value", "global g;\n" + MAIN],
	["global mixed", "global g = 1, h;\n" + MAIN],
	["const no value", "const a;\n" + MAIN],
	["const negative literal", "const a = -1;\n" + MAIN],
	["const evaluator negative", "const a = [-1];\n" + MAIN],
	["const string+char", "const a = \"s\", b = 'c';\n" + MAIN],
	["const function value", "const a = main;\n" + MAIN],
	["const unknown", "const a = nope;\n" + MAIN],
	["const self", "const a = a;\n" + MAIN],
	["const of global", "global g = 1;\nconst c = g;\n" + MAIN],
	["const redefined", "const a = 1;\nconst a = 2;\n" + MAIN],
	["const same as function", "const main = 1;\nmain()\n   println 1;\n"],
	["const builtin name", "const size = 1;\n" + MAIN],
	["const missing semicolon", "const a = 1\n" + MAIN],
	["const missing comma", "const a = 1 b = 2;\n" + MAIN],
	["const field access", "const a = 1;\nmain()\n   println a.x;\n"],
	["global field access", "global g;\nmain()\n   println g.x;\n"],
	["const after function use ok (order)", "main()\n   println a;\nconst a = 1;\n"],
	["global used before decl", "main()\n   set 1, g;\nglobal g;\n"],
	["const in function body", "main()\n   const a = 1;\n   println a;\n"],
	["local same as earlier const", "const a = 1;\nmain()\n   local a;\n"],
	["local same as later const", "main()\n   local a;\nconst a = 1;\n"],
	["param same as function", "f(main)\n   return;\nmain()\n   println 1;\n"],
	["const with local name used in value", "main()\n   local x;\n   const c = x;\n"],
	// ---- enum
	["enum ok", "enum E (A, B = 5, C,)\nmain()\n   println E.A, E.C;\n"],
	["enum empty", "enum E ()\n" + MAIN],
	["enum string value", "enum E (A = \"x\")\n" + MAIN],
	["enum evaluator value", "enum E (A = [1 << 2], B)\n" + MAIN],
	["enum missing comma", "enum E (A B)\n" + MAIN],
	["enum entry missing", "enum E (A)\nmain()\n   println E.B;\n"],
	["enum name alone", "enum E (A)\nmain()\n   println E;\n"],
	["enum use before decl", "main()\n   println E.A;\nenum E (A)\n"],
	["enum array bare entry", "enum array E (x = 2, y)\nmain()\n   println x, y, E.x;\n"],
	["enum array dup of const", "const x = 1;\nenum array E (x)\n" + MAIN],
	["enum value uses const", "const k = 3;\nenum E (A = k, B)\n" + MAIN],
	["enum value uses later const", "enum E (A = k)\nconst k = 3;\n" + MAIN],
	["enum value uses other enum", "enum F (X = 4)\nenum E (A = F.X)\n" + MAIN],
	["enum value function", "enum E (A = main)\n" + MAIN],
	["enum in evaluator", "enum E (A = 1)\nconst c = [E.A];\n" + MAIN],
	["array enum in evaluator", "enum array E (a = 1)\nconst c = [a + 1];\n" + MAIN],
	["enum dup entry", "enum E (A, A)\n" + MAIN],
	["enum dup name", "enum E (A)\nenum E (B)\n" + MAIN],
	// ---- struct
	["struct ok", "struct S (a, b)\nmain()\n   local s;\n   make S, s, 1, 2;\n   println s.a;\n   free s;\n"],
	["struct empty", "struct S ()\n" + MAIN],
	["struct missing comma", "struct S (a b)\n" + MAIN],
	["struct array", "struct array S (a, b,)\n" + MAIN],
	["struct unterminated", "struct S (a, b\n" + MAIN],
	["struct same as function", "struct main (a)\nmain()\n   println 1;\n"],
	// ---- evaluator
	["eval add missing operand", "const c = [1 +];\n" + MAIN],
	["eval sin ok", "const c = [sin(1)];\n" + MAIN],
	["eval sin no args", "const c = [sin()];\n" + MAIN],
	["eval pi bare", "const c = [pi];\n" + MAIN],
	["eval pi()", "const c = [pi()];\n" + MAIN],
	["eval unknown fn", "const c = [foo(1)];\n" + MAIN],
	["eval unclosed paren", "const c = [1 + (2];\n" + MAIN],
	["eval unknown const", "const c = [x];\n" + MAIN],
	["eval const", "const k = 2;\nconst c = [k * 3];\n" + MAIN],
	["eval const string", "const k = \"s\";\nconst c = [k];\n" + MAIN],
	["eval global", "global g = 1;\nconst c = [g];\n" + MAIN],
	["eval string", "const c = [\"s\"];\n" + MAIN],
	["eval char", "const c = ['a'];\n" + MAIN],
	["eval negative", "const c = [-1];\n" + MAIN],
	["eval double unary", "const c = [- -1];\n" + MAIN],
	["eval two values", "const c = [1 2];\n" + MAIN],
	["eval empty", "const c = [];\n" + MAIN],
	["eval trailing comma arg", "const c = [min(1, 2,)];\n" + MAIN],
	["eval trailing comma top", "const c = [1,];\n" + MAIN],
	["eval hyphen ident", "const a = 1;\nconst c = [a-1];\n" + MAIN],
	["eval all ops", "const c = [(1 + 2) * 3 / 4 % 5 ** 2 << 1 >> 1 & 3 | 4 ^ 5 && 1 || 0 == 1 != 2 < 3 > 4 <= 5 >= 6];\n" + MAIN],
	["eval function arity 3", "const c = [clamp(1, 2)];\n" + MAIN],
	["eval hypot3", "const c = [hypot3(1, 2, 3)];\n" + MAIN],
	["eval in call arg", "main()\n   println [1 + 2], [pi()];\n"],
	["eval bad in call arg", "main()\n   println [1 + ];\n"],
	["eval local", "main()\n   local x;\n   println [x + 1];\n"],
	["eval unterminated", "main()\n   println [1 + 2;\n"],
	// ---- statements / arity / call
	["unknown command", "main()\n   nope 1;\n"],
	["unknown arg", "main()\n   println nope;\n"],
	["user fn arity", "f(a, b)\n   return;\nmain()\n   f 1;\n"],
	["user fn ok", "f(a, b)\n   return;\nmain()\n   f 1, 2;\n"],
	["builtin arity", "main()\n   add 1, 2;\n"],
	["variadic ok", "main()\n   println 1, 2, 3, 4;\n"],
	["variadic too few", "main()\n   println;\n"],
	["call ok", "f(a)\n   return a;\nmain()\n   local r;\n   call r, f, 1;\n"],
	["call callee arity", "f(a)\n   return a;\nmain()\n   local r;\n   call r, f;\n"],
	["call no function", "main()\n   local r;\n   call r, 1;\n"],
	["call two functions", "f(a)\n   return a;\nmain()\n   local r;\n   call r, f, main;\n"],
	["call builtin callee", "main()\n   local r;\n   call r, add, 1, 2;\n"],
	["call builtin callee arity", "main()\n   local r;\n   call r, add, 1;\n"],
	["func-call fn arg", "f(a)\n   return a;\nmain()\n   local r;\n   func-call f, f, 1;\n"],
	["label as command", "main()\n   x;\nx:\n   return;\n"],
	["struct as command", "struct S (a)\nmain()\n   S 1;\n"],
	["const as command", "const a = 1;\nmain()\n   a;\n"],
	["label dup", "main()\nx:\n   return;\nx:\n   return;\n"],
	["label same as function", "main()\n   println 1;\nmain:\n   return;\n"],
	["function dup", "f()\n   return;\nf()\n   return;\nmain()\n   println 1;\n"],
	["function builtin name", "set()\n   return;\nmain()\n   println 1;\n"],
	["local builtin name", "main()\n   local time;\n"],
	["param builtin name", "f(size)\n   return;\nmain()\n   println 1;\n"],
	["local dup", "main()\n   local a, a;\n"],
	["local = value", "main()\n   local a = 1;\n"],
	["local outside function", "local a;\nmain()\n   println 1;\n"],
	["local used before decl", "main()\n   println a;\n   local a;\n"],
	["local of other function", "f()\n   local a;\n   return;\nmain()\n   println a;\n"],
	["field on local", "main()\n   local v;\n   println v.x.y;\n"],
	["field on function", "main()\n   println main.x;\n"],
	["dot without field", "main()\n   local v;\n   println v.;\n"],
	["goto label other function", "f()\nx:\n   return;\nmain()\n   goto x;\n"],
	["main with params", "main(a)\n   return;\n"],
	["no main", "f()\n   return;\n"],
	["code before function", "println 1;\nmain()\n   println 1;\n"],
	["stray semicolon", "main()\n   println 1;;\n"],
	["include semicolon", "include \"x.pil\";\n" + MAIN],
	["include no string", "include x\n" + MAIN],
	["include missing file", "include \"nope.pil\"\n" + MAIN],
	["char two", "main()\n   println 'ab';\n"],
	["char escape", "main()\n   println '\\n', \"a\\qb\";\n"],
	["number two dots", "main()\n   println 1.2.3;\n"],
	["unexpected char", "main()\n   println 1 ? 2;\n"],
	["op in args", "main()\n   println 1 + 2;\n"],
	["parens in args", "main()\n   println (1);\n"],
	["trailing comma call", "main()\n   println 1,;\n"],
	["leading comma call", "main()\n   println ,1;\n"],
	["empty statement args", "main()\n   println 1,,2;\n"],
	["function trailing comma params", "f(a, b,)\n   return;\nmain()\n   f 1, 2;\n"],
	["function leading comma params", "f(,a)\n   return;\nmain()\n   f 1;\n"],
	["function missing comma params", "f(a b)\n   return;\nmain()\n   f 1;\n"],
	["function unterminated params", "f(a, b\n   return;\nmain()\n   println 1;\n"],
	["comment after stmt", "main()\n   println 1; # hello\n"],
	["tab/CRLF", "main()\r\n\tprintln 1;\r\n"],
];


interface Verdict { ok: boolean; out: string; lines: number[] }
function runPil(dir: string, main: string): Verdict {
	const r = spawnSync(PIL, ["--allow-fileio", "--allow-env", "--allow-exec", "compile", main, "out.pilo"], { cwd: dir, encoding: "utf8", timeout: 10000 });
	const raw = ((r.stdout ?? "") + (r.stderr ?? "")).replace(/\x1b\[[0-9;]*m/g, "");
	return {
		ok: r.status === 0,
		out: raw.split("\n").filter((l) => /^(Error|Warning)/.test(l)).join(" | "),
		lines: [...raw.matchAll(/main\.pil:(\d+)/g)].map((m) => Number(m[1])),
	};
}

async function runExtension(files: Record<string, string>, main: string) {
	const index = new ProjectIndex(
		async (uri) => {
			const t = files[uri.replace("file:///", "")];
			if (t === undefined) throw new Error("not found");
			return t;
		},
		(_e, p) => "file:///" + p,
	);
	const project = await index.snapshot("file:///" + main);
	const errors = project.issues.filter((i) => i.severity !== "warning").map((i) => i.message);
	return { ok: errors.length === 0, errors, issues: project.issues };
}

// ---- pass 1: the table --------------------------------------------------------------------------------------------
let falsePositives = 0;
{
	let agree = 0;
	const lines: string[] = [];
	for (const [name, src] of cases) {
		const dir = mkdtempSync(join(tmpdir(), "pilcase-"));
		const files = { "main.pil": src, "x.pil": "xfn()\n   return;\n" };
		for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
		const o = runPil(dir, "main.pil");
		const e = await runExtension(files, "main.pil");
		if (o.ok === e.ok) agree++;
		else if (o.ok && !STRICTER.has(name)) {
			falsePositives++;
			lines.push(`FALSE POSITIVE  ${name}\n    interpreter: ok\n    extension:   ${e.errors.join(" | ")}`);
		} else if (o.ok) lines.push(`stricter (intended)  ${name}: ${e.errors.join(" | ")}`);
		else if (!WARN_ONLY.has(name)) lines.push(`MISSED          ${name}\n    interpreter: ${o.out}`);
	}
	console.log(`table: ${cases.length} programs, ${agree} agree\n${lines.join("\n")}\n`);
}

// ---- pass 2: mutated examples -------------------------------------------------------------------------------------
let seedState = 12345;
const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const walk = (dir: string, rel = ""): string[] => readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? walk(dir, join(rel, n)) : [join(rel, n)]));

interface Seed { name: string; dir: string; main: string; files: Record<string, string> }
const seeds: Seed[] = [];
const examples = join(REPO, "examples");
for (const f of readdirSync(examples)) {
	const p = join(examples, f);
	if (f.endsWith(".pil")) seeds.push({ name: f, dir: examples, main: f, files: { [f]: readFileSync(p, "utf8") } });
	else if (statSync(p).isDirectory() && walk(p).includes("main.pil")) {
		const files: Record<string, string> = {};
		for (const rel of walk(p)) if (rel.endsWith(".pil")) files[rel] = readFileSync(join(p, rel), "utf8");
		seeds.push({ name: `${f}/main.pil`, dir: p, main: "main.pil", files });
	}
}

type Mutation = { name: string; apply: () => string | undefined };
function mutations(text: string): Mutation[] {
	const code = lex(text).filter((t) => t.kind !== "comment" && t.kind !== "newline");
	const cut = (a: number, b: number) => text.slice(0, a) + text.slice(b);
	const insertAt = (at: number, s: string) => text.slice(0, at) + s + text.slice(at);
	const withText = (s: string) => code.filter((t) => t.text === s);
	const idents = code.filter((t) => t.kind === "identifier");
	const list: Mutation[] = [];
	const add = (name: string, apply: () => string | undefined) => list.push({ name, apply });
	for (const s of [";", ",", ")", "(", "]", "["]) add(`delete '${s}'`, () => { const t = pick(withText(s)); return t && cut(t.span.start, t.span.end); });
	add("stray ';'", () => insertAt(pick(code).span.end, ";"));
	add("stray ','", () => insertAt(pick(code).span.end, ","));
	add("double ','", () => { const t = pick(withText(",")); return t && insertAt(t.span.end, ","); });
	add("trailing ',' before ';'", () => { const t = pick(withText(";")); return t && insertAt(t.span.start, ","); });
	add("delete identifier", () => { const t = pick(idents); return cut(t.span.start, t.span.end); });
	add("rename identifier", () => { const t = pick(idents); return text.slice(0, t.span.start) + "zzz" + text.slice(t.span.end); });
	add("swap adjacent tokens", () => { const i = Math.floor(rnd() * (code.length - 1)); const a = code[i], b = code[i + 1]; return text.slice(0, a.span.start) + b.text + text.slice(a.span.end, b.span.start) + a.text + text.slice(b.span.end); });
	add("local named like a built-in", () => { const t = pick(code.filter((c, i) => c.text === "local" && code[i + 1]?.kind === "identifier")); if (!t) return; const n = code[code.indexOf(t) + 1]; return text.slice(0, n.span.start) + pick(["size", "time", "at", "set", "date", "error"]) + text.slice(n.span.end); });
	add("negative literal", () => { const t = pick(code.filter((c) => c.kind === "number")); return t && insertAt(t.span.start, "-"); });
	add("prefix @", () => insertAt(pick(idents).span.start, "@"));
	add("prefix $", () => insertAt(pick(idents).span.start, "$"));
	add("duplicate a line", () => { const ls = text.split("\n"); const i = Math.floor(rnd() * ls.length); ls.splice(i, 0, ls[i]); return ls.join("\n"); });
	add("delete a line", () => { const ls = text.split("\n"); ls.splice(Math.floor(rnd() * ls.length), 1); return ls.join("\n"); });
	add("unterminated string", () => { const t = pick(code.filter((c) => c.kind === "string")); return t && cut(t.span.end - 1, t.span.end); });
	return list;
}

const stats = { total: 0, agree: 0, missed: 0, falsePositive: 0 };
const problems: string[] = [];
for (const seed of seeds) {
	const run = async (text: string) => {
		const work = mkdtempSync(join(tmpdir(), "pildiff-"));
		cpSync(seed.dir, work, { recursive: true });
		for (const [f, t] of Object.entries(seed.files)) { mkdirSync(dirname(join(work, f)), { recursive: true }); writeFileSync(join(work, f), f === seed.main ? text : t); }
		return { o: runPil(work, seed.main), e: await runExtension({ ...seed.files, [seed.main]: text }, seed.main) };
	};
	const original = seed.files[seed.main];
	const base = await run(original);
	if (!base.o.ok) { console.log(`skipping ${seed.name}: the interpreter itself rejects it (${base.o.out})`); continue; }
	if (!base.e.ok) { falsePositives++; problems.push(`FALSE POSITIVE on unmodified ${seed.name}: ${base.e.errors[0]}`); }
	const ms = mutations(original);
	for (let k = 0; k < MUTANTS_PER_SEED; k++) {
		const m = pick(ms);
		const mutated = m.apply();
		if (mutated === undefined || mutated === original) continue;
		const { o, e } = await run(mutated);
		stats.total++;
		if (o.ok === e.ok) stats.agree++;
		else if (o.ok) { stats.falsePositive++; falsePositives++; problems.push(`FALSE POSITIVE ${seed.name} [${m.name}]: ${e.errors[0]}`); }
		else if (!/'main' is not defined/.test(o.out)) { stats.missed++; problems.push(`missed ${seed.name} [${m.name}]: ${o.out}`); }
		else stats.agree++;
	}
}
console.log(`mutations: ${JSON.stringify(stats)}`);
console.log(problems.slice(0, 40).join("\n"));
process.exit(falsePositives ? 1 : 0);
