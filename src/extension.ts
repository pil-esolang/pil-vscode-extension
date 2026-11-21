import * as vscode from "vscode";
import { builtinDocument } from "./features/builtin-documents";
import { complete } from "./features/completion";
import { definitionsAt } from "./features/definition";
import { hoverAt, symbolSignature } from "./features/hover";
import { referencesTo } from "./features/references";
import { semanticTokens, tokenModifiers, tokenTypes } from "./features/semantic-tokens";
import { parameterRanges, signatureAt } from "./features/signature-help";
import { documentSymbols, workspaceSymbols, type SymbolTree } from "./features/symbols";
import { includeCompletionContext } from "./project/includes";
import { resolveAt } from "./project/resolver";
import { ProjectService } from "./project/service";

const kinds = { function: vscode.SymbolKind.Function, struct: vscode.SymbolKind.Struct, field: vscode.SymbolKind.Field, label: vscode.SymbolKind.Key, constant: vscode.SymbolKind.Constant, global: vscode.SymbolKind.Variable, enum: vscode.SymbolKind.Enum, enumMember: vscode.SymbolKind.EnumMember, variable: vscode.SymbolKind.Variable, parameter: vscode.SymbolKind.Variable };
const completionKinds = { function: vscode.CompletionItemKind.Function, struct: vscode.CompletionItemKind.Struct, field: vscode.CompletionItemKind.Field, label: vscode.CompletionItemKind.Reference, constant: vscode.CompletionItemKind.Constant, global: vscode.CompletionItemKind.Variable, enum: vscode.CompletionItemKind.Enum, enumMember: vscode.CompletionItemKind.EnumMember, variable: vscode.CompletionItemKind.Variable, parameter: vscode.CompletionItemKind.Variable, builtin: vscode.CompletionItemKind.Function, keyword: vscode.CompletionItemKind.Keyword, file: vscode.CompletionItemKind.File };
const range = (d, s) => new vscode.Range(d.positionAt(s.start), d.positionAt(s.end));
const markdown = (signature, documentation) => new vscode.MarkdownString().appendCodeblock(signature, "pil").appendMarkdown(documentation ? "\n\n" + documentation : "");
async function location(target) {
  const uri = vscode.Uri.parse(target.uri);
  if (target.span.start === 0 && target.span.end === 0) return new vscode.Location(uri, new vscode.Position(0, 0));
  const d = await vscode.workspace.openTextDocument(uri);
  return new vscode.Location(uri, range(d, target.span));
}
export function activate(context: vscode.ExtensionContext) {
  const service = new ProjectService();
  context.subscriptions.push(service);
  const selector = [{ language: "pil", scheme: "file" }, { language: "pil", scheme: "untitled" }];
  const diagnostics = vscode.languages.createDiagnosticCollection("pil");
  context.subscriptions.push(diagnostics);
  const analyze = async (d: vscode.TextDocument, token?: vscode.CancellationToken) => {
    const version = d.version, p = await service.get(d, token);
    if (!token?.isCancellationRequested && d.version === version) {
      diagnostics.set(d.uri, p.issues.filter((i) => i.uri === d.uri.toString()).map((i) => {
        const diagnostic = new vscode.Diagnostic(range(d, i.span), i.message, i.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
        diagnostic.source = "pil";
        return diagnostic;
      }));
    }
    return p;
  };
  let timer;
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId !== "pil") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void analyze(e.document).catch(() => {
      });
    }, 150);
  }), vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)), { dispose: () => {
    if (timer) clearTimeout(timer);
  } });
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("pil-builtin", { provideTextDocumentContent: (uri) => builtinDocument(uri.path.slice(1)) }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("pil-evaluator", { provideTextDocumentContent: (uri) => builtinDocument(uri.path.slice(1), true) }));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    async provideCompletionItems(d, pos, token) {
      const p = await analyze(d, token);
      if (token.isCancellationRequested) return [];
      const offset = d.offsetAt(pos), parsed = p.documents.get(d.uri.toString()), include = parsed ? includeCompletionContext(parsed, offset) : undefined;
      if (include) {
        try {
          const directory = vscode.Uri.parse(service.resolvePath(p.entryUri, include.directoryPart));
          const entries = await vscode.workspace.fs.readDirectory(directory);
          return entries.filter(([name, type]) => name.startsWith(include.prefix) && (type === vscode.FileType.Directory || name.endsWith(".pil"))).map(([name, type]) => {
            const item = new vscode.CompletionItem(name, type === vscode.FileType.Directory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
            item.insertText = name + (type === vscode.FileType.Directory ? "/" : "");
            item.range = range(d, include.span);
            return item;
          });
        } catch {
          return [];
        }
      }
      return complete(p, d.uri.toString(), offset).map((c) => {
        const item = new vscode.CompletionItem(c.label, completionKinds[c.kind]);
        item.detail = c.detail;
        item.documentation = markdown(c.detail ?? c.label, c.documentation);
        item.range = range(d, c.span);
        item.insertText = c.snippet ? new vscode.SnippetString(c.insertText) : c.insertText;
        if (c.snippet) item.command = { command: "editor.action.triggerParameterHints", title: "Show PIL parameters" };
        return item;
      });
    }
  }, ".", "/", '"'));
  context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(selector, {
    async provideSignatureHelp(d, pos, token) {
      const p = await analyze(d, token);
      if (token.isCancellationRequested) return;
      const s = signatureAt(p, d.uri.toString(), d.offsetAt(pos));
      if (!s) return;
      const help = new vscode.SignatureHelp(), signature = new vscode.SignatureInformation(s.label, s.documentation ? new vscode.MarkdownString(s.documentation) : undefined);
      signature.parameters = parameterRanges(s).map((label, index) => {
        const param2 = s.parameters[index];
        return new vscode.ParameterInformation(label, param2.description ?? param2.role);
      });
      help.signatures = [signature];
      help.activeSignature = 0;
      help.activeParameter = s.activeParameter;
      return help;
    }
  }, " ", ",", "("));
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, { async provideHover(d, pos, token) {
    const p = await analyze(d, token);
    const h = hoverAt(p, d.uri.toString(), d.offsetAt(pos));
    return h ? new vscode.Hover(markdown(h.signature, h.documentation)) : undefined;
  } }));
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, { async provideDefinition(d, pos, token) {
    const p = await analyze(d, token);
    if (token.isCancellationRequested) return [];
    return Promise.all(definitionsAt(p, d.uri.toString(), d.offsetAt(pos)).map(location));
  } }));
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(selector, { async provideDocumentSymbols(d, token) {
    const p = await analyze(d, token), doc = p.documents.get(d.uri.toString());
    if (!doc) return [];
    const tree = (t: SymbolTree): vscode.DocumentSymbol => {
      const s = t.symbol, result = new vscode.DocumentSymbol(s.name, symbolSignature(s), kinds[s.kind], range(d, s.span), range(d, s.nameSpan));
      result.children = t.children.map(tree);
      return result;
    };
    return documentSymbols(doc).map(tree);
  } }));
  context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider({ async provideWorkspaceSymbols(query, token) {
    const projects = await service.all(token);
    return Promise.all(workspaceSymbols(query, projects).map(async (s) => new vscode.SymbolInformation(s.name, kinds[s.kind], s.parentId ? projects.flatMap((p) => p.symbols).find((p) => p.id === s.parentId)?.name ?? "" : "", await location({ uri: s.uri, span: s.nameSpan }))));
  } }));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(selector, { async provideReferences(d, pos, referenceContext, token) {
    const p = await analyze(d, token), symbols = resolveAt(p, d.uri.toString(), d.offsetAt(pos)), projects = await service.all(token), seen = new Set();
    const targets = symbols.flatMap((s) => [...projects.flatMap((project) => referencesTo(project, s.id)), ...referenceContext.includeDeclaration ? [{ uri: s.uri, span: s.nameSpan }] : []]).filter((t) => {
      const key = `${t.uri}#${t.span.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return Promise.all(targets.map(location));
  } }));
  const legend = new vscode.SemanticTokensLegend([...tokenTypes], [...tokenModifiers]);
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, { async provideDocumentSemanticTokens(d, token) {
    const p = await analyze(d, token), builder = new vscode.SemanticTokensBuilder(legend);
    for (const t of semanticTokens(p, d.uri.toString())) builder.push(range(d, t.span), t.type, t.modifiers);
    return builder.build();
  } }, legend));
}
