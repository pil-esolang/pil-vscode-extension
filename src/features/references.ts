import { resolveAt } from "../project/resolver";

export function referencesTo(project, symbolId) {
  const found = [];
  for (const doc of project.documents.values()) for (const t of doc.references) {
    if (resolveAt(project, doc.uri, t.span.start).some((s) => s.id === symbolId)) found.push({ uri: doc.uri, span: t.span });
  }
  return found;
}
