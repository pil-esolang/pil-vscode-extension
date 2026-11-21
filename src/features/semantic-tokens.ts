import { getBuiltin } from "../catalog/builtins";
import { getEvaluatorBuiltin } from "../catalog/evaluator";
import { expressionAt } from "../language/expressions";
import { resolveAt } from "../project/resolver";

export const tokenTypes = ["function", "struct", "parameter", "variable", "property", "label", "enum", "enumMember"];
export const tokenModifiers = ["declaration", "readonly", "defaultLibrary"];
export const types = { function: "function", struct: "struct", parameter: "parameter", variable: "variable", global: "variable", field: "property", label: "label", constant: "variable", enum: "enum", enumMember: "enumMember" };
export function semanticTokens(project, uri) {
  const tokens = [];
  for (const t of project.documents.get(uri)?.tokens ?? []) {
    if (t.kind !== "identifier") continue;
    const s = resolveAt(project, uri, t.span.start)[0];
    if (s) {
      const modifiers = [];
      if (s.uri === uri && s.nameSpan.start === t.span.start) modifiers.push("declaration");
      if (s.kind === "constant" || s.kind === "enumMember") modifiers.push("readonly");
      tokens.push({ span: t.span, type: types[s.kind], modifiers });
    } else if (expressionAt(project.documents.get(uri), t.span.start) ? getEvaluatorBuiltin(t.text) : getBuiltin(t.text)) tokens.push({ span: t.span, type: "function", modifiers: ["defaultLibrary"] });
  }
  return tokens;
}
