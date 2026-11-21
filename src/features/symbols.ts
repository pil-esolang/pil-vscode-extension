import type { ParsedDocument, PilSymbol, Project } from "../types";

export interface SymbolTree {
  symbol: PilSymbol;
  children: SymbolTree[];
}

export function documentSymbols(document: ParsedDocument): SymbolTree[] {
  const trees = new Map<string, SymbolTree>(document.declarations.map((symbol) => [symbol.id, { symbol, children: [] }]));
  const roots: SymbolTree[] = [];
  for (const tree of trees.values()) {
    const parent = tree.symbol.parentId ? trees.get(tree.symbol.parentId) : undefined;
    if (parent) parent.children.push(tree);
    else roots.push(tree);
  }
  return roots;
}
export function workspaceSymbols(query: string, projects: Project[]): PilSymbol[] {
  const seen = new Set<string>();
  return projects.flatMap((p) => p.symbols).filter((s) => {
    if (["variable", "parameter"].includes(s.kind) || !s.name.toLowerCase().includes(query.toLowerCase()) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}
