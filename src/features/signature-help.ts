import { getBuiltin } from "../catalog/builtins";
import { getEvaluatorBuiltin } from "../catalog/evaluator";
import { locateCall } from "../language/arguments";
import { evaluatorCallAt, expressionAt } from "../language/expressions";
import { resolveName } from "../project/resolver";

export const param = (name, role = "input") => ({ name, variadic: false, role });
export function signatureAt(project, uri, offset) {
  const doc = project.documents.get(uri);
  if (!doc) return;
  const evaluation = evaluatorCallAt(doc, offset);
  if (evaluation) {
    const b = getEvaluatorBuiltin(evaluation.name);
    if (b) return { label: b.signature, parameters: b.parameters, activeParameter: Math.min(evaluation.activeArgument, Math.max(0, b.parameters.length - 1)), documentation: b.documentation };
  }
  if (expressionAt(doc, offset)) return;
  const c = locateCall(doc, offset);
  if (!c || offset <= c.command.span.end) return;
  const native = getBuiltin(c.command.text), user = resolveName(project, uri, c.command.span.start, c.command.text).find((s) => s.kind === "function");
  if (!native && !user) return;
  let parameters = (user?.parameters ?? native.parameters).map((p) => ({ ...p }));
  let documentation = user?.documentation ?? native?.documentation;
  const names = c.arguments.map((a) => a.length === 1 && a[0].kind === "identifier" ? a[0].text : undefined);
  if (["call", "func-call", "catch"].includes(c.command.text)) {
    const start = c.command.text === "catch" ? 1 : 0;
    const candidates = c.command.text === "call" ? names.map((_, i) => i).filter((i) => i >= start) : [start];
    for (const index of candidates) {
      const name = names[index];
      if (!name) continue;
      const resolved = resolveName(project, uri, c.argumentSpans[index].start, name);
      const target = resolved.find((s) => s.kind === "function");
      const builtin = resolved.length ? undefined : getBuiltin(name);
      if (!target && !builtin) continue;
      const destinations = c.command.text === "catch" ? [param("DESTINATION", "output")] : c.command.text === "call" ? Array.from({ length: index }, (_, i) => param(`RETURN${i + 1}`, "output")) : [];
      parameters = [...destinations, param(`FUNCTION (${name})`), ...target?.parameters ?? builtin.parameters];
      documentation = target?.documentation ?? builtin?.documentation;
      break;
    }
  } else if (c.command.text === "make" && names[0]) {
    const target = resolveName(project, uri, c.command.span.start, names[0]).find((s) => s.kind === "struct");
    if (target) {
      parameters = [param(`STRUCT (${target.name})`), param("DESTINATION", "output"), ...target.parameters];
      documentation = target.documentation ?? "Construct fields in declaration order.";
    }
  }
  let active = Math.min(c.activeArgument, Math.max(0, parameters.length - 1));
  const variadic = parameters.findIndex((p) => p.variadic);
  if (variadic >= 0 && variadic === parameters.length - 1) active = Math.min(active, variadic);
  const label = c.command.text + (parameters.length ? " " + parameters.map((p) => p.name + (p.variadic ? "..." : "") + (p.optional ? "?" : "")).join(", ") : "");
  return { label, parameters, activeParameter: active, documentation };
}
export function parameterRanges(signature) {
  const opening = signature.label.indexOf("("), space = signature.label.indexOf(" ");
  let search = opening >= 0 && (space < 0 || opening < space) ? opening + 1 : space + 1;
  return signature.parameters.map((parameter) => {
    const label = parameter.name + (parameter.variadic ? "..." : "") + (parameter.optional ? "?" : "");
    const start = signature.label.indexOf(label, search);
    search = start + label.length;
    return [start, search];
  });
}
