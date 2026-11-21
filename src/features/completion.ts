import { listBuiltins } from "../catalog/builtins";
import { listEvaluatorBuiltins } from "../catalog/evaluator";
import { locateCall } from "../language/arguments";
import { expressionAt } from "../language/expressions";
import { fieldCandidates } from "../language/structs";
import { enumMembers, visibleSymbols } from "../project/resolver";

export function callSnippet(name, parameters, minimumArity = 0) {
  let slots = parameters.filter((p) => !p.optional);
  const variadic = slots.findIndex((p) => p.variadic);
  if (slots.length < minimumArity && variadic >= 0) {
    const group = slots[variadic], count = minimumArity - slots.length + 1;
    slots = [...slots.slice(0, variadic), ...Array.from({ length: count }, (_, i) => ({ ...group, name: group.name.replace(/S$/, "") + (i + 1) })), ...slots.slice(variadic + 1)];
  }
  const args = slots.map((p, i) => `\${${i + 1}:${p.name}}`);
  return name + (args.length ? " " + args.join(", ") : "") + ";";
}
// Statement keywords. `include` takes a quoted path and, unlike calls, no trailing semicolon.
const keywords = (span) => [
  { label: "include", kind: "keyword", insertText: 'include "${1:file.pil}"', snippet: true, span },
  ...["local", "const", "global", "enum", "enum array", "struct", "struct array"].map((label) => ({ label, kind: "keyword", insertText: label, span })),
];

export function complete(project, uri, offset) {
  const doc = project.documents.get(uri);
  if (!doc) return [];
  const at = doc.tokens.find((t) => offset > t.span.start && offset <= t.span.end);
  if (at && ["comment", "string", "character"].includes(at.kind)) return [];
  const before = doc.text.slice(0, offset), line = before.slice(before.lastIndexOf("\n") + 1);
  const match = line.match(/[A-Za-z_][A-Za-z0-9_-]*$/);
  const prefix = match?.[0] ?? "", span = { start: offset - prefix.length, end: offset };
  const finish = (items) => items.filter((i) => i.label.startsWith(prefix));
  const member = line.match(/([A-Za-z_][A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)$/);
  if (member) {
    const enumeration = enumMembers(project, uri, offset, member[1]);
    if (enumeration) return enumeration.filter((f) => f.name.startsWith(member[2])).map((f) => ({ label: f.name, kind: "enumMember", insertText: f.name, span: { start: offset - member[2].length, end: offset }, detail: `${member[1]}.${f.name}${f.value !== undefined ? " = " + f.value : ""}` }));
    const { fields, known } = fieldCandidates(project, uri, offset, member[1]);
    return fields.filter((f) => f.name.startsWith(member[2])).map((f) => ({ label: f.name, kind: "field", insertText: f.name, span: { start: offset - member[2].length, end: offset }, detail: `${project.symbols.find((s) => s.id === f.parentId)?.name} field${known ? "" : " (receiver type unknown)"}` }));
  }
  if (expressionAt(doc, offset)) {
    const functions = listEvaluatorBuiltins().map((b) => ({ label: b.name, kind: "builtin", insertText: b.name + "(" + b.parameters.map((p, i) => `\${${i + 1}:${p.name}}`).join(", ") + ")", snippet: true, span, documentation: b.documentation, detail: b.signature }));
    const constants = visibleSymbols(project, uri, offset).filter((s) => s.kind === "constant" || (s.kind === "enumMember" && s.unqualified)).map((s) => ({ label: s.name, kind: s.kind, insertText: s.name, span, detail: s.kind }));
    return finish([...functions, ...constants]);
  }
  const c = locateCall(doc, offset);
  const statement = !c || offset <= c.command.span.end;
  let symbols = visibleSymbols(project, uri, offset);
  if (!statement && c) {
    if (c.command.text === "goto" && c.activeArgument === 0 || ["jmp", "jmpn"].includes(c.command.text) && c.activeArgument === 1) symbols = symbols.filter((s) => s.kind === "label");
    if (c.command.text === "make" && c.activeArgument === 0) symbols = symbols.filter((s) => s.kind === "struct");
  }
  const result = symbols.filter((s) => !statement || s.kind === "function").map((s) => ({ label: s.name, kind: s.kind, insertText: statement && s.kind === "function" ? callSnippet(s.name, s.parameters) : s.name, snippet: statement && s.kind === "function", span, documentation: s.documentation, detail: s.kind === "function" ? `${s.name}(${s.parameters.map((p) => p.name + (p.variadic ? "..." : "")).join(", ")})` : s.kind }));
  const restricted = c && !statement && (c.command.text === "make" && c.activeArgument === 0 || c.command.text === "goto" && c.activeArgument === 0 || ["jmp", "jmpn"].includes(c.command.text) && c.activeArgument === 1);
  if (!restricted) {
    const callTarget = c && ["call", "func-call", "catch"].includes(c.command.text);
    if (statement || callTarget) result.push(...listBuiltins().map((b) => ({ label: b.name, kind: "builtin", insertText: statement ? callSnippet(b.name, b.parameters, b.minimumArity) : b.name, snippet: statement, span, documentation: b.documentation, detail: b.signature })));
    if (statement) result.push(...keywords(span));
  }
  return finish(result);
}
