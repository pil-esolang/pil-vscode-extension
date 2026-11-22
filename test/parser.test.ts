import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issuesOf, messages, parse, underlined } from "./helpers";

const lines = (...l: string[]) => l.join("\n") + "\n";

describe("valid programs", () => {
	it("accepts the factorial example", () => {
		const source = lines(
			"# calculates the factorial of N",
			"factorial(n)",
			"   local result, cond, minus1;",
			"   leeq n, 1, cond;",
			"   jmp cond, factorial-end;",
			"   sub n, 1, minus1;",
			"   call result, factorial, minus1;",
			"   mul result, n, result;",
			"   return result;",
			"factorial-end:",
			"   return 1;",
			"",
			"main()",
			"   local result;",
			"   call result, factorial, 5.0;",
			"   println result;",
		);
		assert.deepEqual(issuesOf(source), []);
	});

	it("accepts calls spread over several lines, bare calls and evaluator expressions", () => {
		const source = lines(
			"main()",
			"   local tmp;",
			"   valtable tmp, tmp,",
			"      Tile.empty,    \" .\",",
			"      Tile.player,   \"PL\";",
			"   my-func;",
			"   add [1 +",
			"      sin(2)], 3, tmp;",
			"   println 'a', '\\n', \"tab\\there\", [-1];",
		);
		assert.deepEqual(issuesOf(source), []);
	});

	it("accepts trailing commas in parameter, struct and enum lists", () => {
		const source = lines("f(a, b,)", "   return;", "struct S (x, y,)", "enum E (A, B = 5, C,)");
		assert.deepEqual(issuesOf(source), []);
	});
});

describe("include", () => {
	it("records `include \"file\"` without a semicolon", () => {
		const doc = parse(lines('include "other.pil"', "main()", "   println 1;"));
		assert.deepEqual(doc.issues, []);
		assert.deepEqual(doc.includes.map((i) => i.path), ["other.pil"]);
	});

	it("rejects a semicolon after include, as PIL does", () => {
		const issues = issuesOf(lines('include "other.pil";', "main()", "   println 1;"));
		assert.equal(issues.length, 1);
		assert.match(issues[0].message, /'include' does not take a ';'/);
	});

	it("requires a quoted path", () => {
		const issues = issuesOf(lines("include other;", "main()", "   println 1;"));
		assert.match(issues[0].message, /Expected a quoted file path after 'include'/);
	});

	it("explains removed registers", () => {
		const issues = issuesOf(lines("main()", "   set 5, $0;"));
		assert.match(issues[0].message, /Unexpected character '\$'/);
	});
});

describe("semicolons", () => {
	it("points at the token before the missing ';' and does not cascade", () => {
		const source = lines("main()", '   println "a"', '   println "b";', "   println 1;");
		const issues = issuesOf(source);
		assert.equal(issues.length, 1);
		assert.equal(issues[0].message, `Missing ';' after '"a"'`);
		assert.equal(underlined(source, issues[0]), '"a"');
	});

	it("detects a missing ';' before a user-defined function call", () => {
		const issues = issuesOf(lines("helper()", "   return;", "main()", "   println 1", "   helper;"));
		assert.deepEqual(messages(issues), ["Missing ';' after '1'"]);
	});

	it("detects a missing ';' before the next function or label", () => {
		assert.deepEqual(messages(issuesOf(lines("main()", "   println 1", "other()", "   return;"))), ["Missing ';' after '1'"]);
		assert.deepEqual(messages(issuesOf(lines("main()", "   goto end", "end:"))), ["Missing ';' after 'end'"]);
	});

	it("detects a missing ';' at the end of the file", () => {
		assert.deepEqual(messages(issuesOf("main()\n   println 1")), ["Missing ';' after '1'"]);
	});

	it("rejects stray semicolons, which PIL reports as unexpected", () => {
		for (const source of ["main();\n   println 1;\n", "main()\n   println 1;;\n", "struct S (a);\n"]) {
			const issues = issuesOf(source);
			assert.equal(issues.length, 1, source);
			assert.match(issues[0].message, /^Unexpected ';'/);
		}
	});

	it("reports a missing ';' after local", () => {
		assert.deepEqual(messages(issuesOf(lines("main()", "   local a, b", "   println a;"))), ["Missing ';' after 'b'"]);
	});
});

describe("commas", () => {
	it("detects a missing comma between arguments on one line", () => {
		const source = lines("main()", "   add 1 2, x;");
		const issues = issuesOf(source);
		assert.deepEqual(messages(issues), ["Missing ',' after '1'"]);
		assert.equal(underlined(source, issues[0]), "1");
	});

	it("detects a missing comma in a multi-line argument list without reporting a missing ';'", () => {
		const source = lines("main()", "   valtable a, b,", '      1, "one"', '      2, "two";');
		const issues = issuesOf(source);
		assert.deepEqual(messages(issues), [`Missing ',' after '"one"'`]);
	});

	it("reports doubled and leading commas", () => {
		assert.deepEqual(messages(issuesOf(lines("main()", "   add 1,, 2, x;"))), ["Unexpected ',': expected a value between the commas"]);
		assert.deepEqual(messages(issuesOf(lines("main()", "   add , 1, 2, x;"))), ["Unexpected ',': expected a value first"]);
	});

	it("warns about a trailing comma, which PIL silently accepts", () => {
		const issues = issuesOf(lines("main()", "   println 1,;"));
		assert.deepEqual(messages(issues), ["Trailing ',' before ';'"]);
		assert.equal(issues[0].severity, "warning");
	});

	it("checks parameter lists", () => {
		assert.deepEqual(messages(issuesOf(lines("f(a b)", "   return;"))), ["Missing ',' after 'a'"]);
		assert.deepEqual(messages(issuesOf(lines("f(a,, b)", "   return;"))), ["Unexpected ',': expected a parameter name before it"]);
	});

	it("checks struct and enum member lists", () => {
		assert.deepEqual(messages(issuesOf("struct S (x y)\n")), ["Missing ',' after 'x'"]);
		assert.deepEqual(messages(issuesOf("enum E (A B = 2)\n")), ["Missing ',' after 'A'"]);
		assert.deepEqual(messages(issuesOf("enum E (A = 1 B)\n")), ["Missing ',' after '1'"]);
		assert.deepEqual(messages(issuesOf("struct S (x,, y)\n")), ["Unexpected ',': expected a name before it"]);
	});

	it("numbers should support signs", () => {
		assert.deepEqual(issuesOf(lines("main()", "   add +1, -2, x;")), []);
		assert.deepEqual(issuesOf("enum E (A = -1)\n"), []);
		assert.deepEqual(issuesOf("const A = -1;\n"), []);
	});
});

describe("const, global and local declarations", () => {
	it("accepts chained declarations", () => {
		assert.deepEqual(issuesOf("const A = 1, B = [2 * 3], C = 'x';\nglobal g, h = 3, i;\n"), []);
	});

	it("requires a value for const but not for global", () => {
		assert.deepEqual(messages(issuesOf("const A;\n")), ["Constants require '= VALUE'"]);
		assert.deepEqual(issuesOf("global g;\n"), []);
	});

	it("requires ';' after the declaration list", () => {
		assert.deepEqual(messages(issuesOf("const A = 1\nmain()\n   return;\n")), ["Missing ';' after '1'"]);
		assert.deepEqual(messages(issuesOf("global g, h\nmain()\n   return;\n")), ["Missing ';' after 'h'"]);
	});

	it("detects a missing comma between declarators", () => {
		assert.deepEqual(messages(issuesOf("const A = 1 B = 2;\n")), ["Missing ',' after '1'"]);
		assert.deepEqual(messages(issuesOf("global g h;\n")), ["Missing ',' after 'g'"]);
		assert.deepEqual(messages(issuesOf(lines("main()", "   local a b;"))), ["Missing ',' after 'a'"]);
	});

	it("reports a trailing comma and missing names or values", () => {
		assert.deepEqual(messages(issuesOf("const A = 1,;\n")), ["Expected a name after ','"]);
		assert.deepEqual(messages(issuesOf("const ;\n")), ["Expected a name after 'const'"]);
		assert.deepEqual(messages(issuesOf("const A = ;\n")), ["Expected a value after '='"]);
		assert.deepEqual(messages(issuesOf("const A = , B = 2;\n")), ["Expected a value after '='"]);
	});

	it("does not allow initial values in local", () => {
		const issues = issuesOf(lines("main()", "   local a = 5;"));
		assert.equal(issues.length, 1);
		assert.match(issues[0].message, /use 'set VALUE, name;'/);
	});

	it("requires local to be inside a function", () => {
		assert.deepEqual(messages(issuesOf("local a;\n")), ["Local variables require a function"]);
	});

	it("reports redefined locals and parameters", () => {
		assert.deepEqual(messages(issuesOf(lines("f(a)", "   local a, b, b;", "   return;"))), ["Redefined variable 'a'", "Redefined variable 'b'"]);
	});
});

describe("literals", () => {
	it("reports unterminated strings and characters", () => {
		assert.deepEqual(messages(issuesOf('main()\n   println "abc;\n')), ["Unterminated string"]);
		assert.deepEqual(messages(issuesOf("main()\n   println 'a;\n")), ["Unterminated character"]);
		assert.deepEqual(messages(issuesOf('main()\n   println "abc\\";\n')), ["Unterminated string"]);
	});

	it("warns about unknown escape codes, but not known ones", () => {
		const issues = issuesOf('main()\n   println "a\\qb\\n\\{";\n');
		assert.deepEqual(messages(issues), ["Unknown escape code '\\q'"]);
		assert.equal(issues[0].severity, "warning");
	});

	it("requires a single character in a character literal", () => {
		assert.deepEqual(messages(issuesOf("main()\n   println 'ab';\n")), ["A character literal must contain exactly one character"]);
		assert.deepEqual(issuesOf("main()\n   println '\\n', '\\'', 'x';\n"), []);
	});

	it("reports numbers with several decimal points", () => {
		assert.deepEqual(messages(issuesOf("main()\n   println 1.2.3;\n")), ["Number '1.2.3' contains multiple decimal points"]);
	});

	it("reports characters PIL cannot lex", () => {
		assert.deepEqual(messages(issuesOf("main()\n   println `x`;\n")).slice(0, 1), ["Unexpected character '`'"]);
	});
});
