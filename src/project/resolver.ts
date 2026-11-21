import { getEvaluatorBuiltin } from "../catalog/evaluator";
import { expressionAt } from "../language/expressions";
import { contains } from "../language/model";
import { fieldCandidates } from "../language/structs";

export function functionAt(project, uri, offset) {
  return project.symbols.find((s) => s.uri === uri && s.kind === "function" && offset >= s.span.start && offset <= s.span.end);
}
export function visibleSymbols(project, uri, offset) {
  const current = functionAt(project, uri, offset);
  const doc = project.documents.get(uri);
  const prior = doc?.tokens.filter((t) => t.span.start <= offset).at(-1);
  const order = prior ? project.order.get(`${uri}#${prior.span.start}`) ?? Infinity : Infinity;
  return project.symbols.filter((s) => {
    if (s.kind === "field" || s.kind === "enumMember" && !s.unqualified) return false;
    if (s.kind === "variable" || s.kind === "parameter") return s.parentId === current?.id && s.uri === uri && s.nameSpan.start <= offset;
    if (["constant", "global", "enum", "enumMember"].includes(s.kind)) return (project.order.get(s.id) ?? Infinity) <= order;
    return true;
  });
}
export function resolveName(project, uri, offset, name) {
  const visible = visibleSymbols(project, uri, offset).filter((s) => s.name === name);
  const locals = visible.filter((s) => s.kind === "variable" || s.kind === "parameter");
  return locals.length ? locals : visible;
}
export function tokenAt(project, uri, offset) {
  const tokens = project.documents.get(uri)?.tokens ?? [];
  return tokens.find((t) => contains(t.span, offset)) ?? tokens.find((t) => t.span.end === offset && t.kind === "identifier");
}
export function resolveAt(project, uri, offset) {
  const t = tokenAt(project, uri, offset);
  if (!t || t.kind !== "identifier") return [];
  const document = project.documents.get(uri);
  const next = document.tokens.slice(document.tokens.indexOf(t) + 1).find((t2) => !["comment", "newline"].includes(t2.kind));
  if (next?.text === "(" && expressionAt(document, t.span.start) && getEvaluatorBuiltin(t.text)) return [];
  const declaration = project.symbols.find((s) => s.uri === uri && s.nameSpan.start === t.span.start);
  if (!declaration) {
    const tokens = project.documents.get(uri).tokens, index = tokens.indexOf(t);
    if (tokens[index - 1]?.text === "." && tokens[index - 2]?.kind === "identifier") {
      const enumeration = enumMembers(project, uri, offset, tokens[index - 2].text);
      return (enumeration ?? fieldCandidates(project, uri, offset, tokens[index - 2].text).fields).filter((s) => s.name === t.text);
    }
  }
  return declaration ? [declaration] : resolveName(project, uri, offset, t.text);
}
export function enumMembers(project, uri, offset, name) {
  const owners = visibleSymbols(project, uri, offset).filter((s) => s.kind === "enum" && s.name === name);
  if (!owners.length) return;
  const ids = new Set(owners.map((s) => s.id));
  const doc = project.documents.get(uri), token = doc?.tokens.filter((t) => t.span.start <= offset).at(-1);
  const order = token ? project.order.get(`${uri}#${token.span.start}`) ?? Infinity : Infinity;
  return project.symbols.filter((s) => s.kind === "enumMember" && ids.has(s.parentId) && (project.order.get(s.id) ?? Infinity) <= order);
}
