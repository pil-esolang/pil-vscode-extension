import { getBuiltin } from "../catalog/builtins";
import { locateCall } from "./arguments";
import { functionAt, resolveName } from "../project/resolver";

export function inferStructCandidates(project, symbolId, before = Infinity, fromUri) {
  const symbol = project.symbols.find((s) => s.id === symbolId);
  if (!symbol) return [];
  const fn = symbol.kind === "global" && fromUri ? functionAt(project, fromUri, before) : project.symbols.find((s) => s.id === symbol.parentId);
  const doc = project.documents.get(fromUri ?? symbol.uri);
  if (!fn || !doc) return [];
  const known = new Map();
  const writes = new Set();
  for (const t of doc.tokens) {
    if (t.span.start < fn.span.start || t.span.start >= Math.min(fn.span.end, before)) continue;
    const c = locateCall(doc, t.span.start);
    if (!c || c.command.span.start !== t.span.start) continue;
    const args = c.arguments.map((a) => a.map((t2) => t2.text).join(""));
    if (c.command.text === "make" && args[0] && args[1]) {
      const structs = resolveName(project, doc.uri, t.span.start, args[0]).filter((s) => s.kind === "struct");
      known.set(args[1], structs);
      writes.add(args[1]);
    } else if (["set", "copy", "deep-copy", "array-copy", "array-deep-copy"].includes(c.command.text) && args[1]) {
      known.set(args[1], known.get(args[0]) ?? []);
      writes.add(args[1]);
    } else if (c.command.text === "swap" && args[0] && args[1]) {
      const first = known.get(args[0]) ?? [], second = known.get(args[1]) ?? [];
      known.set(args[0], second);
      known.set(args[1], first);
      writes.add(args[0]);
      writes.add(args[1]);
    } else {
      const builtin = getBuiltin(c.command.text);
      if (!builtin || ["call", "func-call", "catch"].includes(c.command.text)) {
        for (const a of args) known.delete(a);
      } else {
        for (let i = 0; i < builtin.parameters.length; i++) {
          const parameter = builtin.parameters[i];
          if (parameter.role !== "output" && parameter.role !== "inout") continue;
          if (parameter.variadic) {
            for (const a of args.slice(i)) known.delete(a);
          } else known.delete(args[builtin.strategy === "sum" ? args.length - 1 : i]);
        }
      }
    }
  }
  return writes.has(symbol.name) ? known.get(symbol.name) ?? [] : [];
}
export function fieldCandidates(project, uri, offset, receiver) {
  const locals = resolveName(project, uri, offset, receiver);
  const structs = locals.flatMap((s) => inferStructCandidates(project, s.id, offset, uri));
  const ids = new Set(structs.map((s) => s.id));
  return { fields: project.symbols.filter((s) => s.kind === "field" && (!ids.size || ids.has(s.parentId))), known: ids.size > 0 };
}
