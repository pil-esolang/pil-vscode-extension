import { getBuiltin } from "../catalog/builtins";
import { getEvaluatorBuiltin } from "../catalog/evaluator";
import { expressionAt } from "../language/expressions";
import { resolveAt, tokenAt } from "../project/resolver";

export function symbolSignature(s, parent?) {
  if (s.kind === "function") return `${s.name}(${s.parameters.map((p) => p.variadic ? "..." : p.name).join(", ")})`;
  if (s.kind === "struct") return `struct ${s.name} (${s.parameters.map((p) => p.name).join(", ")})`;
  if (s.kind === "enum") return `enum ${s.name}`;
  if (s.kind === "enumMember") return `${parent?.name ? parent.name + "." : ""}${s.name}${s.value !== undefined ? " = " + s.value : ""}`;
  return `${s.kind === "constant" ? "const" : s.kind} ${s.name}${s.value !== undefined ? " = " + s.value : ""}`;
}
export function hoverAt(project, uri, offset) {
  const s = resolveAt(project, uri, offset)[0];
  if (s) return { signature: symbolSignature(s, project.symbols.find((p) => p.id === s.parentId)), documentation: s.documentation };
  const t = tokenAt(project, uri, offset), doc = project.documents.get(uri);
  const b = t?.kind === "identifier" ? doc && expressionAt(doc, t.span.start) ? getEvaluatorBuiltin(t.text) : getBuiltin(t.text) : undefined;
  if (b) return { signature: b.signature, documentation: b.documentation };
}
