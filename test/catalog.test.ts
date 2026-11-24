import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getBuiltin, listBuiltins } from "../src/catalog/builtins";
import { getEvaluatorBuiltin, listEvaluatorBuiltins } from "../src/catalog/evaluator";
import type { RawBuiltin, RawEvaluatorFunction } from "../src/types";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../src/catalog/${file}`, import.meta.url), "utf8"));
const rawBuiltins: RawBuiltin[] = read("builtins.json");
const rawEvaluator: RawEvaluatorFunction[] = read("evaluator.json");

// These guard the hand-edited JSON: a typo such as "varadic" would otherwise just be ignored.
describe("builtins.json", () => {
	it("has unique, well-formed entries", () => {
		const seen = new Set<string>();
		for (const b of rawBuiltins) {
			assert.match(b.name, /^[a-z][a-z0-9-]*$/, `bad name ${b.name}`);
			assert.ok(!seen.has(b.name), `duplicate ${b.name}`);
			seen.add(b.name);
			assert.ok(Number.isInteger(b.args) && b.args >= 0 && b.args <= b.params.length, `${b.name}: args ${b.args} does not fit ${b.params.length} params`);
			assert.ok(typeof b.docs === "string" && b.docs.length > 0, `${b.name}: empty docs`);
			assert.deepEqual(Object.keys(b).filter((k) => !["name", "args", "params", "docs", "code", "strategy"].includes(k)), [], `${b.name}: unknown field`);
			if (b.code !== undefined) assert.ok(b.code === b.name || b.code.startsWith(b.name + " "), `${b.name}: code must start with the name`);
			if (b.strategy !== undefined) assert.ok(["sum", "jmptable", "call", "func-call", "catch", "valtable", "make"].includes(b.strategy), `${b.name}: unknown strategy ${b.strategy}`);
		}
	});

	it("only uses known roles and flags", () => {
		for (const b of rawBuiltins) {
			for (const p of b.params) {
				assert.ok(p.length === 2 || p.length === 3, `${b.name}: parameter ${JSON.stringify(p)} must be [name, role] or [name, role, flag]`);
				assert.ok(typeof p[0] === "string" && p[0].length > 0, `${b.name}: empty parameter name`);
				assert.ok(["input", "output", "inout"].includes(p[1]), `${b.name}.${p[0]}: unknown role '${p[1]}'`);
				if (p.length === 3) assert.ok(["variadic", "optional"].includes(p[2]!), `${b.name}.${p[0]}: unknown flag '${p[2]}'`);
			}
		}
	});

	it("keeps optional parameters last", () => {
		for (const b of rawBuiltins) {
			const first = b.params.findIndex((p) => p[2] === "optional");
			if (first >= 0) assert.ok(b.params.slice(first).every((p) => p[2] === "optional"), `${b.name}: optional parameters must come last`);
		}
	});
});

describe("evaluator.json", () => {
	it("has unique entries with plain parameter names", () => {
		const seen = new Set<string>();
		for (const e of rawEvaluator) {
			assert.ok(!seen.has(e.name), `duplicate ${e.name}`);
			seen.add(e.name);
			assert.ok(e.params.every((p) => typeof p === "string" && p.length > 0), `${e.name}: parameters must be plain names`);
			assert.ok(e.docs.length > 0, `${e.name}: empty docs`);
			assert.deepEqual(Object.keys(e).filter((k) => !["name", "params", "docs"].includes(k)), [], `${e.name}: unknown field`);
		}
	});
});

describe("catalog loader", () => {
	it("loads every raw entry", () => {
		assert.equal(listBuiltins().length, rawBuiltins.length);
		assert.equal(listEvaluatorBuiltins().length, rawEvaluator.length);
	});

	it("derives flags, arity and the signature of built-ins", () => {
		const s = getBuiltin("string-new")!;
		assert.equal(s.minimumArity, 1);
		assert.equal(s.variadic, true);
		assert.deepEqual(s.parameters.map((p) => [p.name, p.role, p.variadic, p.optional]), [["DESTINATION", "output", false, false], ["ARGS", "input", true, false]]);
		assert.equal(s.signature, "string-new DESTINATION, ARGS...");
		assert.equal(getBuiltin("string-size")!.signature, "string-size STRING, DESTINATION");
		assert.equal(getBuiltin("string-size")!.variadic, false);
	});

	it("marks optional parameters with ?", () => {
		const j = getBuiltin("jmptable")!;
		assert.equal(j.parameters.at(-1)!.optional, true);
		assert.equal(j.parameters.at(-1)!.variadic, false);
	});

	it("keeps an explicit code override and the strategy", () => {
		const sum = getBuiltin("sum")!;
		assert.equal(sum.signature, "sum N1, N2, ..., RESULT");
		assert.equal(sum.strategy, "sum");
		assert.equal(getBuiltin("string-new")!.strategy, undefined);
	});

	it("builds evaluator signatures from the name and parameters", () => {
		assert.equal(getEvaluatorBuiltin("clamp")!.signature, "clamp(X, LO, HI)");
		assert.equal(getEvaluatorBuiltin("pi")!.signature, "pi()");
		const log = getEvaluatorBuiltin("log")!;
		assert.equal(log.minimumArity, 2);
		assert.equal(log.variadic, false);
		assert.deepEqual(log.parameters.map((p) => p.name), ["N", "B"]);
	});

	it("returns the same objects on every lookup", () => {
		assert.equal(getBuiltin("add"), getBuiltin("add"));
		assert.equal(getEvaluatorBuiltin("sin"), getEvaluatorBuiltin("sin"));
	});
});
