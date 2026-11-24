import { getBuiltin } from "../catalog/builtins";
import { getEvaluatorBuiltin } from "../catalog/evaluator";

export function builtinDocument(name, evaluator = false) {
  const b = evaluator ? getEvaluatorBuiltin(name) : getBuiltin(name);
  if (!b) return `Unknown PIL builtin: ${name}`;
  return `${b.signature}

${b.documentation}

Parameters:
${b.parameters.map((p) => `  ${p.name}${p.variadic ? "..." : ""}${p.optional ? "?" : ""}${evaluator ? "" : ` \u2014 ${p.description ?? p.role ?? "value"}`}`).join("\n")}

${evaluator ? "Arguments" : "Minimum arguments"}: ${b.minimumArity}${b.variadic ? " (variadic)" : ""}
`;
}
