#!/usr/bin/env node
// Regenerates the language data from the PIL interpreter and its documentation:
//
//   src/catalog/builtins.json     built-in inventory (names, minimum arity, variadic flag) + docs text
//   src/catalog/upstream.json     the interpreter/docs commits the data was generated from
//   syntaxes/pil.tmLanguage.json  the built-in name alternation in the grammar (rest of the grammar is hand-written)
//
// Usage:
//   node scripts/import-upstream.mjs --pil ../PIL --docs ../pil-esolang.github.io [--check]
//
// --check writes nothing and exits 1 when the generated data would differ (use it to see what changed upstream).
//
// Parameter metadata (roles, optional flags, special call strategies) is NOT derivable from the docs reliably, so
// existing entries keep theirs. Brand-new built-ins get parameters guessed from their documented signature; the script
// lists those so they can be reviewed by hand in src/catalog/builtins.json.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const pilDir = resolve(option("--pil", join(root, "..", "PIL")));
const docsDir = resolve(option("--docs", join(root, "..", "pil-esolang.github.io")));
const check = flag("--check");

const SITE = "https://pil-esolang.github.io";
const PAGES = ["strings", "arrays", "maps", "math", "fileos", "builtins"];
// Built-ins that were renamed upstream; the old entry's parameter metadata carries over.
const RENAMES = { "is-var": "is-reg", "return-at": "return-reg-at" };

// ---- interpreter: include/builtin.hpp ------------------------------------------------------------------------
const header = readFileSync(join(pilDir, "include", "builtin.hpp"), "utf8");
const table = header.slice(header.indexOf("BUILTIN_DEFINITIONS[]"));
const defs = [...table.matchAll(/\{"([^"]+)",\s*(\w+),\s*(\d+)(?:,\s*([A-Z_| ]+))?\}/g)].map((m) => ({
	name: m[1],
	implementation: m[2],
	minimumArity: Number(m[3]),
	flags: (m[4] ?? "").split("|").map((f) => f.trim()),
}));
if (defs.length < 100) throw new Error(`Only found ${defs.length} built-ins in builtin.hpp; the table format probably changed.`);

// ---- documentation: docs/built-ins/*.md ----------------------------------------------------------------------
function absolutize(text, page) {
	return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
		if (/^https?:/.test(target)) return whole;
		const [path, hash] = target.split("#");
		let dir = "built-ins";
		let name = page;
		if (path) {
			const parts = path.replace(/\.md$/, "").split("/");
			name = parts.pop();
			const up = parts.filter((p) => p === "..").length;
			const rest = parts.filter((p) => p !== "." && p !== "..");
			dir = up ? rest.join("/") : ["built-ins", ...rest].join("/");
		}
		return `](${SITE}/${dir}/${name}/${hash ? "#" + hash : ""})`;
	});
}

const docs = new Map();
for (const page of PAGES) {
	const text = readFileSync(join(docsDir, "docs", "built-ins", `${page}.md`), "utf8").replace(/\r/g, "");
	// builtins.md groups entries under `##` and uses `###` per entry; the other pages use `##` per entry
	for (const section of text.split(page === "builtins" ? /^### /m : /^## /m).slice(1)) {
		const nl = section.indexOf("\n");
		const name = section.slice(0, nl).trim();
		const body = section.slice(nl + 1);
		const fence = body.indexOf("```");
		if (fence < 0) continue;
		const end = body.indexOf("```", fence + 3);
		docs.set(name, {
			page,
			description: absolutize(body.slice(0, fence).trim(), page),
			signature: body.slice(fence, end).replace(/^```\w*\n/, "").trim(),
		});
	}
}

// ---- merge with the existing catalog -------------------------------------------------------------------------
const catalogPath = join(root, "src", "catalog", "builtins.json");
const existing = JSON.parse(readFileSync(catalogPath, "utf8"));
const existingByName = new Map(existing.map((b) => [b.name, b]));

function guessParameters(signature, description) {
	const names = signature
		.replace(/^\S+\s*/, "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const out = [];
	for (const raw of names) {
		if (raw === "...") {
			if (out.length) out.at(-1).variadic = true;
			continue;
		}
		const variadic = raw.endsWith("...");
		const name = raw.replace(/\.\.\.$/, "").replace(/\?$/, "");
		const container = new RegExp("`" + name + "(?:\\.\\.\\.)?` - (?:containers?)\\b").test(description);
		out.push({ name, variadic, optional: raw.endsWith("?"), role: container ? "output" : "input", description: `${name} (${container ? "output" : "input"})` });
	}
	return out;
}

const added = [];
const docTypos = [];
const removed = existing.filter((b) => !defs.some((d) => d.name === b.name) && !Object.values(RENAMES).includes(b.name)).map((b) => b.name);
const missingDocs = [];
const catalog = defs.map((def) => {
	const doc = docs.get(def.name);
	const previous = existingByName.get(def.name) ?? existingByName.get(RENAMES[def.name]);
	if (!doc) missingDocs.push(def.name);
	if (!previous) added.push(def.name);
	const source = doc ? `${SITE}/built-ins/${doc.page}/#${def.name}` : previous?.source;
	let signature = doc?.signature ?? previous?.signature ?? def.name;
	if (signature.split(/\s/)[0] !== def.name) {
		// the docs occasionally show a different command name in a signature (e.g. hypot3 documented as `hypot ...`)
		docTypos.push(`${def.name} (docs show '${signature.split(/\s/)[0]}')`);
		signature = def.name + signature.slice(signature.split(/\s/)[0].length);
	}
	const entry = {
		name: def.name,
		implementation: def.implementation,
		minimumArity: def.minimumArity,
		variadic: def.flags.includes("VARIADIC"),
		parameters: previous?.parameters ?? guessParameters(signature, doc?.description ?? ""),
		documentation: doc ? `${doc.description}\n\n[Documentation](${source})` : (previous?.documentation ?? ""),
		source,
		signature,
	};
	if (previous?.strategy) entry.strategy = previous.strategy;
	return entry;
});

// ---- constant evaluator: verify only -------------------------------------------------------------------------
const evaluatorPath = join(root, "src", "catalog", "evaluator.json");
const evaluator = JSON.parse(readFileSync(evaluatorPath, "utf8"));
const mee = readFileSync(join(pilDir, "source", "mee.cpp"), "utf8");
// each MEEFuncMap entry sits on one line: {"name", {.f2=..., .args=2, ...}},
const meeFunctions = [...mee.matchAll(/^\s*\{"(\w+)",\s*\{\.f\d=.*\.args=(\d)/gm)].map((m) => ({ name: m[1], args: Number(m[2]) }));
const evaluatorProblems = [];
for (const f of meeFunctions) {
	const known = evaluator.find((e) => e.name === f.name);
	if (!known) evaluatorProblems.push(`constant evaluator function '${f.name}' (${f.args} args) is missing from src/catalog/evaluator.json`);
	else if (known.minimumArity !== f.args) evaluatorProblems.push(`'${f.name}' takes ${f.args} args upstream but ${known.minimumArity} in evaluator.json`);
}
for (const e of evaluator) if (!meeFunctions.some((f) => f.name === e.name)) evaluatorProblems.push(`'${e.name}' in evaluator.json no longer exists upstream`);

// ---- grammar -------------------------------------------------------------------------------------------------
const grammarPath = join(root, "syntaxes", "pil.tmLanguage.json");
const grammar = JSON.parse(readFileSync(grammarPath, "utf8"));
const alternation = (names) => names.map((n) => n.replace(/-/g, "\\-")).join("|");
const builtinRule = grammar.patterns.find((p) => p.name === "support.function.builtin.pil");
builtinRule.match = `(?<![A-Za-z0-9_-])(?:${alternation(catalog.map((b) => b.name))})(?![A-Za-z0-9_-])`;
const evaluatorRule = grammar.repository.evaluator.patterns.find((p) => p.name === "support.function.builtin.evaluator.pil");
evaluatorRule.match = `\\b(?:${meeFunctions.map((f) => f.name).join("|")})(?![A-Za-z0-9_-])(?=\\s*\\()`;

const git = (dir) => {
	try {
		return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		return "unknown";
	}
};
const upstream = { interpreter: git(pilDir), documentation: git(docsDir) };

// ---- report / write ------------------------------------------------------------------------------------------
const files = [
	[catalogPath, JSON.stringify(catalog, null, 2) + "\n"],
	[grammarPath, JSON.stringify(grammar, null, 2) + "\n"],
	[join(root, "src", "catalog", "upstream.json"), JSON.stringify(upstream, null, 2) + "\n"],
];
const changed = files.filter(([path, content]) => {
	try {
		return readFileSync(path, "utf8") !== content;
	} catch {
		return true;
	}
});

console.log(`interpreter ${upstream.interpreter.slice(0, 7)}, docs ${upstream.documentation.slice(0, 7)}: ${defs.length} built-ins, ${meeFunctions.length} evaluator functions`);
if (removed.length) console.log(`removed upstream: ${removed.join(", ")}`);
if (added.length) console.log(`new (parameters guessed, review them): ${added.join(", ")}`);
if (docTypos.length) console.log(`documentation signature names the wrong command (corrected here, fix it in the docs repo): ${docTypos.join(", ")}`);
if (missingDocs.length) console.log(`no documentation entry found for: ${missingDocs.join(", ")}`);
for (const p of evaluatorProblems) console.log(`evaluator: ${p}`);
console.log(changed.length ? `changed: ${changed.map(([p]) => p.replace(root + "/", "")).join(", ")}` : "everything is up to date");

if (check) process.exit(changed.length || evaluatorProblems.length ? 1 : 0);
for (const [path, content] of changed) writeFileSync(path, content);
if (evaluatorProblems.length) process.exitCode = 1;
