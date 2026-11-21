import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProject } from "./helpers";

// Every expectation here was checked against the real interpreter (`pil compile`); see scripts/compare-with-pil.mts.
const MAIN = "main()\n   println 1;\n";

async function check(source: string, extra: Record<string, string> = {}) {
	const project = await buildProject({ "main.pil": source, ...extra });
	const mine = project.issues.filter((i) => i.uri === "file:///main.pil");
	return {
		errors: mine.filter((i) => i.severity !== "warning").map((i) => i.message),
		warnings: mine.filter((i) => i.severity === "warning").map((i) => i.message),
		project,
		source,
		text: (i: number) => mine[i],
	};
}
const clean = async (source: string) => assert.deepEqual((await check(source)).errors, []);
const fails = async (source: string, pattern: RegExp) => {
	const { errors } = await check(source);
	assert.ok(errors.some((m) => pattern.test(m)), `expected ${pattern}, got ${JSON.stringify(errors)}`);
};

describe("names", () => {
	it("reports unknown commands and variables", async () => {
		await fails("main()\n   nope 1;\n", /No such function 'nope'/);
		await fails("main()\n   println nope;\n", /Variable 'nope' does not exist/);
	});

	it("only sees locals declared earlier in the same function", async () => {
		await clean("main()\n   local a;\n   println a;\n");
		await fails("main()\n   println a;\n   local a;\n", /Variable 'a' does not exist/);
		await fails("f()\n   local a;\n   return;\nmain()\n   println a;\n", /Variable 'a' does not exist/);
	});

	it("needs const/global/array-enum entries to be declared before use, functions and labels anywhere", async () => {
		await clean("const a = 1;\nmain()\n   println a;\n");
		await fails("main()\n   println a;\nconst a = 1;\n", /Variable 'a' does not exist.*declared before/);
		await clean("main()\n   goto x;\nx:\n   return;\n");
		await clean("main()\n   println helper;\nhelper()\n   return;\n");
	});

	it("looks up enumerations as Enum.Entry", async () => {
		await clean("enum E (A, B = 5, C,)\nmain()\n   println E.A, E.C;\n");
		await fails("enum E (A)\nmain()\n   println E.B;\n", /Variable 'E' does not exist.*no entry 'B'/);
		await fails("enum E (A)\nmain()\n   println E;\n", /Variable 'E' does not exist.*E\.ENTRY/);
		await fails("main()\n   println E.A;\nenum E (A)\n", /Variable 'E' does not exist/);
		await clean("enum array E (x = 2, y)\nmain()\n   println x, y, E.x;\n");
	});

	it("only allows .field after locals and parameters", async () => {
		await clean("main()\n   local v;\n   println v.x.y;\n");
		await fails("const a = 1;\nmain()\n   println a.x;\n", /Field access only works on local variables/);
		await fails("global g;\nmain()\n   println g.x;\n", /Field access only works on local variables/);
	});

	it("rejects a non-function as a command", async () => {
		await fails("main()\n   x;\nx:\n   return;\n", /'x' is a label, not a function/);
		await fails("const a = 1;\nmain()\n   a;\n", /'a' is a constant, not a function/);
	});

	it("warns about statements before the first function and a missing main", async () => {
		assert.ok((await check("println 1;\n" + MAIN)).warnings.some((m) => /outside of a function/.test(m)));
		assert.ok((await check("f()\n   return;\n")).warnings.some((m) => /No 'main' function/.test(m)));
		// without main, unresolved names are not reported: the file is probably a library
		assert.deepEqual((await check("f()\n   println nope;\n")).errors, []);
		await fails("main(a)\n   return;\n", /'main' to not have any parameters/);
	});
});

describe("argument counts", () => {
	it("checks user functions", async () => {
		await clean("f(a, b)\n   return;\nmain()\n   f 1, 2;\n");
		await fails("f(a, b)\n   return;\nmain()\n   f 1;\n", /'f' expects 2 arguments, but got 1/);
	});

	it("checks built-ins, including variadic ones", async () => {
		await fails("main()\n   add 1, 2;\n", /'add' expects 3 arguments, but got 2/);
		await clean("main()\n   println 1, 2, 3, 4;\n");
		await fails("main()\n   println;\n", /'println' expects at least 1 argument, but got 0/);
	});

	it("counts a trailing comma as nothing, like the interpreter", async () => {
		await clean("main()\n   println 1,;\n");
		await fails("main()\n   size 1,;\n", /'size' expects 2 arguments, but got 1/);
	});

	it("checks the callee of call", async () => {
		const f = "f(a)\n   return a;\n";
		await clean(f + "main()\n   local r;\n   call r, f, 1;\n");
		await clean("main()\n   local r;\n   call r, add, 1, 2, r;\n");
		await fails("main()\n   local r;\n   call r, add, 1, 2;\n", /call: 'add' expects 3 arguments, but got 2/);
		await fails(f + "main()\n   local r;\n   call r, f;\n", /call: 'f' expects 1 argument, but got 0/);
		await fails("main()\n   local r;\n   call r, add, 1;\n", /call: 'add' expects 3 arguments, but got 1/);
		await fails("main()\n   local r;\n   call r, 1;\n", /call: expected the name of a function/);
		await fails(f + "main()\n   local r;\n   call r, f, main;\n", /call: cannot call multiple functions/);
	});

	it("does not pile an arity error on top of a syntax error in the same statement", async () => {
		const { errors } = await check("main()\n   add 1, 2\n   println 1;\n");
		assert.equal(errors.length, 1);
		assert.match(errors[0], /Missing ';'/);
	});
});

describe("const, global and enum values", () => {
	it("allows chained declarations that only look backwards", async () => {
		await clean("const a = 1, b = a;\n" + MAIN);
		await fails("const b = a, a = 1;\n" + MAIN, /Variable 'a' does not exist/);
		await fails("const a = a;\n" + MAIN, /Variable 'a' does not exist/);
		await clean("global g = 1, h;\n" + MAIN);
		await clean("global g = 1;\nconst c = g;\n" + MAIN);
	});

	it("never lets a value use locals", async () => {
		await fails("main()\n   local x;\n   const c = x;\n", /Variable 'x' does not exist.*never locals/);
	});

	it("rejects const without a value, negative literals and a trailing comma", async () => {
		await fails("const a;\n" + MAIN, /Constants require/i);
		await fails("const a = -1;\n" + MAIN, /-/);
		await clean("const a = [-1];\n" + MAIN);
		await fails("const a = 1,;\n" + MAIN, /Expected a name after ','/);
		await fails("global g = 1,;\n" + MAIN, /Expected a name after ','/);
	});

	it("accepts a trailing comma after local, which PIL allows", async () => {
		const r = await check("main()\n   local a, b,;\n   println a, b;\n");
		assert.deepEqual(r.errors, []);
		assert.ok(r.warnings.some((m) => /Trailing ','/.test(m)));
	});

	it("needs enumeration values to be numbers", async () => {
		await clean("const k = 3;\nenum E (A = k, B)\n" + MAIN);
		await clean("enum F (X = 4)\nenum E (A = F.X)\n" + MAIN);
		await clean("enum E (A = [1 << 2], B)\n" + MAIN);
		await fails("enum E (A = \"x\")\n" + MAIN, /Expected a number/);
		await fails("enum E (A = main)\n" + MAIN, /Expected a number/);
		await fails("enum E (A = k)\nconst k = 3;\n" + MAIN, /Variable 'k' does not exist/);
	});
});

describe("constant evaluator", () => {
	it("accepts numeric constants, array enumeration entries and evaluator functions", async () => {
		await clean("const k = 2;\nconst c = [k * 3 + sin(pi() / 2)];\n" + MAIN);
		await clean("enum array E (a = 1)\nconst c = [a + 1];\n" + MAIN);
		// a trailing comma inside a function call's parentheses is accepted, and unary operators may repeat
		await clean("const c = [min(1, 2,) + - -1 + hypot3(1, 2, 3)];\n" + MAIN);
	});

	it("reports syntax problems", async () => {
		await fails("const c = [1 +];\n" + MAIN, /Expected a value/);
		await fails("const c = [1 2];\n" + MAIN, /Unexpected '2'/);
		await fails("const c = [];\n" + MAIN, /Expected a value/);
		await fails("const c = [1 + (2];\n" + MAIN, /Expected '\)'/);
		await fails("const c = [1,];\n" + MAIN, /Unexpected ','/);
	});

	it("reports unknown functions, wrong arity and bare function names", async () => {
		await fails("const c = [foo(1)];\n" + MAIN, /No such constant evaluator function 'foo'/);
		await fails("const c = [sin()];\n" + MAIN, /sin\(\) expects 1 argument, got 0/);
		await fails("const c = [clamp(1, 2)];\n" + MAIN, /clamp\(\) expects 3 arguments, got 2/);
		await fails("const c = [pi];\n" + MAIN, /Variable 'pi' does not exist.*pi\(\)/);
	});

	it("only reads numeric constants", async () => {
		await fails("const k = \"s\";\nconst c = [k];\n" + MAIN, /non-numeric/);
		await fails("global g = 1;\nconst c = [g];\n" + MAIN, /it is a global/);
		await fails("enum E (A = 1)\nconst c = [E.A];\n" + MAIN, /Variable 'E' does not exist.*Enumeration entries cannot be read/);
		await fails("const c = [\"s\"];\n" + MAIN, /not a number/);
		await fails("main()\n   local x;\n   println [x + 1];\n", /Variable 'x' does not exist/);
	});

	it("explains that hyphens belong to names", async () => {
		await fails("const a = 1;\nconst c = [a-1];\n" + MAIN, /write subtraction with spaces/);
	});
});

describe("includes", () => {
	it("resolves names across included files in include order", async () => {
		const lib = "const LIMIT = 10;\nhelper(a)\n   return a;\n";
		const ok = await check('include "lib.pil"\nmain()\n   local r;\n   call r, helper, LIMIT;\n', { "lib.pil": lib });
		assert.deepEqual(ok.errors, []);
		// a const from a file included later is not visible yet
		const late = await check('const x = LIMIT;\ninclude "lib.pil"\n' + MAIN, { "lib.pil": lib });
		assert.ok(late.errors.some((m) => /Variable 'LIMIT' does not exist/.test(m)));
	});
});
