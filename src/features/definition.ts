import { getBuiltin } from "../catalog/builtins";
import { getEvaluatorBuiltin } from "../catalog/evaluator";
import { expressionAt } from "../language/expressions";
import { contains } from "../language/model";
import { resolveAt, tokenAt } from "../project/resolver";

export function definitionsAt(project, uri, offset) {
  const include = project.documents.get(uri)?.includes.find((i) => contains(i.span, offset));
  if (include) {
    const target = project.includeTargets.get(`${uri}#${include.span.start}`);
    return target ? [{ uri: target, span: { start: 0, end: 0 } }] : [];
  }
  const resolved = resolveAt(project, uri, offset);
  if (resolved.length) return resolved.map((s) => ({ uri: s.uri, span: s.nameSpan }));
  const t = tokenAt(project, uri, offset);
  const doc = project.documents.get(uri);
  if (t?.kind === "identifier" && doc && expressionAt(doc, t.span.start) && getEvaluatorBuiltin(t.text)) return [{ uri: `pil-evaluator:/${t.text}`, span: { start: 0, end: 0 } }];
  if (t?.kind === "identifier" && getBuiltin(t.text)) return [{ uri: `pil-builtin:/${t.text}`, span: { start: 0, end: 0 } }];
  return [];
}
