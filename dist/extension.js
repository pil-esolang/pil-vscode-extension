"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/project/service.ts
var vscode = __toESM(require("vscode"));

// src/language/lexer.ts
function lex(text) {
  const tokens = [];
  let i = 0;
  const push = (kind, start) => tokens.push({ kind, text: text.slice(start, i), span: { start, end: i } });
  while (i < text.length) {
    const start = i, ch = text[i];
    if (ch === "\n" || ch === "\r") {
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      push("newline", start);
    } else if (/\s/.test(ch)) i++;
    else if (ch === "#") {
      while (i < text.length && !/[\r\n]/.test(text[i])) i++;
      push("comment", start);
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length && !/[\r\n]/.test(text[i])) {
        if (text[i] === "\\") {
          i += text[i + 1] && !/[\r\n]/.test(text[i + 1]) ? 2 : 1;
          continue;
        }
        if (text[i++] === ch) break;
      }
      push(ch === '"' ? "string" : "character", start);
    } else if (ch === "$" || /[Rr]/.test(ch) && text[i + 1] === "$") {
      i += ch === "$" ? 1 : 2;
      push("register", start);
    } else if (ch === "@") {
      i++;
      while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
      push("directive", start);
    } else if (/[A-Za-z_]/.test(ch)) {
      i++;
      while (i < text.length && /[A-Za-z0-9_-]/.test(text[i])) i++;
      push("identifier", start);
    } else if (/[0-9]/.test(ch)) {
      i++;
      while (i < text.length && /[0-9.]/.test(text[i])) i++;
      push("number", start);
    } else if (/[()[\],.:;]/.test(ch)) {
      i++;
      push("punctuation", start);
    } else {
      i += /^(?:\*\*|&&|\|\||!=|==|<=|>=|<<|>>)/.test(text.slice(i)) ? 2 : 1;
      push("operator", start);
    }
  }
  return tokens;
}

// src/language/parser.ts
function parts(tokens) {
  const result = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (t.text === "," && depth === 0) {
      result.push([]);
      continue;
    }
    result.at(-1).push(t);
    if (t.text === "[" || t.text === "(") depth++;
    if (t.text === "]" || t.text === ")") depth--;
  }
  return result.filter((p) => p.length);
}
function numericLiteral(value) {
  const raw = value.replace(/^\[\s*|\s*\]$/g, "").trim();
  return /^[+-]?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : void 0;
}
function parseDocument(uri, text, version) {
  const tokens = lex(text), code = tokens.filter((t) => !["comment", "newline"].includes(t.kind));
  const declarations = [], includes = [], issues = [], statements = [];
  const declared = /* @__PURE__ */ new Set(), syntax = /* @__PURE__ */ new Set();
  let current, i = 0;
  const issue = (message, t) => issues.push({ message, span: t.span });
  const documentation = (offset) => {
    const lines = text.slice(0, offset).split(/\r?\n/);
    lines.pop();
    const comments = [];
    for (let n = lines.length - 1; n >= 0; n--) {
      const match = lines[n].match(/^\s*#\s?(.*)$/);
      if (!match) break;
      comments.unshift(match[1]);
    }
    return comments.join("\n");
  };
  const add = (token, kind, parentId) => {
    const s = { id: `${uri}#${token.span.start}`, name: token.text, kind, uri, nameSpan: { ...token.span }, span: { ...token.span }, parameters: [], parentId };
    declarations.push(s);
    declared.add(token.span.start);
    return s;
  };
  const atLineStart = (t) => !text.slice(text.lastIndexOf("\n", t.span.start - 1) + 1, t.span.start).trim();
  const column = (t) => t.span.start - text.lastIndexOf("\n", t.span.start - 1) - 1;
  const recoveryBoundary = (index) => {
    const t = code[index];
    return !!t && atLineStart(t) && (t.kind === "directive" || ["struct", "enum", "local", "const", "global"].includes(t.text) || t.kind === "identifier" && ["(", ":"].includes(code[index + 1]?.text));
  };
  const unmatchedBrackets = /* @__PURE__ */ new Set(), bracketStack = [];
  code.forEach((token, index) => {
    if (token.text === "[") bracketStack.push(index);
    if (token.text === "]") bracketStack.pop();
  });
  bracketStack.forEach((index) => unmatchedBrackets.add(index));
  const record = (kind, start, end, spanEnd) => statements.push({ kind, tokens: code.slice(start, end), span: { start: code[start].span.start, end: spanEnd } });
  const listEnd = (open, header) => {
    let round = 0, square = 0, j = open, unfinishedExpression = false;
    for (; j < code.length; j++) {
      const t = code[j];
      if (j > open && recoveryBoundary(j) && (square === 0 && round === 1 || unfinishedExpression && column(t) <= column(header))) break;
      if (unmatchedBrackets.has(j)) unfinishedExpression = true;
      if (t.text === "[") square++;
      if (t.text === "]") square = Math.max(0, square - 1);
      if (t.text === "(") round++;
      if (t.text === ")" && --round === 0) return { end: j, closed: true };
      if (t.text === ";" && square === 0) break;
    }
    return { end: j, closed: false };
  };
  for (const t of tokens) if ((t.kind === "string" || t.kind === "character") && (t.text.length < 2 || t.text.at(-1) !== t.text[0])) issue("Unterminated literal", t);
  while (i < code.length) {
    const start = i, first = code[i];
    if (first.text === ";") {
      i++;
      continue;
    }
    if (first.kind === "directive") {
      syntax.add(first.span.start);
      const arg = code[i + 1];
      if (first.text === "@include" && arg?.kind === "string") includes.push({ path: arg.text.slice(1, arg.text.length > 1 && arg.text.endsWith('"') ? -1 : void 0), span: arg.span });
      else if (!["@include", "@reg-size", "@return-reg-size"].includes(first.text)) issue("Unknown directive", first);
      else if (!arg || !["number", "string"].includes(arg.kind)) issue("Expected directive argument", first);
      i += arg && ["number", "string"].includes(arg.kind) ? 2 : 1;
      record("directive", start, i, code[i - 1].span.end);
      continue;
    }
    if (first.text === "struct" || first.text === "enum") {
      syntax.add(first.span.start);
      i++;
      const array = code[i]?.text === "array";
      if (array) {
        syntax.add(code[i].span.start);
        i++;
      }
      const name = code[i];
      if (name?.kind !== "identifier" || atLineStart(name) && column(name) <= column(first) && text.slice(first.span.end, name.span.start).includes("\n") && recoveryBoundary(i)) {
        issue(`Expected ${first.text} name`, first);
        continue;
      }
      i++;
      const s = add(name, first.text === "enum" ? "enum" : "struct");
      s.documentation = documentation(first.span.start);
      if (code[i]?.text !== "(") {
        issue(`Expected '(' after ${first.text} name`, name);
        record(first.text, start, i, name.span.end);
        continue;
      }
      const { end: end2, closed } = listEnd(i, first);
      let next = 0;
      for (const part of parts(code.slice(i + 1, end2))) {
        const member = part[0];
        if (member.kind !== "identifier") {
          issue("Expected member name", member);
          continue;
        }
        const field = add(member, s.kind === "enum" ? "enumMember" : "field", s.id);
        const comment = tokens.find((t) => t.kind === "comment" && t.span.start >= member.span.end && !text.slice(member.span.end, t.span.start).includes("\n"));
        field.documentation = comment?.text.slice(1).trim();
        if (s.kind === "enum") {
          field.unqualified = array;
          const assign = part.findIndex((t) => t.text === "=");
          if (assign >= 0) {
            field.value = part[assign + 1] ? text.slice(part[assign + 1].span.start, part.at(-1).span.end) : void 0;
            next = field.value ? numericLiteral(field.value) : void 0;
          } else if (next !== void 0) field.value = String(next);
          if (next !== void 0) next++;
        } else s.parameters.push({ name: member.text, variadic: false, description: field.documentation });
      }
      if (!closed) issue(`Unterminated ${first.text}`, first);
      if (!declarations.some((d) => d.parentId === s.id)) issue(`${first.text} needs at least one member`, name);
      s.span = { start: first.span.start, end: closed ? code[end2].span.end : code[end2]?.span.start ?? text.length };
      i = closed ? end2 + 1 : end2;
      record(first.text, start, i, s.span.end);
      continue;
    }
    if (first.kind === "identifier" && code[i + 1]?.text === "(") {
      if (current) current.span.end = first.span.start;
      current = add(first, "function");
      current.span.end = text.length;
      current.documentation = documentation(first.span.start);
      const { end: end2, closed } = listEnd(i + 1, first);
      for (const part of parts(code.slice(i + 2, end2))) {
        if (part[0].kind === "identifier") {
          current.parameters.push({ name: part[0].text, variadic: false });
          add(part[0], "parameter", current.id);
        } else issue("Expected parameter name", part[0]);
      }
      if (!closed) issue("Unterminated function parameters", first);
      i = closed ? end2 + 1 : end2;
      record("function", start, i, closed ? code[end2].span.end : code[end2]?.span.start ?? text.length);
      continue;
    }
    if (first.kind === "identifier" && code[i + 1]?.text === ":") {
      add(first, "label", current?.id);
      i += 2;
      record("label", start, i, code[i - 1].span.end);
      continue;
    }
    let end = i, depth = 0, unfinishedExpression = false;
    for (; end < code.length; end++) {
      const t = code[end];
      if (depth === 0 && t.text === ";") break;
      if (end > i && recoveryBoundary(end) && (depth === 0 || unfinishedExpression && column(t) <= column(first))) break;
      if (unmatchedBrackets.has(end)) unfinishedExpression = true;
      if (t.text === "[" || t.text === "(") depth++;
      if (t.text === "]" || t.text === ")") depth = Math.max(0, depth - 1);
    }
    const terminated = code[end]?.text === ";", body = code.slice(i + 1, end);
    const kind = ["local", "const", "global"].includes(first.text) ? first.text : "call";
    if (kind !== "call") {
      syntax.add(first.span.start);
      if (kind === "local" && !current) issue("Local variables require a function", first);
      for (const part of parts(body)) {
        const name = part[0];
        if (name.kind !== "identifier") {
          issue("Expected variable name", name);
          continue;
        }
        const s = add(name, kind === "local" ? "variable" : kind === "global" ? "global" : "constant", kind === "local" ? current?.id : void 0);
        s.documentation = documentation(first.span.start);
        const assign = part.findIndex((t) => t.text === "=");
        if (assign >= 0 && part[assign + 1]) s.value = text.slice(part[assign + 1].span.start, part.at(-1).span.end);
        else if (kind === "const") issue("Constants require '= VALUE'", name);
      }
    }
    record(kind, start, end, code[end]?.span.start ?? text.length);
    if (!terminated) issue("Expected ';' after statement", first);
    i = terminated ? end + 1 : Math.max(end, start + 1);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const s of declarations) {
    const namespace = ["field", "enumMember", "variable", "parameter"].includes(s.kind) ? s.parentId : s.kind === "enum" ? "enums" : "global";
    const key = `${namespace}:${s.name}`;
    if (seen.has(key)) issues.push({ message: `Duplicate symbol '${s.name}'`, span: s.nameSpan });
    seen.add(key);
    if (s.kind === "enumMember" && s.unqualified) {
      const global = `global:${s.name}`;
      if (seen.has(global)) issues.push({ message: `Duplicate symbol '${s.name}'`, span: s.nameSpan });
      seen.add(global);
    }
  }
  const references = tokens.filter((t) => t.kind === "identifier" && !declared.has(t.span.start) && !syntax.has(t.span.start));
  return { uri, text, version, tokens, declarations, references, includes, issues, statements };
}

// src/project/index.ts
var ProjectIndex = class {
  constructor(read, resolveInclude) {
    this.read = read;
    this.resolveInclude = resolveInclude;
  }
  buffers = /* @__PURE__ */ new Map();
  generation = 0;
  update(uri, text, version) {
    if ((this.buffers.get(uri)?.version ?? -1) > version) return;
    if (this.buffers.get(uri)?.version === version && this.buffers.get(uri)?.text === text) return;
    this.buffers.set(uri, parseDocument(uri, text, version));
    this.generation++;
  }
  remove(uri) {
    this.buffers.delete(uri);
    this.generation++;
  }
  async snapshot(entryUri) {
    for (; ; ) {
      const generation = this.generation, result = await this.buildSnapshot(entryUri);
      if (generation === this.generation) return result;
    }
  }
  async buildSnapshot(entryUri) {
    const project = { entryUri, documents: /* @__PURE__ */ new Map(), symbols: [], order: /* @__PURE__ */ new Map(), issues: [], includeTargets: /* @__PURE__ */ new Map() };
    let ordinal = 0;
    const visit = async (uri, from) => {
      if (project.documents.has(uri)) return;
      let d = this.buffers.get(uri);
      if (!d) {
        try {
          const text = await this.read(uri);
          d = this.buffers.get(uri) ?? parseDocument(uri, text, 0);
        } catch {
          project.issues.push({ uri: from?.uri ?? uri, span: from?.span ?? { start: 0, end: 0 }, message: `Could not read ${from?.path ?? uri}` });
          return;
        }
      }
      project.documents.set(uri, d);
      project.symbols.push(...d.declarations);
      project.issues.push(...d.issues.map((i) => ({ ...i, uri })));
      const includes = new Map(d.includes.map((i) => [i.span.start, i]));
      for (const t of d.tokens) {
        project.order.set(`${uri}#${t.span.start}`, ordinal++);
        const include = includes.get(t.span.start);
        if (include) {
          try {
            const target = this.resolveInclude(entryUri, include.path);
            project.includeTargets.set(`${uri}#${include.span.start}`, target);
            await visit(target, { uri, span: include.span, path: include.path });
          } catch {
            project.issues.push({ uri, span: include.span, message: `Could not resolve include ${include.path}` });
          }
        }
      }
    };
    await visit(entryUri);
    const globals = /* @__PURE__ */ new Set();
    for (const s of project.symbols.filter((s2) => !["field", "enum", "variable", "parameter"].includes(s2.kind) && (s2.kind !== "enumMember" || s2.unqualified))) {
      if (globals.has(s.name)) project.issues.push({ uri: s.uri, span: s.nameSpan, message: `Duplicate symbol '${s.name}' in included program` });
      globals.add(s.name);
    }
    return project;
  }
};

// src/project/includes.ts
var import_node_path = require("node:path");
var import_node_url = require("node:url");
function includeUri(entryUri, includePath, workspaceRoot, workingDirectory) {
  const root = workspaceRoot ? (0, import_node_url.fileURLToPath)(workspaceRoot) : (0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(entryUri));
  const base = workingDirectory ? (0, import_node_path.isAbsolute)(workingDirectory) ? workingDirectory : (0, import_node_path.resolve)(root, workingDirectory) : root;
  return (0, import_node_url.pathToFileURL)((0, import_node_path.resolve)(base, includePath)).href;
}
function includeCompletionContext(document, offset) {
  const include = document.includes.find((i) => {
    const closed = document.text[i.span.end - 1] === '"' && i.span.end - i.span.start > 1;
    return offset > i.span.start && offset <= (closed ? i.span.end - 1 : i.span.end);
  });
  if (!include) return;
  const typed = document.text.slice(include.span.start + 1, offset), slash = Math.max(typed.lastIndexOf("/"), typed.lastIndexOf("\\"));
  const prefix = typed.slice(slash + 1), base = typed.slice(0, slash + 1);
  return { directoryPart: base + ".", prefix, span: { start: offset - prefix.length, end: offset } };
}

// src/project/context.ts
function selectProgram(documentUri, projects, entryUri) {
  const own = projects.find((p) => p.entryUri === documentUri);
  if (entryUri) {
    const chosen = projects.find((p) => p.entryUri === entryUri && p.documents.has(documentUri));
    if (chosen) return chosen;
  }
  const candidates = projects.filter((p) => p.documents.has(documentUri));
  const roots = candidates.filter((p) => !candidates.some((q) => q.entryUri !== p.entryUri && q.documents.has(p.entryUri) && !p.documents.has(q.entryUri)));
  if (roots.length === 1) return roots[0];
  if (roots.length > 1) return { ...own, issues: [...own.issues, { uri: documentUri, span: { start: 0, end: 0 }, message: `Multiple PIL entry files include this document. Set pil.entryFile to select the program context (${roots.map((p) => p.entryUri.split("/").at(-1)).join(", ")}).` }] };
  return own;
}

// src/project/service.ts
var ProjectService = class {
  index;
  paths = /* @__PURE__ */ new Set();
  versions = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  ready;
  disposed = false;
  generation = 0;
  subscriptions = [];
  constructor() {
    this.index = new ProjectIndex(async (uri) => Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri))).toString("utf8"), (entry, path) => this.resolvePath(entry, path));
    this.ready = this.discover();
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.pil");
    const invalidate = (uri, deleted = false) => {
      const key = uri.toString();
      if (deleted) this.paths.delete(key);
      else this.paths.add(key);
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
      if (!open || !open.isDirty) {
        this.index.remove(key);
        this.versions.delete(key);
      }
      this.snapshots.clear();
      this.generation++;
    };
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate((u) => invalidate(u)),
      watcher.onDidChange((u) => invalidate(u)),
      watcher.onDidDelete((u) => invalidate(u, true)),
      vscode.workspace.onDidChangeTextDocument((e) => this.sync(e.document)),
      vscode.workspace.onDidOpenTextDocument((d) => this.sync(d)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.versions.delete(d.uri.toString());
        this.index.remove(d.uri.toString());
        if (d.uri.scheme === "untitled") this.paths.delete(d.uri.toString());
        this.snapshots.clear();
        this.generation++;
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("pil")) {
          this.snapshots.clear();
          this.generation++;
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.snapshots.clear();
        this.paths.clear();
        this.generation++;
        this.ready = this.discover();
      })
    );
    for (const d of vscode.workspace.textDocuments) this.sync(d);
  }
  resolvePath(entry, path) {
    const uri = vscode.Uri.parse(entry), folder = vscode.workspace.getWorkspaceFolder(uri), cwd = vscode.workspace.getConfiguration("pil", uri).get("workingDirectory", "");
    const anchor = uri.scheme === "file" ? entry : vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.file(process.cwd()), "untitled.pil").toString();
    return includeUri(anchor, path, folder?.uri.toString(), cwd);
  }
  async discover() {
    for (const uri of await vscode.workspace.findFiles("**/*.pil", "**/{node_modules,.git,.vscode-test,dist,out}/**")) if (!this.disposed) this.paths.add(uri.toString());
  }
  sync(d) {
    if (d.languageId !== "pil") return;
    const key = d.uri.toString();
    this.paths.add(key);
    if (this.versions.get(key) === d.version) return;
    this.versions.set(key, d.version);
    this.index.update(key, d.getText(), d.version);
    this.snapshots.clear();
    this.generation++;
  }
  snapshot(uri) {
    let p = this.snapshots.get(uri);
    if (!p) {
      p = this.index.snapshot(uri);
      this.snapshots.set(uri, p);
    }
    return p;
  }
  async all(token) {
    await this.ready;
    for (const d of vscode.workspace.textDocuments) this.sync(d);
    for (; ; ) {
      const generation = this.generation, result = [];
      for (const uri of [...this.paths]) {
        if (token?.isCancellationRequested) break;
        result.push(await this.snapshot(uri));
      }
      if (generation === this.generation || token?.isCancellationRequested) return result;
    }
  }
  async get(document, token) {
    this.sync(document);
    for (; ; ) {
      const generation = this.generation, projects = await this.all(token);
      const uri = document.uri, folder = vscode.workspace.getWorkspaceFolder(uri), entry = vscode.workspace.getConfiguration("pil", uri).get("entryFile", "");
      const entryUri = entry ? includeUri(uri.scheme === "file" ? uri.toString() : vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.file(process.cwd()), "untitled.pil").toString(), entry, folder?.uri.toString()) : void 0;
      if (entryUri && !projects.some((p) => p.entryUri === entryUri)) projects.push(await this.snapshot(entryUri));
      if (!projects.some((p) => p.entryUri === uri.toString())) projects.push(await this.snapshot(uri.toString()));
      if (generation === this.generation || token?.isCancellationRequested) return selectProgram(uri.toString(), projects, entryUri);
    }
  }
  dispose() {
    this.disposed = true;
    for (const s of this.subscriptions) s.dispose();
    this.snapshots.clear();
  }
};

// src/catalog/builtins.json
var builtins_default = [
  {
    name: "string-new",
    implementation: "builtinStringNew",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Stringifies and concatenates all arguments after `DESTINATION`, allocates a new string and stores it in `DESTINATION`. `DESTINATION` - container, `ARGS...` - stringifyable values.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-new)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-new",
    signature: "string-new DESTINATION, ARGS, ..."
  },
  {
    name: "string-format",
    implementation: "builtinStringFormat",
    minimumArity: 2,
    variadic: true,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Formats the `FORMAT-STRING` string with all arguments after it, allocates a new string and stores it in `DESTINATION`. Works by replacing all `{}` with the arguments in left-to-right direction. Does not validate format argument count. `DESTINATION` - container, `FORMAT-STRING` - string, `ARGS...` - stringifyable values.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-format)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-format",
    signature: "string-format DESTINATION, FORMAT-STRING, ARGS, ..."
  },
  {
    name: "string-repeat",
    implementation: "builtinStringRepeat",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      }
    ],
    documentation: "Stringifies `STRING`, allocates a new string that is `STRING` repeated `N` times and stores it in `DESTINATION`. `DESTINATION` - container, `N` - unsigned integer, `STRING` - stringifyable value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-repeat)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-repeat",
    signature: "string-repeat DESTINATION, N, STRING"
  },
  {
    name: "string-clear",
    implementation: "builtinStringClear",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      }
    ],
    documentation: "Clears string. Its memory will still be available. `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-clear)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-clear",
    signature: "string-clear STRING"
  },
  {
    name: "string-memfree",
    implementation: "builtinStringMemFree",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      }
    ],
    documentation: "Clears string and frees its memory. Does not free the string itself and is not necessary to call it before freeing it. `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-memfree)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-memfree",
    signature: "string-memfree STRING"
  },
  {
    name: "string-empty",
    implementation: "builtinStringEmpty",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if the string is empty, otherwise 0. `STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-empty)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-empty",
    signature: "string-empty STRING, DESTINATION"
  },
  {
    name: "string-size",
    implementation: "builtinStringSize",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the size of the string in `DESTINATION`. `STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-size)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-size",
    signature: "string-size STRING, DESTINATION"
  },
  {
    name: "string-capacity",
    implementation: "builtinStringCapacity",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the capacity (the maximum size before a reallocation) of the string in `DESTINATION`. `STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-capacity)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-capacity",
    signature: "string-capacity STRING, DESTINATION"
  },
  {
    name: "string-reserve",
    implementation: "builtinStringReserve",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Reserves `N` capacity for the string to prevent unnecessary reallocations. `STRING` - dynamic string, `N` - unsigned integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-reserve)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-reserve",
    signature: "string-reserve STRING, N"
  },
  {
    name: "string-resize",
    implementation: "builtinStringResize",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "CHAR",
        variadic: false,
        optional: false,
        role: "input",
        description: "CHAR (input)"
      }
    ],
    documentation: "Resizes string to `N` characters. If the new size is greater than the previous then the empty slots are filled with `CHAR`. Might reallocate the string. `STRING` - dynamic string, `N` - unsigned integer, `CHAR` - character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-resize)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-resize",
    signature: "string-resize STRING, N, CHAR"
  },
  {
    name: "string-set",
    implementation: "builtinStringSet",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "CHAR",
        variadic: false,
        optional: false,
        role: "input",
        description: "CHAR (input)"
      }
    ],
    documentation: "Set a character at position `N` to character `CHAR`. Throws if `N` is out of bounds (`N` < 0 || `N` >= `SIZE`). `STRING` - dynamic string, `N` - unsigned integer, `CHAR` - character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-set)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-set",
    signature: "string-set STRING, N, CHAR"
  },
  {
    name: "string-at",
    implementation: "builtinStringAt",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get a character at position `N` and store it in `DESTINATION`. Throws if `N` is out of bounds (`N` < 0 || `N` >= `SIZE`). `STRING` - string, `N` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-at)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-at",
    signature: "string-at STRING, N, DESTINATION"
  },
  {
    name: "string-back",
    implementation: "builtinStringBack",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the back (last) character of the string and store it in `DESTINATION`. Throws if string is empty. `STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-back)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-back",
    signature: "string-back STRING, DESTINATION"
  },
  {
    name: "string-front",
    implementation: "builtinStringFront",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the front (first) character of the string and store it in `DESTINATION`. Throws if string is empty. `STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-front)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-front",
    signature: "string-front STRING, DESTINATION"
  },
  {
    name: "string-push",
    implementation: "builtinStringPush",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "CHAR",
        variadic: false,
        optional: false,
        role: "input",
        description: "CHAR (input)"
      }
    ],
    documentation: "Push `CHAR` at the end of the string. Might reallocate the string. `STRING` - dynamic string, `CHAR` - character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-push)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-push",
    signature: "string-push STRING, CHAR"
  },
  {
    name: "string-insert",
    implementation: "builtinStringInsert",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "CHAR",
        variadic: false,
        optional: false,
        role: "input",
        description: "CHAR (input)"
      }
    ],
    documentation: "Insert `CHAR` at position `N` in the string. Throws if `N` is out of bounds (`N` < 0 || `N` > `SIZE`). Might reallocate the string. `STRING` - dynamic string, `N` - unsigned integer, `CHAR` - character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-insert)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-insert",
    signature: "string-insert STRING, N, CHAR"
  },
  {
    name: "string-pop",
    implementation: "builtinStringPop",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      }
    ],
    documentation: "Pop the last character of the string. Throws if string is empty. `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-pop)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-pop",
    signature: "string-pop STRING"
  },
  {
    name: "string-erase",
    implementation: "builtinStringErase",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Erase a character at position `N` in the string. Throws if `N` is out of bounds (`N` < 0 || `N` >= `SIZE`). `STRING` - dynamic string, `N` - unsigned integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-erase)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-erase",
    signature: "string-erase STRING, N"
  },
  {
    name: "string-free",
    implementation: "builtinStringFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "STRING1",
        variadic: true,
        optional: false,
        role: "inout",
        description: "STRING1 (inout)"
      }
    ],
    documentation: "Frees all strings and sets their values to null. Using a freed string will result in an use-after-free error. `STRING1...` - dynamic strings.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-free)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-free",
    signature: "string-free STRING1, ..."
  },
  {
    name: "string-split",
    implementation: "builtinStringSplit",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DELIMITER",
        variadic: false,
        optional: false,
        role: "input",
        description: "DELIMITER (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Split the string on `DELIMITER`, allocate an array of the split pieces and store it in `DESTINATION`. Time complexity is O(N*M). Throws if `DELIMITER` is empty. `STRING` - string, `DELIMITER` - string or character, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-split)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-split",
    signature: "string-split STRING, DELIMITER, DESTINATION"
  },
  {
    name: "string-concat",
    implementation: "builtinStringConcat",
    minimumArity: 2,
    variadic: true,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "ARG1",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARG1 (input)"
      }
    ],
    documentation: "Stringifies and concatenate all values after `STRING` to the string. `STRING` - dynamic string, `ARG1...` - any values except for maps.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-concat)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-concat",
    signature: "string-concat STRING, ARG1, ..."
  },
  {
    name: "string-substr",
    implementation: "builtinStringSubstr",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      },
      {
        name: "END",
        variadic: false,
        optional: false,
        role: "input",
        description: "END (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Creates a substring [`START`; `END`) from the given string and saves it in `DESTINATION`. Throws if `START` < 0 || `START` >= `SIZE` || `END` < 0 || `END` > `SIZE` || `START` >= `END`. `STRING` - string, `START` - unsigned integer, `END` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-substr)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-substr",
    signature: "string-substr STRING, START, END, DESTINATION"
  },
  {
    name: "string-count",
    implementation: "builtinStringCount",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Counts the number of occurrences of `TARGET` in the string and stores it in `DESTINATION`. Time complexity if `TARGET` is a character is O(N), whereas if `TARGET` is a string, the complexity is O(N + M), where M is the size of the target string. `STRING` - string, `TARGET` - string or character, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-count)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-count",
    signature: "string-count STRING, TARGET, DESTINATION"
  },
  {
    name: "string-reverse",
    implementation: "builtinStringReverse",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      }
    ],
    documentation: "Reverses the string. Time complexity is O(N/2). `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-reverse)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-reverse",
    signature: "string-reverse STRING"
  },
  {
    name: "string-find",
    implementation: "builtinStringFind",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find `TARGET` in the string starting from position `START` (0 to search everything). Returns position if target can be found, otherwise null. Time complexity is O(N*M). Throws if `START` < 0 || `START` > `SIZE`. `STRING` - string, `TARGET` - string or character, `START` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-find)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-find",
    signature: "string-find STRING, TARGET, START, DESTINATION"
  },
  {
    name: "string-rfind",
    implementation: "builtinStringRfind",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find `TARGET` in the string starting from position `START` (>=`SIZE` or -1 to search everything) in a reverse order. Returns position if target can be found, otherwise null. Time complexity is O(N*M). `STRING` - string, `TARGET` - string or character, `START` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-rfind)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-rfind",
    signature: "string-rfind STRING, TARGET, START, DESTINATION"
  },
  {
    name: "string-find-first-of",
    implementation: "builtinStringFindFirstOf",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find the first character found in `TARGET` in the string. Returns position if target can be found, otherwise null. Time complexity is O(N*M). `STRING` - string, `TARGET` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-find-first-of)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-find-first-of",
    signature: "string-find-first-of STRING, TARGET, DESTINATION"
  },
  {
    name: "string-find-first-not-of",
    implementation: "builtinStringFindFirstNotOf",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find the first character not found in `TARGET` in the string. Returns position if target can be found, otherwise null. Time complexity is O(N*M). `STRING` - string, `TARGET` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-find-first-not-of)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-find-first-not-of",
    signature: "string-find-first-not-of STRING, TARGET, DESTINATION"
  },
  {
    name: "string-find-last-of",
    implementation: "builtinStringFindLastOf",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find the first character found in `TARGET` in the string in a reverse order. Returns position if target can be found, otherwise null. Time complexity is O(N*M). `STRING` - string, `TARGET` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-find-last-of)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-find-last-of",
    signature: "string-find-last-of STRING, TARGET, DESTINATION"
  },
  {
    name: "string-find-last-not-of",
    implementation: "builtinStringFindLastNotOf",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find the first character not found in `TARGET` in the string in a reverse order. Returns position if target can be found, otherwise null. Time complexity is O(N*M). `STRING` - string, `TARGET` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-find-last-not-of)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-find-last-not-of",
    signature: "string-find-last-not-of STRING, TARGET, DESTINATION"
  },
  {
    name: "string-replace",
    implementation: "builtinStringReplace",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "REPLACEMENT",
        variadic: false,
        optional: false,
        role: "input",
        description: "REPLACEMENT (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      }
    ],
    documentation: "Attempts to find `TARGET` in the string and if it does, replaces it with `REPLACEMENT`. Time complexity is O(N*M). Throws if `START` < 0 || `START` > `SIZE`. `STRING` - dynamic string, `TARGET` - string or character, `REPLACEMENT` - string or character, `START` - unsigned integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-replace)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-replace",
    signature: "string-replace STRING, TARGET, REPLACEMENT, START"
  },
  {
    name: "string-replace-all",
    implementation: "builtinStringReplaceAll",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "REPLACEMENT",
        variadic: false,
        optional: false,
        role: "input",
        description: "REPLACEMENT (input)"
      }
    ],
    documentation: "Finds all `TARGET`s in the string and replaces them with `REPLACEMENT`. Time complexity is O(N*M) to O(N\\*M\\*K) depending on how `TARGET`'s size differs from `REPLACEMENT`'s and on match count. Throws if `REPLACEMENT` is empty. `STRING` - dynamic string, `TARGET` - string or character, `REPLACEMENT` - string or character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-replace-all)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-replace-all",
    signature: "string-replace-all STRING, TARGET, REPLACEMENT"
  },
  {
    name: "string-contains",
    implementation: "builtinStringContains",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `TARGET` is found in the string, else 0. Time complexity is O(N*M). `STRING` - string, `TARGET` - string or character, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-contains)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-contains",
    signature: "string-contains STRING, TARGET, DESTINATION"
  },
  {
    name: "string-erase-all",
    implementation: "builtinStringEraseAll",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      },
      {
        name: "CHARS",
        variadic: false,
        optional: false,
        role: "input",
        description: "CHARS (input)"
      }
    ],
    documentation: "Erases all characters found in `CHARS` from the string. Time complexity is O(N*M). `STRING` - dynamic string, `CHARS` - string or character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-erase-all)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-erase-all",
    signature: "string-erase-all STRING, CHARS"
  },
  {
    name: "string-starts-with",
    implementation: "builtinStringStartsWith",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if string starts with `START`, else 0. `STRING` - string, `START` - string or character, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-starts-with)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-starts-with",
    signature: "string-starts-with STRING, START, DESTINATION"
  },
  {
    name: "string-ends-with",
    implementation: "builtinStringEndsWith",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "END",
        variadic: false,
        optional: false,
        role: "input",
        description: "END (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if string ends with `END`, else 0. `STRING` - string, `END` - string or character, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-ends-with)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-ends-with",
    signature: "string-ends-with STRING, END, DESTINATION"
  },
  {
    name: "string-trim",
    implementation: "builtinStringTrim",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      }
    ],
    documentation: "Trims all whitespace from both sides of the string. `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-trim)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-trim",
    signature: "string-trim STRING"
  },
  {
    name: "string-to-lower",
    implementation: "builtinStringTolower",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      }
    ],
    documentation: "Converts string to lowercase. `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-to-lower)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-to-lower",
    signature: "string-to-lower STRING"
  },
  {
    name: "string-to-upper",
    implementation: "builtinStringToupper",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "inout",
        description: "STRING (inout)"
      }
    ],
    documentation: "Converts string to uppercase. `STRING` - dynamic string.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-to-upper)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-to-upper",
    signature: "string-to-upper STRING"
  },
  {
    name: "string-copy",
    implementation: "builtinStringCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Copies and allocates a new string into `DESTINATION`. `STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/strings/#string-copy)",
    source: "https://pil-esolang.github.io/built-ins/strings/#string-copy",
    signature: "string-copy STRING, DESTINATION"
  },
  {
    name: "array-new",
    implementation: "builtinArrayNew",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "output",
        description: "ARRAY (output)"
      },
      {
        name: "ARG1",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARG1 (input)"
      }
    ],
    documentation: "Allocate a new array with all values after `ARRAY` as values. `ARRAY` - container, `ARG1...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-new)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-new",
    signature: "array-new ARRAY, ARG1, ..."
  },
  {
    name: "array-fill",
    implementation: "builtinArrayFill",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Fill an array with `N` `VALUE`s, allocate it and store it in `ARRAY`. `ARRAY` - container, `N` - unsigned integer, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-fill)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-fill",
    signature: "array-fill ARRAY, N, VALUE"
  },
  {
    name: "array-iota",
    implementation: "builtinArrayIota",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      }
    ],
    documentation: "Fill an array with `N` incrementing integers starting from `START`, allocate it and store in `ARRAY`. `ARRAY` - container, `N` - unsigned integer, `START` - integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-iota)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-iota",
    signature: "array-iota ARRAY, N, START"
  },
  {
    name: "array-clear",
    implementation: "builtinArrayClear",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      }
    ],
    documentation: "Clears array. Its memory will still be available. `ARRAY` - array.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-clear)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-clear",
    signature: "array-clear ARRAY"
  },
  {
    name: "array-memfree",
    implementation: "builtinArrayMemFree",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      }
    ],
    documentation: "Clears array and frees its memory. Does not free the array itself and is not necessary to call it before freeing it. `ARRAY` - array.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-memfree)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-memfree",
    signature: "array-memfree ARRAY"
  },
  {
    name: "array-empty",
    implementation: "builtinArrayEmpty",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if the array is empty, otherwise 0. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-empty)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-empty",
    signature: "array-empty ARRAY, DESTINATION"
  },
  {
    name: "array-size",
    implementation: "builtinArraySize",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the size of the array in `DESTINATION`. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-size)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-size",
    signature: "array-size ARRAY, DESTINATION"
  },
  {
    name: "array-capacity",
    implementation: "builtinArrayCapacity",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the capacity of the array in `DESTINATION`. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-capacity)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-capacity",
    signature: "array-capacity ARRAY, DESTINATION"
  },
  {
    name: "array-reserve",
    implementation: "builtinArrayReserve",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Reserves `N` capacity for the array to prevent unnecessary reallocations. `ARRAY` - array, `N` - unsigned integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-reserve)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-reserve",
    signature: "array-reserve ARRAY, N"
  },
  {
    name: "array-resize",
    implementation: "builtinArrayResize",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Resizes array to `N` values. If the new size is greater than the previous then the empty slots are filled with `VALUE`. Might reallocate the array. `ARRAY` - array, `N` - unsigned integer, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-resize)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-resize",
    signature: "array-resize ARRAY, N, VALUE"
  },
  {
    name: "array-set",
    implementation: "builtinArraySet",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Set a value at position `N` to value `VALUE`. Throws if `N` is out of bounds (`N` < 0 || `N` >= `SIZE`). `ARRAY` - array, `N` - unsigned integer, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-set)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-set",
    signature: "array-set ARRAY, N, VALUE"
  },
  {
    name: "array-at",
    implementation: "builtinArrayAt",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get a value at position `N` and store it in `DESTINATION`. Throws if `N` is out of bounds (`N` < 0 || `N` >= `SIZE`). `ARRAY` - array, `N` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-at)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-at",
    signature: "array-at ARRAY, N, DESTINATION"
  },
  {
    name: "array-back",
    implementation: "builtinArrayBack",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the back (last) value of the array and store it in `DESTINATION`. Throws if array is empty. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-back)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-back",
    signature: "array-back ARRAY, DESTINATION"
  },
  {
    name: "array-front",
    implementation: "builtinArrayFront",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the front (first) value of the array and store it in `DESTINATION`. Throws if array is empty. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-front)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-front",
    signature: "array-front ARRAY, DESTINATION"
  },
  {
    name: "array-push",
    implementation: "builtinArrayPush",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Push `VALUE` at the end of the array. Might reallocate the array. `ARRAY` - array, `VALUE` - ANY VALUE.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-push)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-push",
    signature: "array-push ARRAY, VALUE"
  },
  {
    name: "array-insert",
    implementation: "builtinArrayInsert",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Insert `VALUE` at position `N` in the array. Throws if `N` is out of bounds (`N` < 0 || `N` > `SIZE`). Might reallocate the array. `ARRAY` - array, `N` - unsigned integer, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-insert)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-insert",
    signature: "array-insert ARRAY, N, VALUE"
  },
  {
    name: "array-pop",
    implementation: "builtinArrayPop",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      }
    ],
    documentation: "Pop the last value of the array. Throws if array is empty. `ARRAY` - array.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-pop)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-pop",
    signature: "array-pop ARRAY"
  },
  {
    name: "array-erase",
    implementation: "builtinArrayErase",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Erase the value at position `N` in the array. Throws if `N` is out of bounds (`N` < 0 || `N` >= `SIZE`). `ARRAY` - array, `N` - unsigned integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-erase)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-erase",
    signature: "array-erase ARRAY, N"
  },
  {
    name: "array-free",
    implementation: "builtinArrayFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARRAY1",
        variadic: true,
        optional: false,
        role: "inout",
        description: "ARRAY1 (inout)"
      }
    ],
    documentation: "Frees all arrays and sets them to null. Does not free arrays' values. Using a freed array will result in an use-after-free error. `ARRAY1...` - arrays.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-free)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-free",
    signature: "array-free ARRAY1, ..."
  },
  {
    name: "array-deep-free",
    implementation: "builtinArrayDeepFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARRAY1",
        variadic: true,
        optional: false,
        role: "inout",
        description: "ARRAY1 (inout)"
      }
    ],
    documentation: "Frees all arrays and their values recursively and sets them to null. Using a freed array will result in an use-after-free error. `ARRAY1...` - arrays.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-deep-free)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-deep-free",
    signature: "array-deep-free ARRAY1, ..."
  },
  {
    name: "array-join",
    implementation: "builtinArrayJoin",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "CONNECTOR",
        variadic: false,
        optional: false,
        role: "input",
        description: "CONNECTOR (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stringify and concatenate all array's values with the `CONNECTOR` in-between, allocate the result and store it in `DESTINATION`. Throws if the array contains a map. `ARRAY` - array, `CONNECTOR` - stringifyable value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-join)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-join",
    signature: "array-join ARRAY, CONNECTOR, DESTINATION"
  },
  {
    name: "array-concat",
    implementation: "builtinArrayConcat",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY1",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY1 (inout)"
      },
      {
        name: "ARRAY2",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY2 (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Combine `ARRAY1` and `ARRAY2` into one, allocate the result and store it in `DESTINATION`. `ARRAY1` - array, `ARRAY2` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-concat)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-concat",
    signature: "array-concat ARRAY1, ARRAY2, DESTINATION"
  },
  {
    name: "array-slice",
    implementation: "builtinArraySlice",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "START",
        variadic: false,
        optional: false,
        role: "input",
        description: "START (input)"
      },
      {
        name: "END",
        variadic: false,
        optional: false,
        role: "input",
        description: "END (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Slice the array [`START`; `END`), allocate the shallow copy and store it in `DESTINATION`. Throws if `START` < 0 || `START` >= `SIZE` || `END` < 0 || `END` > `SIZE` || `START` >= `END`. `ARRAY` - array, `START` - unsigned integer, `END` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-slice)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-slice",
    signature: "array-slice ARRAY, START, END, DESTINATION"
  },
  {
    name: "array-shuffle",
    implementation: "builtinArrayShuffle",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      }
    ],
    documentation: "Randomly shuffle the array based on global RNG. `ARRAY` - array.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-shuffle)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-shuffle",
    signature: "array-shuffle ARRAY"
  },
  {
    name: "array-sort",
    implementation: "builtinArraySort",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "ASCENDING",
        variadic: false,
        optional: false,
        role: "input",
        description: "ASCENDING (input)"
      }
    ],
    documentation: "Sort the array. Sorts ascendingly if `ASCENDING` is truthy, descendingly otherwise. Throws if array contains functions, labels, arrays or maps. `ARRAY` - array, `ASCENDING` - integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-sort)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-sort",
    signature: "array-sort ARRAY, ASCENDING"
  },
  {
    name: "array-count",
    implementation: "builtinArrayCount",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Count the number of times `VALUE` occurrs in the array and store it in `DESTINATION`. Time complexity is O(N). `ARRAY` - array, `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-count)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-count",
    signature: "array-count ARRAY, VALUE, DESTINATION"
  },
  {
    name: "array-reverse",
    implementation: "builtinArrayReverse",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      }
    ],
    documentation: "Reverse the array. Time complexity is O(N/2). `ARRAY` - array.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-reverse)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-reverse",
    signature: "array-reverse ARRAY"
  },
  {
    name: "array-find",
    implementation: "builtinArrayFind",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Attempts to find the first occurrence of `VALUE` in the array. Sets `DESTINATION` to the position if it is found, else null. Time complexity is O(N). `ARRAY` - array, `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-find)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-find",
    signature: "array-find ARRAY, VALUE, DESTINATION"
  },
  {
    name: "array-contains",
    implementation: "builtinArrayContains",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Sets `DESTINATION` to 1 if `VALUE` can be found in the array, otherwise 0. Time complexity is O(N). `ARRAY` - array, `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-contains)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-contains",
    signature: "array-contains ARRAY, VALUE, DESTINATION"
  },
  {
    name: "array-erase-all",
    implementation: "builtinArrayEraseAll",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ARRAY (inout)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Erases all `VALUE`s from array. Time complexity is O(N). `ARRAY` - array, `VALUE` - value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-erase-all)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-erase-all",
    signature: "array-erase-all ARRAY, VALUE"
  },
  {
    name: "array-copy",
    implementation: "builtinArrayShallowCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Shallow copies an array into `DESTINATION`. Only copies references for complex runtime values like dynamic strings, arrays and maps. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-copy)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-copy",
    signature: "array-copy ARRAY, DESTINATION"
  },
  {
    name: "array-deep-copy",
    implementation: "builtinArrayDeepCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ARRAY",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARRAY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Deep copies an array into `DESINATION`. Copies all dynamic strings, arrays and maps recursively. If the array contains multiple identical references to the same object, it is only copied once. `ARRAY` - array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/arrays/#array-deep-copy)",
    source: "https://pil-esolang.github.io/built-ins/arrays/#array-deep-copy",
    signature: "array-deep-copy ARRAY, DESTINATION"
  },
  {
    name: "map-new",
    implementation: "builtinMapNew",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "output",
        description: "MAP (output)"
      },
      {
        name: "KEY1",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY1 (input)"
      },
      {
        name: "VALUE1",
        variadic: true,
        optional: false,
        role: "input",
        description: "VALUE1 (input)"
      }
    ],
    documentation: "Allocate a new map with all key-value pairs after `MAP` set. Throws if passed argument count is even. `MAP` - container, `KEY1` - key value, `VALUE1` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-new)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-new",
    signature: "map-new MAP, KEY1, VALUE1, ..."
  },
  {
    name: "map-erase",
    implementation: "builtinMapErase",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "inout",
        description: "MAP (inout)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      }
    ],
    documentation: "Erase a key-value pair from the map based on the `KEY`. Does nothing if it does not exist. `MAP` - map, `KEY` - key value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-erase)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-erase",
    signature: "map-erase MAP, KEY"
  },
  {
    name: "map-set",
    implementation: "builtinMapSet",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "inout",
        description: "MAP (inout)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Set or insert a `VALUE` with the key `KEY`. `MAP` - map, `KEY` - key value, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-set)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-set",
    signature: "map-set MAP, KEY, VALUE"
  },
  {
    name: "map-at",
    implementation: "builtinMapAt",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the value at key `KEY` and store it in `DESTINATION`. If there is no value at `KEY`, store null. `MAP` - map, `KEY` - key value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-at)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-at",
    signature: "map-at MAP, KEY, DESTINATION"
  },
  {
    name: "map-at-or",
    implementation: "builtinMapAtOr",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      },
      {
        name: "DEFAULT",
        variadic: false,
        optional: false,
        role: "input",
        description: "DEFAULT (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the value at key `KEY` and store it in `DESTINATION`. If there is no value at `KEY`, add it with the value set to `DEFAULT` and store it in `DESTINATION`. `MAP` - map, `KEY` - key value, `DEFAULT` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-at-or)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-at-or",
    signature: "map-at-or MAP, KEY, DEFAULT, DESTINATION"
  },
  {
    name: "map-contains",
    implementation: "builtinMapContains",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if a key-value pair with key `KEY` exists, otherwise 0. `MAP` - map, `KEY` - key value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-contains)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-contains",
    signature: "map-contains MAP, KEY, DESTINATION"
  },
  {
    name: "map-size",
    implementation: "builtinMapSize",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the size of the map in `DESTINATION`. `MAP` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-size)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-size",
    signature: "map-size MAP, DESTINATION"
  },
  {
    name: "map-empty",
    implementation: "builtinMapEmpty",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if the map is empty, otherwise 0. `MAP` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-empty)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-empty",
    signature: "map-empty MAP, DESTINATION"
  },
  {
    name: "map-clear",
    implementation: "builtinMapClear",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "inout",
        description: "MAP (inout)"
      }
    ],
    documentation: "Clears all key-value pairs. `MAP` - map.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-clear)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-clear",
    signature: "map-clear MAP"
  },
  {
    name: "map-keys",
    implementation: "builtinMapKeys",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Gets all map's keys, allocates an array of them and stores in `DESTINATION`. `MAP` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-keys)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-keys",
    signature: "map-keys MAP, DESTINATION"
  },
  {
    name: "map-values",
    implementation: "builtinMapValues",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Gets all map's values, allocates an array of them and stores in `DESTINATION`. `MAP` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-values)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-values",
    signature: "map-values MAP, DESTINATION"
  },
  {
    name: "map-merge",
    implementation: "builtinMapMerge",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "MAP1",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP1 (input)"
      },
      {
        name: "MAP2",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP2 (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Merge `MAP1` and `MAP2` and store the result in `DESTINATION`. `MAP2`'s values have higher priority. `MAP1` - map, `MAP2` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-merge)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-merge",
    signature: "map-merge MAP1, MAP2, DESTINATION"
  },
  {
    name: "map-free",
    implementation: "builtinMapFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "MAP1",
        variadic: true,
        optional: false,
        role: "inout",
        description: "MAP1 (inout)"
      }
    ],
    documentation: "Frees all maps and sets them to null. Does not free maps' key-value pairs. Using a free map will result in an use-after-free error. `MAP1...` - maps.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-free)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-free",
    signature: "map-free MAP1, ..."
  },
  {
    name: "map-deep-free",
    implementation: "builtinMapDeepFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "MAP1",
        variadic: true,
        optional: false,
        role: "inout",
        description: "MAP1 (inout)"
      }
    ],
    documentation: "Frees all maps and their key-value pairs recursively and sets them to null. Using a freed map will result in an use-after-free error. `MAP1...` - maps.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-deep-free)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-deep-free",
    signature: "map-deep-free MAP1, ..."
  },
  {
    name: "map-copy",
    implementation: "builtinMapShallowCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Shallow copies a map into `DESTINATION`. Only copies references for complex runtime values like dynamic strings, arrays and maps. `MAP` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-copy)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-copy",
    signature: "map-copy MAP, DESTINATION"
  },
  {
    name: "map-deep-copy",
    implementation: "builtinMapDeepCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "MAP",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAP (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Deep copies a map into `DESTINATION`. Copies all dynamic strings, arrays and maps recursively. If the map contains multiple identical references to the same object, it is only copied once. `MAP` - map, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/maps/#map-deep-copy)",
    source: "https://pil-esolang.github.io/built-ins/maps/#map-deep-copy",
    signature: "map-deep-copy MAP, DESTINATION"
  },
  {
    name: "incr",
    implementation: "builtinIncr",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "NUMBER",
        variadic: false,
        optional: false,
        role: "inout",
        description: "NUMBER (inout)"
      }
    ],
    documentation: "Increment the value stored in `NUMBER`. `NUMBER` - container containing a number.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#incr)",
    source: "https://pil-esolang.github.io/built-ins/math/#incr",
    signature: "incr NUMBER"
  },
  {
    name: "decr",
    implementation: "builtinDecr",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "NUMBER",
        variadic: false,
        optional: false,
        role: "inout",
        description: "NUMBER (inout)"
      }
    ],
    documentation: "Decrement the value stored in `NUMBER`. `NUMBER` - container containing a number.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#decr)",
    source: "https://pil-esolang.github.io/built-ins/math/#decr",
    signature: "decr NUMBER"
  },
  {
    name: "sum",
    implementation: "builtinSum",
    minimumArity: 3,
    variadic: true,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: true,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Add all numbers together and store in `RESULT`. Returns float if at least a single value is a float. `N1...` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#sum)",
    source: "https://pil-esolang.github.io/built-ins/math/#sum",
    signature: "sum N1, N2, ..., RESULT",
    strategy: "sum"
  },
  {
    name: "add",
    implementation: "builtinAdd",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Add `N1` and `N2` together and store in `RESULT`. Returns float if either number is a float. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#add)",
    source: "https://pil-esolang.github.io/built-ins/math/#add",
    signature: "add N1, N2, RESULT"
  },
  {
    name: "sub",
    implementation: "builtinSub",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Subtract `N1` by `N2` and store in `RESULT`. Returns float if either number is a float. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#sub)",
    source: "https://pil-esolang.github.io/built-ins/math/#sub",
    signature: "sub N1, N2, RESULT"
  },
  {
    name: "mul",
    implementation: "builtinMul",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Multiply `N1` and `N2` together and store in `RESULT`. Returns float if either number is a float. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#mul)",
    source: "https://pil-esolang.github.io/built-ins/math/#mul",
    signature: "mul N1, N2, RESULT"
  },
  {
    name: "div",
    implementation: "builtinDiv",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Divide `N1` by `N2` and store in `RESULT`. Returns float if either number is a float. Returns 0 on division by zero. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#div)",
    source: "https://pil-esolang.github.io/built-ins/math/#div",
    signature: "div N1, N2, RESULT"
  },
  {
    name: "mod",
    implementation: "builtinMod",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the remainder of dividing `N1` by `N2` and store in `RESULT`. Supports floats and negative numbers. Returns float if either number is a float. Returns 0 on division by zero. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#mod)",
    source: "https://pil-esolang.github.io/built-ins/math/#mod",
    signature: "mod N1, N2, RESULT"
  },
  {
    name: "fmod",
    implementation: "builtinFmod",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the remainder of dividing `N1` by `N2`, using the formula `((N1 % N2) + N2) % N2`, and store in `RESULT`. Supports floats and negative numbers. Returns float if either number is a float. Returns 0 on division by zero. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#fmod)",
    source: "https://pil-esolang.github.io/built-ins/math/#fmod",
    signature: "fmod N1, N2, RESULT"
  },
  {
    name: "pow",
    implementation: "builtinPow",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Exponentiate `N1` to the exponent `N2`. Returns float if either number is a float. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#pow)",
    source: "https://pil-esolang.github.io/built-ins/math/#pow",
    signature: "pow N1, N2, RESULT"
  },
  {
    name: "neg",
    implementation: "builtinNeg",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Negate `N` and store in `RESULT`. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#neg)",
    source: "https://pil-esolang.github.io/built-ins/math/#neg",
    signature: "neg N, RESULT"
  },
  {
    name: "sqrt",
    implementation: "builtinSqrt",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the square root of `N` and store in `RESULT`. Returns float. Returns NAN if `N` is negative. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#sqrt)",
    source: "https://pil-esolang.github.io/built-ins/math/#sqrt",
    signature: "sqrt N, RESULT"
  },
  {
    name: "cbrt",
    implementation: "builtinCbrt",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the cube root of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#cbrt)",
    source: "https://pil-esolang.github.io/built-ins/math/#cbrt",
    signature: "cbrt N, RESULT"
  },
  {
    name: "sin",
    implementation: "builtinSin",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the sine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#sin)",
    source: "https://pil-esolang.github.io/built-ins/math/#sin",
    signature: "sin N, RESULT"
  },
  {
    name: "cos",
    implementation: "builtinCos",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the cosine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#cos)",
    source: "https://pil-esolang.github.io/built-ins/math/#cos",
    signature: "cos N, RESULT"
  },
  {
    name: "tan",
    implementation: "builtinTan",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the tangent of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#tan)",
    source: "https://pil-esolang.github.io/built-ins/math/#tan",
    signature: "tan N, RESULT"
  },
  {
    name: "asin",
    implementation: "builtinAsin",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the arcsine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#asin)",
    source: "https://pil-esolang.github.io/built-ins/math/#asin",
    signature: "asin N, RESULT"
  },
  {
    name: "acos",
    implementation: "builtinAcos",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the arccosine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#acos)",
    source: "https://pil-esolang.github.io/built-ins/math/#acos",
    signature: "acos N, RESULT"
  },
  {
    name: "atan",
    implementation: "builtinAtan",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the arctangent of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#atan)",
    source: "https://pil-esolang.github.io/built-ins/math/#atan",
    signature: "atan N, RESULT"
  },
  {
    name: "atan2",
    implementation: "builtinAtan2",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "Y",
        variadic: false,
        optional: false,
        role: "input",
        description: "Y (input)"
      },
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the arctangent of `Y / X` using the signs of arguments to determine the correct quadrant and store in `RESULT`. Returns float. `Y` - number, `X` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#atan2)",
    source: "https://pil-esolang.github.io/built-ins/math/#atan2",
    signature: "atan2 Y, X, RESULT"
  },
  {
    name: "asinh",
    implementation: "builtinAsinh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the inverse hyperbolic sine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#asinh)",
    source: "https://pil-esolang.github.io/built-ins/math/#asinh",
    signature: "asinh N, RESULT"
  },
  {
    name: "acosh",
    implementation: "builtinAcosh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the inverse hyperbolic cosine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#acosh)",
    source: "https://pil-esolang.github.io/built-ins/math/#acosh",
    signature: "acosh N, RESULT"
  },
  {
    name: "atanh",
    implementation: "builtinAtanh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the inverse hyperbolic tangent of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#atanh)",
    source: "https://pil-esolang.github.io/built-ins/math/#atanh",
    signature: "atanh N, RESULT"
  },
  {
    name: "sinh",
    implementation: "builtinSinh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the hyperbolic sine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#sinh)",
    source: "https://pil-esolang.github.io/built-ins/math/#sinh",
    signature: "sinh N, RESULT"
  },
  {
    name: "cosh",
    implementation: "builtinCosh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the hyperbolic cosine of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#cosh)",
    source: "https://pil-esolang.github.io/built-ins/math/#cosh",
    signature: "cosh N, RESULT"
  },
  {
    name: "tanh",
    implementation: "builtinTanh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the hyperbolic tangent of `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#tanh)",
    source: "https://pil-esolang.github.io/built-ins/math/#tanh",
    signature: "tanh N, RESULT"
  },
  {
    name: "abs",
    implementation: "builtinAbs",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the absolute value of `N` and store in `RESULT`. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#abs)",
    source: "https://pil-esolang.github.io/built-ins/math/#abs",
    signature: "abs N, RESULT"
  },
  {
    name: "min",
    implementation: "builtinMin",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the minimum value of `N1` and `N2` and store in `RESULT`. Returns float if either value is a float. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#min)",
    source: "https://pil-esolang.github.io/built-ins/math/#min",
    signature: "min N1, N2, RESULT"
  },
  {
    name: "max",
    implementation: "builtinMax",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the maximum value of `N1` and `N2` and store in `RESULT`. Returns float if either value is a float. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#max)",
    source: "https://pil-esolang.github.io/built-ins/math/#max",
    signature: "max N1, N2, RESULT"
  },
  {
    name: "clamp",
    implementation: "builtinClamp",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "LO",
        variadic: false,
        optional: false,
        role: "input",
        description: "LO (input)"
      },
      {
        name: "HI",
        variadic: false,
        optional: false,
        role: "input",
        description: "HI (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Clamp `X` to range [`LO`; `HI`] and store in `RESULT`. Returns float if any value is a float. Throws if `LO` > `HI`. `X` - number, `LO` - number, `HI` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#clamp)",
    source: "https://pil-esolang.github.io/built-ins/math/#clamp",
    signature: "clamp X, LO, HI, RESULT"
  },
  {
    name: "sign",
    implementation: "builtinSign",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the sign of `N` and store in `RESULT`. Returns integer. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#sign)",
    source: "https://pil-esolang.github.io/built-ins/math/#sign",
    signature: "sign N, RESULT"
  },
  {
    name: "trunc",
    implementation: "builtinTrunc",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Truncate float `N` and store in `RESULT`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#trunc)",
    source: "https://pil-esolang.github.io/built-ins/math/#trunc",
    signature: "trunc N, RESULT"
  },
  {
    name: "ceil",
    implementation: "builtinCeil",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Round float `N` to the smallest integer not less than `N`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#ceil)",
    source: "https://pil-esolang.github.io/built-ins/math/#ceil",
    signature: "ceil N, RESULT"
  },
  {
    name: "floor",
    implementation: "builtinFloor",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Round float `N` to the largest integer not greater than `N`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#floor)",
    source: "https://pil-esolang.github.io/built-ins/math/#floor",
    signature: "floor N, RESULT"
  },
  {
    name: "round",
    implementation: "builtinRound",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Round float `N` to the nearest integer. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#round)",
    source: "https://pil-esolang.github.io/built-ins/math/#round",
    signature: "round N, RESULT"
  },
  {
    name: "exp",
    implementation: "builtinExp",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Computes Euler's number raised to the power `N`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#exp)",
    source: "https://pil-esolang.github.io/built-ins/math/#exp",
    signature: "exp N, RESULT"
  },
  {
    name: "ln",
    implementation: "builtinLn",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Computes the natural (base e) logarithm of `N`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#ln)",
    source: "https://pil-esolang.github.io/built-ins/math/#ln",
    signature: "ln N, RESULT"
  },
  {
    name: "log",
    implementation: "builtinLog",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Computes the base `B` logarithm of `N`, using formula `ln(N) / ln(B)`. Returns float. `N` - number, `B` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#log)",
    source: "https://pil-esolang.github.io/built-ins/math/#log",
    signature: "log N, B, RESULT"
  },
  {
    name: "log2",
    implementation: "builtinLog2",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Computes the base 2 logarithm of `N`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#log2)",
    source: "https://pil-esolang.github.io/built-ins/math/#log2",
    signature: "log2 N, RESULT"
  },
  {
    name: "log10",
    implementation: "builtinLog10",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Computes the base 10 logarithm of `N`. Returns float. `N` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#log10)",
    source: "https://pil-esolang.github.io/built-ins/math/#log10",
    signature: "log10 N, RESULT"
  },
  {
    name: "lerp",
    implementation: "builtinLerp",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "T",
        variadic: false,
        optional: false,
        role: "input",
        description: "T (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Linearly interpolate `A` to `B` based on `T`. Returns float. `A` - number, `B` - number, `T` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#lerp)",
    source: "https://pil-esolang.github.io/built-ins/math/#lerp",
    signature: "lerp A, B, T, RESULT"
  },
  {
    name: "step-towards",
    implementation: "builtinStepTowards",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Step towards `TARGET` by 1 until it is reached. Returns float if either value is a float. `N` - number, `TARGET` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#step-towards)",
    source: "https://pil-esolang.github.io/built-ins/math/#step-towards",
    signature: "step-towards N, TARGET, RESULT"
  },
  {
    name: "seed-random",
    implementation: "builtinSeedRandom",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "SEED",
        variadic: false,
        optional: false,
        role: "input",
        description: "SEED (input)"
      }
    ],
    documentation: "Seed the global RNG used in all random operations, like `random`, `randf-range`, `randi-range` and `array-shuffle`. `SEED` - unsigned integer.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#seed-random)",
    source: "https://pil-esolang.github.io/built-ins/math/#seed-random",
    signature: "seed-random SEED"
  },
  {
    name: "random",
    implementation: "builtinRandom",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get a random float in range [0; 1) based on global RNG and store in `RESULT`. `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#random)",
    source: "https://pil-esolang.github.io/built-ins/math/#random",
    signature: "random RESULT"
  },
  {
    name: "randf-range",
    implementation: "builtinRandfRange",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "MIN",
        variadic: false,
        optional: false,
        role: "input",
        description: "MIN (input)"
      },
      {
        name: "MAX",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAX (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get a random float in range [`MIN`; `MAX`) based on global RNG and store in `RESULT`. Throws if `MIN` > `MAX`. `MIN` - number, `MAX` - number, `RESULT` - result.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#randf-range)",
    source: "https://pil-esolang.github.io/built-ins/math/#randf-range",
    signature: "randf-range MIN, MAX, RESULT"
  },
  {
    name: "randi-range",
    implementation: "builtinRandiRange",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "MIN",
        variadic: false,
        optional: false,
        role: "input",
        description: "MIN (input)"
      },
      {
        name: "MAX",
        variadic: false,
        optional: false,
        role: "input",
        description: "MAX (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get a random integer in range [`MIN`; `MAX`] based on global RNG and store in `RESULT`. Throws if `MIN` > `MAX`. `MIN` - number, `MAX` - number, `RESULT` - result.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#randi-range)",
    source: "https://pil-esolang.github.io/built-ins/math/#randi-range",
    signature: "randi-range MIN, MAX, RESULT"
  },
  {
    name: "gcd",
    implementation: "builtinGcd",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the greatest common divisor of `N1` and `N2` and store in `RESULT`. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#gcd)",
    source: "https://pil-esolang.github.io/built-ins/math/#gcd",
    signature: "gcd N1, N2, RESULT"
  },
  {
    name: "lcm",
    implementation: "builtinLcm",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Get the least common multiple of `N1` and `N2` and store in `RESULT`. `N1` - number, `N2` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#lcm)",
    source: "https://pil-esolang.github.io/built-ins/math/#lcm",
    signature: "lcm N1, N2, RESULT"
  },
  {
    name: "hypot",
    implementation: "builtinHypot",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "Y",
        variadic: false,
        optional: false,
        role: "input",
        description: "Y (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: 'Calculate &radic;<s style="text-decoration:overline">x<sup>2</sup>+y<sup>2</sup></s> and store in `RESULT`. `X` - number, `Y` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#hypot)',
    source: "https://pil-esolang.github.io/built-ins/math/#hypot",
    signature: "hypot X, Y, RESULT"
  },
  {
    name: "hypot3",
    implementation: "builtinHypot3",
    minimumArity: 4,
    variadic: false,
    parameters: [
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "Y",
        variadic: false,
        optional: false,
        role: "input",
        description: "Y (input)"
      },
      {
        name: "Z",
        variadic: false,
        optional: false,
        role: "input",
        description: "Z (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: 'Calculate &radic;<s style="text-decoration:overline">x<sup>2</sup>+y<sup>2</sup>+z<sup>2</sup></s> and store in `RESULT`. `X` - number, `Y` - number, `Z` - number, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#hypot3)',
    source: "https://pil-esolang.github.io/built-ins/math/#hypot3",
    signature: "hypot3 X, Y, Z, RESULT"
  },
  {
    name: "bit-and",
    implementation: "builtinBitand",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Perform bitwise and operation on `N1` and `N2` and store in `RESULT`. `N1` - unsigned integer, `N2` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-and)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-and",
    signature: "bit-and N1, N2, RESULT"
  },
  {
    name: "bit-or",
    implementation: "builtinBitor",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Perform bitwise or operation on `N1` and `N2` and store in `RESULT`. `N1` - unsigned integer, `N2` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-or)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-or",
    signature: "bit-or N1, N2, RESULT"
  },
  {
    name: "bit-xor",
    implementation: "builtinBitxor",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Perform bitwise inclusive or operation on `N1` and `N2` and store in `RESULT`. `N1` - unsigned integer, `N2` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-xor)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-xor",
    signature: "bit-xor N1, N2, RESULT"
  },
  {
    name: "bit-not",
    implementation: "builtinBitnot",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Perform bitwise not operation on `N1` and store in `RESULT`. `N1` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-not)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-not",
    signature: "bit-not N1, RESULT"
  },
  {
    name: "bit-shl",
    implementation: "builtinBitshl",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Perform bitwise shift left operation on `N1` and `N2` and store in `RESULT`. Throws if `N2` >= 64. `N1` - unsigned integer, `N2` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-shl)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-shl",
    signature: "bit-shl N1, N2, RESULT"
  },
  {
    name: "bit-shr",
    implementation: "builtinBitshr",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Perform bitwise shift right operation on `N1` and `N2` and store in `RESULT`. Throws if `N2` >= 64. `N1` - unsigned integer, `N2` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-shr)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-shr",
    signature: "bit-shr N1, N2, RESULT"
  },
  {
    name: "bit-count",
    implementation: "builtinBitcount",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Return the count of set bits in `N` and store in `RESULT`. `N` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-count)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-count",
    signature: "bit-count N, RESULT"
  },
  {
    name: "bit-test",
    implementation: "builtinBittest",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Test the bit in `A` at position `N` and store it in `RESULT`. Throws if `N` >= 64. `A` - unsigned integer, `N` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-test)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-test",
    signature: "bit-test A, N, RESULT"
  },
  {
    name: "bit-set",
    implementation: "builtinBitset",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "inout",
        description: "A (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Set the bit in `A` at position `N` and store the result in `RESULT`. Throws if `N` >= 64. `A` - unsigned integer, `N` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-set)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-set",
    signature: "bit-set A, N, RESULT"
  },
  {
    name: "bit-clear",
    implementation: "builtinBitclear",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "inout",
        description: "A (inout)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Clear the bit in `A` at position `N` and store the result in `RESULT`. Throws if `N` >= 64. `A` - unsigned integer, `N` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-clear)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-clear",
    signature: "bit-clear A, N, RESULT"
  },
  {
    name: "bit-toggle",
    implementation: "builtinBittoggle",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "RESULT",
        variadic: false,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      }
    ],
    documentation: "Toggle the bit in `A` at position `N` and store the result in `RESULT`. Throws if `N` >= 64. `A` - unsigned integer, `N` - unsigned integer, `RESULT` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/math/#bit-toggle)",
    source: "https://pil-esolang.github.io/built-ins/math/#bit-toggle",
    signature: "bit-toggle A, N, RESULT"
  },
  {
    name: "file-open",
    implementation: "builtinFileOpen",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "MODE",
        variadic: false,
        optional: false,
        role: "input",
        description: "MODE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Try to open `PATH` in mode `MODE` and store the file handle in `DESTINATION` on success or null value on failure. Mode `R` - read only, `W` - write only, `A` - write only (append), `X` - read and write. Throws on unknown mode. `PATH` - string, `MODE` - character, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-open)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-open",
    signature: "file-open PATH, MODE, DESTINATION"
  },
  {
    name: "file-close",
    implementation: "builtinFileClose",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      }
    ],
    documentation: "Close file `FILE` and set the handle to null. `FILE` - file handle.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-close)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-close",
    signature: "file-close FILE"
  },
  {
    name: "file-read",
    implementation: "builtinFileRead",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read the whole contents of `FILE`, allocate it and store in `DESTINATION`. `FILE` - file handle, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-read)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-read",
    signature: "file-read FILE, DESTINATION"
  },
  {
    name: "file-readln",
    implementation: "builtinFileReadLn",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read a line from `FILE`, allocate it and store in `DESTINATION`. `FILE` - file handle, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-readln)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-readln",
    signature: "file-readln FILE, DESTINATION"
  },
  {
    name: "file-readch",
    implementation: "builtinFileReadCh",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read a single character from `FILE` and store in `DESTINATION`. `FILE` - file handle, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-readch)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-readch",
    signature: "file-readch FILE, DESTINATION"
  },
  {
    name: "file-read-bytes",
    implementation: "builtinFileReadBytes",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read `N` bytes from `FILE`, allocate them and store as a dynamic string in `DESTINATION`. `FILE` - file handle, `N` - unsigned integer, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-read-bytes)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-read-bytes",
    signature: "file-read-bytes FILE, N, DESTINATION"
  },
  {
    name: "file-eof",
    implementation: "builtinFileEof",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Store 1 in `DESTINATION` if EOF is found, else 0. `FILE` - file handle, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-eof)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-eof",
    signature: "file-eof FILE, DESTINATION"
  },
  {
    name: "file-write",
    implementation: "builtinFileWrite",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DATA",
        variadic: false,
        optional: false,
        role: "input",
        description: "DATA (input)"
      }
    ],
    documentation: "Write stringified `DATA` to `FILE`. `FILE` - file handle, `DATA` - stringifyable value.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-write)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-write",
    signature: "file-write FILE, DATA"
  },
  {
    name: "file-writeln",
    implementation: "builtinFileWriteLn",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DATA",
        variadic: false,
        optional: false,
        role: "input",
        description: "DATA (input)"
      }
    ],
    documentation: "Write stringified `DATA` to `FILE` and append a newline. `FILE` - file handle, `DATA` - stringifyable value.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-writeln)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-writeln",
    signature: "file-writeln FILE, DATA"
  },
  {
    name: "file-flush",
    implementation: "builtinFileFlush",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      }
    ],
    documentation: "Flush the output to `FILE`. `FILE` - file handle.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-flush)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-flush",
    signature: "file-flush FILE"
  },
  {
    name: "file-tell",
    implementation: "builtinFileTell",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Store the current position in `FILE` (in bytes from the start of the file) in `DESTINATION`. Throws if the stream is in a failed state. `FILE` - file handle, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-tell)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-tell",
    signature: "file-tell FILE, DESTINATION"
  },
  {
    name: "file-seek",
    implementation: "builtinFileSeek",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "POS",
        variadic: false,
        optional: false,
        role: "input",
        description: "POS (input)"
      }
    ],
    documentation: "Move the position in `FILE` to `POS` bytes from the start of the file. Clears any EOF or error state on the stream. `FILE` - file handle, `POS` - unsigned integer.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-seek)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-seek",
    signature: "file-seek FILE, POS"
  },
  {
    name: "file-seek-rel",
    implementation: "builtinFileSeekRel",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "OFFSET",
        variadic: false,
        optional: false,
        role: "input",
        description: "OFFSET (input)"
      }
    ],
    documentation: "Move the position in `FILE` by `OFFSET` bytes relative to the current position. A negative `OFFSET` moves backwards. Clears any EOF or error state on the stream. `FILE` - file handle, `OFFSET` - integer.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-seek-rel)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-seek-rel",
    signature: "file-seek-rel FILE, OFFSET"
  },
  {
    name: "file-seek-end",
    implementation: "builtinFileSeekEnd",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FILE",
        variadic: false,
        optional: false,
        role: "input",
        description: "FILE (input)"
      },
      {
        name: "OFFSET",
        variadic: false,
        optional: false,
        role: "input",
        description: "OFFSET (input)"
      }
    ],
    documentation: "Move the position in `FILE` by `OFFSET` bytes relative to the end of the file. Clears any EOF or error state on the stream. `FILE` - file handle, `OFFSET` - integer.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#file-seek-end)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#file-seek-end",
    signature: "file-seek-end FILE, OFFSET"
  },
  {
    name: "path-exists",
    implementation: "builtinPathExists",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `PATH` exists, otherwise 0. `PATH` - string, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-exists)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-exists",
    signature: "path-exists PATH, DESTINATION"
  },
  {
    name: "path-is-file",
    implementation: "builtinPathIsFile",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `PATH` exists and is a regular file, otherwise 0. `PATH` - string, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-is-file)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-is-file",
    signature: "path-is-file PATH, DESTINATION"
  },
  {
    name: "path-is-dir",
    implementation: "builtinPathIsDir",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `PATH` exists and is a directory, otherwise 0. `PATH` - string, `DESTINATION` - contaienr.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-is-dir)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-is-dir",
    signature: "path-is-dir PATH, DESTINATION"
  },
  {
    name: "path-size",
    implementation: "builtinPathSize",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the size `PATH` in `DESTINATION`. Stores null if `PATH` is a directory. Can throw. `PATH` - string, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-size)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-size",
    signature: "path-size PATH, DESTINATION"
  },
  {
    name: "path-modified-time",
    implementation: "builtinPathModifiedTime",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the last modified time of `PATH` in `DESTINATION`. Can throw. `PATH` - string, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-modified-time)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-modified-time",
    signature: "path-modified-time PATH, DESTINATION"
  },
  {
    name: "path-create-dir",
    implementation: "builtinPathCreateDir",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      }
    ],
    documentation: "Recursively creates directories based on `PATH`. Can throw. `PATH` - string.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-create-dir)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-create-dir",
    signature: "path-create-dir PATH"
  },
  {
    name: "path-remove",
    implementation: "builtinPathRemove",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      }
    ],
    documentation: "Remove a file or an empty directory based on `PATH`. Can throw. `PATH` - string.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-remove)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-remove",
    signature: "path-remove PATH"
  },
  {
    name: "path-remove-all",
    implementation: "builtinPathRemoveAll",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      }
    ],
    documentation: "Remove files and directories recursively based on `PATH`. Can throw. `PATH` - string.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-remove-all)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-remove-all",
    signature: "path-remove-all PATH"
  },
  {
    name: "path-copy",
    implementation: "builtinPathCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Copy `PATH` to `DESTINATION`. Can throw. `PATH` - string, `DESTINATION` - string.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-copy)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-copy",
    signature: "path-copy PATH, DESTINATION"
  },
  {
    name: "path-move",
    implementation: "builtinPathMove",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Move `PATH` to `DESTINATION`. Can throw. `PATH` - string, `DESTINATION` - string.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-move)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-move",
    signature: "path-move PATH, DESTINATION"
  },
  {
    name: "path-join",
    implementation: "builtinPathJoin",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "PATH1",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH1 (input)"
      },
      {
        name: "PATH2",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH2 (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Join both paths together, allocate it and store in `DESTINATION`. `PATH1` - string, `PATH2` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-join)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-join",
    signature: "path-join PATH1, PATH2, DESTINATION"
  },
  {
    name: "path-filename",
    implementation: "builtinPathFilename",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the filename of the path (dir/file.ext -> file.ext) and store it in `DESTINATION`. `PATH` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-filename)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-filename",
    signature: "path-filename PATH, DESTINATION"
  },
  {
    name: "path-stem",
    implementation: "builtinPathStem",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the stem of the path (dir/file.ext -> file) and store it in `DESTINATION`. `PATH` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-stem)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-stem",
    signature: "path-stem PATH, DESTINATION"
  },
  {
    name: "path-extension",
    implementation: "builtinPathExtension",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the extension of the path (dir/file.ext -> .ext) and store it in `DESTINATION`. Files with extensions return their extension starting with a dot, whereas files with no extension will return an empty string. `PATH` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-extension)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-extension",
    signature: "path-extension PATH, DESTINATION"
  },
  {
    name: "path-parent",
    implementation: "builtinPathParent",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the parent of the path (dir/file.ext -> dir/) and store it in `DESTINATION`. Returns a copy of `PATH` if no parent is present. `PATH` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-parent)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-parent",
    signature: "path-parent PATH, DESTINATION"
  },
  {
    name: "path-absolute",
    implementation: "builtinPathAbsolute",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the absolute path of `PATH` and store it in `DESTINATION`. `PATH` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-absolute)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-absolute",
    signature: "path-absolute PATH, DESTINATION"
  },
  {
    name: "path-normalize",
    implementation: "builtinPathNormalize",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the lexically normal path of `PATH` and store it in `DESTINATION`. `PATH` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#path-normalize)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#path-normalize",
    signature: "path-normalize PATH, DESTINATION"
  },
  {
    name: "dir-list",
    implementation: "builtinDirList",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate an array of all paths of files and directories found in `PATH` and store it in `DESTINATION`. `PATH` - string, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#dir-list)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#dir-list",
    signature: "dir-list PATH, DESTINATION"
  },
  {
    name: "dir-list-recursive",
    implementation: "builtinDirListRecursive",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate an array of all paths of files and directories recursively found in `PATH` and store it in `DESTINATION`. `PATH` - string, `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#dir-list-recursive)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#dir-list-recursive",
    signature: "dir-list-recursive PATH, DESTINATION"
  },
  {
    name: "os-name",
    implementation: "builtinOsName",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate and return the name of the user's OS. Windows - `windows`, MacOS - `macos`, Linux - `linux`, any other OS - `unknown`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-name)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-name",
    signature: "os-name DESTINATION"
  },
  {
    name: "os-cwd",
    implementation: "builtinOsCwd",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocate the current working directory and store in `DESTINATION`. Can throw. `DESTINATION` - container.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-cwd)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-cwd",
    signature: "os-cwd DESTINATION"
  },
  {
    name: "os-set-cwd",
    implementation: "builtinOsSetCwd",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "PATH",
        variadic: false,
        optional: false,
        role: "input",
        description: "PATH (input)"
      }
    ],
    documentation: "Set the current working directory to `PATH`. Can throw. `PATH` - string.\n\nMust have file I/O permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-set-cwd)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-set-cwd",
    signature: "os-set-cwd PATH"
  },
  {
    name: "os-env-get",
    implementation: "builtinOsEnvGet",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VAR",
        variadic: false,
        optional: false,
        role: "input",
        description: "VAR (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get environment variable `VAR` and store it in `DESTINATION`. Stores null if it doesn't exist. `VAR` - string, `DESTINATION` - container.\n\nMust have environment permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-env-get)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-env-get",
    signature: "os-env-get VAR, DESTINATION"
  },
  {
    name: "os-env-set",
    implementation: "builtinOsEnvSet",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VAR",
        variadic: false,
        optional: false,
        role: "inout",
        description: "VAR (inout)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Set environment variable `VAR` to stringified value `VALUE`. `VAR` - string, `VALUE` - stringifyable value.\n\nMust have environment permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-env-set)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-env-set",
    signature: "os-env-set VAR, VALUE"
  },
  {
    name: "os-exec",
    implementation: "builtinOsExec",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "COMMAND",
        variadic: false,
        optional: false,
        role: "input",
        description: "COMMAND (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Execute command `COMMAND` and store any output up until 4KiB in `DESTINATION`. Throws if cannot open pipe. `COMMAND` - string, `DESTINATION` - container.\n\nMust have command execution permissions.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-exec)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-exec",
    signature: "os-exec COMMAND, DESTINATION"
  },
  {
    name: "os-exit-code",
    implementation: "builtinOsExitCode",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the last exit code from `os-exec` in `DESTINATION`. By default it is 0. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/fileos/#os-exit-code)",
    source: "https://pil-esolang.github.io/built-ins/fileos/#os-exit-code",
    signature: "os-exit-code DESTINATION"
  },
  {
    name: "flush",
    implementation: "builtinFlush",
    minimumArity: 0,
    variadic: false,
    parameters: [],
    documentation: "Flush the output to the terminal.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#flush)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#flush",
    signature: "flush"
  },
  {
    name: "printch",
    implementation: "builtinPrintch",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "CHAR",
        variadic: false,
        optional: false,
        role: "input",
        description: "CHAR (input)"
      }
    ],
    documentation: "Output a single character to the terminal. `CHAR` - character.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#printch)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#printch",
    signature: "printch CHAR"
  },
  {
    name: "print",
    implementation: "builtinPrint",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Output all `ARGS` to the terminal. Does not output a separator or a newline. `ARGS...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#print)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#print",
    signature: "print ARGS..."
  },
  {
    name: "println",
    implementation: "builtinPrintln",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Output all `ARGS` to the terminal including a newline. Does not output a separator. `ARGS...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#println)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#println",
    signature: "println ARGS..."
  },
  {
    name: "printf",
    implementation: "builtinPrintf",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "ARG1",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARG1 (input)"
      }
    ],
    documentation: "Formats the `FORMAT-STRING` string with all arguments after it and outputs it to the terminal. Works by replacing all `{}` with the arguments in left-to-right direction. Does not validate format argument count. `FORMAT-STRING` - string, `ARG1...` - stringifyable value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#printf)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#printf",
    signature: "printf FORMAT-STRING, ARG1, ..."
  },
  {
    name: "printfln",
    implementation: "builtinPrintfln",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "ARG1",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARG1 (input)"
      }
    ],
    documentation: "Formats the `FORMAT-STRING` string with all arguments after it and outputs it and a newline to the terminal. Works by replacing all `{}` with the arguments in left-to-right direction. Does not validate format argument count. `FORMAT-STRING` - string, `ARG1...` - stringifyable value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#printfln)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#printfln",
    signature: "printfln FORMAT-STRING, ARG1, ..."
  },
  {
    name: "read",
    implementation: "builtinRead",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read a single word (until a whitespace is hit) from the user, allocate it as a string and store it in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#read)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#read",
    signature: "read DESTINATION"
  },
  {
    name: "readln",
    implementation: "builtinReadln",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read a whole line (until a newline is hit) from the user, allocate it as a string and store it in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#readln)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#readln",
    signature: "readln DESTINATION"
  },
  {
    name: "readch",
    implementation: "builtinReadch",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Read a single character from the user and store it in `DESTINATION`. Does not output the character to the console nor wait for a newline. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#readch)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#readch",
    signature: "readch DESTINATION"
  },
  {
    name: "setecho",
    implementation: "builtinSetecho",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Set terminal echo based on `VALUE`s truthiness. 0 - off, otherwise on. When echo is off, nothing is output to the terminal. Does not change behavior of `readch`. `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#setecho)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#setecho",
    signature: "setecho VALUE"
  },
  {
    name: "le",
    implementation: "builtinLe",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if `A` is less than `B` and if it is, stores 1 in `DESTINATION`, otherwise 0. Types of `A` and `B` must match, although integers can be compared to floats. `A` - number, character or any string, `B` - number, character or any string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#le)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#le",
    signature: "le A, B, DESTINATION"
  },
  {
    name: "gr",
    implementation: "builtinGr",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if `A` is greater than `B` and if it is, stores 1 in `DESTINATION`, otherwise 0. Types of `A` and `B` must match, although integers can be compared to floats. `A` - number, character or any string, `B` - number, character or any string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#gr)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#gr",
    signature: "gr A, B, DESTINATION"
  },
  {
    name: "leeq",
    implementation: "builtinLeeq",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if `A` is less than or equal to `B` and if it is, stores 1 in `DESTINATION`, otherwise 0. Types of `A` and `B` must match, although integers can be compared to floats. `A` - number, character or any string, `B` - number, character or any string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#leeq)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#leeq",
    signature: "leeq A, B, DESTINATION"
  },
  {
    name: "greq",
    implementation: "builtinGreq",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if `A` is greater than or equal to `B` and if it is, stores 1 in `DESTINATION`, otherwise 0. Types of `A` and `B` must match, although integers can be compared to floats. `A` - number, character or any string, `B` - number, character or any string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#greq)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#greq",
    signature: "greq A, B, DESTINATION"
  },
  {
    name: "eq",
    implementation: "builtinEq",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if `A` is equal to `B` and if it is, stores 1 in `DESTINATION`, otherwise 0. If `A` and `B` don't share the same type 0 is stored, comparing integers to floats is an exception. `A` - number, character, any string or array, `B` - number, character, any string or array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#eq)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#eq",
    signature: "eq A, B, DESTINATION"
  },
  {
    name: "neq",
    implementation: "builtinNeq",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if `A` is not equal to `B` and if it's not, stores 1 in `DESTINATION`, otherwise 0. If `A` and `B` don't share the same type 1 is stored, comparing integers to floats is an exception. `A` - number, character, any string or array, `B` - number, character, any string or array, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#neq)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#neq",
    signature: "neq A, B, DESTINATION"
  },
  {
    name: "and",
    implementation: "builtinAnd",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if both `A` and `B` are true and if so, stores 1 in `DESTINATION`, otherwise 0. `A` - any value, `B` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#and)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#and",
    signature: "and A, B, DESTINATION"
  },
  {
    name: "or",
    implementation: "builtinOr",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks if either `A` or `B` is true and if so, stores 1 in `DESTINATION`, otherwise 0. `A` - any value, `B` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#or)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#or",
    signature: "or A, B, DESTINATION"
  },
  {
    name: "not",
    implementation: "builtinNot",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the opposite of `VALUE`s truthiness in `DESTINATION` - if it is 0, then 1, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#not)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#not",
    signature: "not VALUE, DESTINATION"
  },
  {
    name: "goto",
    implementation: "builtinGoto",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "LABEL",
        variadic: false,
        optional: false,
        role: "input",
        description: "LABEL (input)"
      }
    ],
    documentation: "Unconditionally jumps to `LABEL`. `LABEL` - label.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#goto)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#goto",
    signature: "goto LABEL"
  },
  {
    name: "jmp",
    implementation: "builtinJmp",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "CONDITION",
        variadic: false,
        optional: false,
        role: "input",
        description: "CONDITION (input)"
      },
      {
        name: "LABEL",
        variadic: false,
        optional: false,
        role: "input",
        description: "LABEL (input)"
      }
    ],
    documentation: "Jumps to `LABEL` if `CONDITION` is truthy, otherwise does nothing. `CONDITION` - any value, `LABEL` - label.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#jmp)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#jmp",
    signature: "jmp CONDITION, LABEL"
  },
  {
    name: "jmpn",
    implementation: "builtinJmpn",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "CONDITION",
        variadic: false,
        optional: false,
        role: "input",
        description: "CONDITION (input)"
      },
      {
        name: "LABEL",
        variadic: false,
        optional: false,
        role: "input",
        description: "LABEL (input)"
      }
    ],
    documentation: "Jumps to `LABEL` if `CONDITION` is not truthy, otherwise does nothing. `CONDITION` - any value, `LABEL` - label.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#jmpn)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#jmpn",
    signature: "jmpn CONDITION, LABEL"
  },
  {
    name: "jmptable",
    implementation: "builtinJmptable",
    minimumArity: 3,
    variadic: true,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "LABEL",
        variadic: true,
        optional: false,
        role: "input",
        description: "LABEL (input)"
      },
      {
        name: "DEFAULT-LABEL",
        variadic: false,
        optional: true,
        role: "input",
        description: "DEFAULT-LABEL (input)"
      }
    ],
    documentation: "Checks `VALUE` against all `TARGET`s and if there is a match, then jump to the label after it. If the passed argument count is even and there are no matches, jump to `DEFAULT-LABEL`, otherwise do nothing. Each `TARGET` must have a corresponding `LABEL` after it. `VALUE` - number, character, any string or array, `TARGET...` - number, character, any string or array, `LABEL...` - label, `DEFAULT-LABEL?` - optional label.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#jmptable)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#jmptable",
    signature: "jmptable VALUE, TARGET, LABEL..., DEFAULT-LABEL?",
    strategy: "jmptable"
  },
  {
    name: "call",
    implementation: "builtinCall",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "RETURNS",
        variadic: true,
        optional: false,
        role: "output",
        description: "RETURNS (output)"
      },
      {
        name: "FUNCTION",
        variadic: false,
        optional: false,
        role: "input",
        description: "FUNCTION (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Calls `FUNCTION` with given arguments `ARGS...` (if any) and stores all of the returns in `RETURNS...` (if any). Throws if `ARGS...` count does not match `FUNCTION`s arity or if `FUNCTION` is not parse-time. For runtime function calls use [func-call](https://pil-esolang.github.io/built-ins/builtins/#func-call). Throws a warning if `RETURNS...` count does not match actual returned value count. `RETURNS...` - containers, `FUNCTION` - function, `ARGS...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#call)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#call",
    signature: "call RETURNS..., FUNCTION, ARGS...",
    strategy: "call"
  },
  {
    name: "func-call",
    implementation: "builtinFunccall",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "FUNCTION",
        variadic: false,
        optional: false,
        role: "input",
        description: "FUNCTION (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Calls `FUNCTION` with given arguments `ARGS...` (if any). Throws if `ARGS...` count does not match `FUNCTION`'s arity. `FUNCTION` - function, `ARGS...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#func-call)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#func-call",
    signature: "func-call FUNCTION, ARGS...",
    strategy: "func-call"
  },
  {
    name: "return",
    implementation: "builtinReturn",
    minimumArity: 0,
    variadic: true,
    parameters: [
      {
        name: "VALUES",
        variadic: true,
        optional: false,
        role: "input",
        description: "VALUES (input)"
      }
    ],
    documentation: "Returns from the function and stores all `VALUES...` (if any) in return registers. Exits the program if called from main function. `VALUES...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#return)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#return",
    signature: "return VALUES..."
  },
  {
    name: "catch",
    implementation: "builtinCatch",
    minimumArity: 2,
    variadic: true,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "FUNCTION",
        variadic: false,
        optional: false,
        role: "input",
        description: "FUNCTION (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Calls `FUNCTION` with given arguments `ARGS...` (if any) and allocates and stores all errors as an array of strings in `DESTINATION` if any were thrown, otherwise stores null. Throws if `ARGS...` count does not match `FUNCTION`'s arity. `DESTINATION` - container, `FUNCTION` - function, `ARGS...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#catch)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#catch",
    signature: "catch DESTINATION, FUNCTION, ARGS...",
    strategy: "catch"
  },
  {
    name: "assert",
    implementation: "builtinAssert",
    minimumArity: 2,
    variadic: true,
    parameters: [
      {
        name: "CONDITION",
        variadic: false,
        optional: false,
        role: "input",
        description: "CONDITION (input)"
      },
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Exits the program and formats the `FORMAT-STRING` in the same manner as [printf](https://pil-esolang.github.io/built-ins/builtins/#printf) if `CONDITION` is not truthy. Does not precompute the message if the `CONDITION` is truthy. `CONDITION` - any value, `FORMAT-STRING` - string, `ARGS...` - stringifyable value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#assert)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#assert",
    signature: "assert CONDITION, FORMAT-STRING, ARGS..."
  },
  {
    name: "warn",
    implementation: "builtinWarn",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Formats the `FORMAT-STRING` in the same manner as [printf](https://pil-esolang.github.io/built-ins/builtins/#printf) and outputs it as a warning. `FORMAT-STRING` - string, `ARGS...` - stringifyable value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#warn)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#warn",
    signature: "warn FORMAT-STRING, ARGS..."
  },
  {
    name: "error",
    implementation: "builtinError",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Formats the `FORMAT-STRING` in the same manner as [printf](https://pil-esolang.github.io/built-ins/builtins/#printf), outputs it as an error and as long as the error isn't caught using [catch](https://pil-esolang.github.io/built-ins/builtins/#catch), exits the program. `FORMAT-STRING` - string, `ARGS...` - stringifyable value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#error)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#error",
    signature: "error FORMAT-STRING, ARGS..."
  },
  {
    name: "exit",
    implementation: "builtinExit",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "CODE",
        variadic: false,
        optional: false,
        role: "input",
        description: "CODE (input)"
      }
    ],
    documentation: "Unconditionally exits the program with exit code `CODE`. An erroneous code is any code except for 0. `CODE` - number.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#exit)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#exit",
    signature: "exit CODE"
  },
  {
    name: "stack-depth",
    implementation: "builtinStackdepth",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the depth of the stack in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#stack-depth)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#stack-depth",
    signature: "stack-depth DESTINATION"
  },
  {
    name: "stack-name",
    implementation: "builtinStackname",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocates and stores the name of the calee's function in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#stack-name)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#stack-name",
    signature: "stack-name DESTINATION"
  },
  {
    name: "stack-line",
    implementation: "builtinStackline",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the line of calee's function in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#stack-line)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#stack-line",
    signature: "stack-line DESTINATION"
  },
  {
    name: "stack-file",
    implementation: "builtinStackfile",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocates and stores the name of the file of the calee's function in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#stack-file)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#stack-file",
    signature: "stack-file DESTINATION"
  },
  {
    name: "stack-trace",
    implementation: "builtinStacktrace",
    minimumArity: 0,
    variadic: false,
    parameters: [],
    documentation: "Dumps the stack trace and exits the program.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#stack-trace)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#stack-trace",
    signature: "stack-trace"
  },
  {
    name: "typeof",
    implementation: "builtinTypeof",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Allocates and stores the name of the type of `VALUE` in `DESTINATION`. Integer - `int`, float - `float`, character - `char`, constant and dynamic strings - `string`, array - `array`, map - `map`, function - `function`, label - `label`, null - `null`. `VALUE` - any value. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#typeof)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#typeof",
    signature: "typeof VALUE, DESTINATION"
  },
  {
    name: "is-num",
    implementation: "builtinIsnum",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a number, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-num)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-num",
    signature: "is-num VALUE, DESTINATION"
  },
  {
    name: "is-float",
    implementation: "builtinIsfloat",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a float, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-float)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-float",
    signature: "is-float VALUE, DESTINATION"
  },
  {
    name: "is-int",
    implementation: "builtinIsint",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is an integer, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-int)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-int",
    signature: "is-int VALUE, DESTINATION"
  },
  {
    name: "is-char",
    implementation: "builtinIschar",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a character, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-char)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-char",
    signature: "is-char VALUE, DESTINATION"
  },
  {
    name: "is-string",
    implementation: "builtinIsstring",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a string, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-string)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-string",
    signature: "is-string VALUE, DESTINATION"
  },
  {
    name: "is-dynamic-string",
    implementation: "builtinIsdynamicstring",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a dynamically allocated string, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-dynamic-string)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-dynamic-string",
    signature: "is-dynamic-string VALUE, DESTINATION"
  },
  {
    name: "is-constant-string",
    implementation: "builtinIsconstantstring",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a constant string, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-constant-string)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-constant-string",
    signature: "is-constant-string VALUE, DESTINATION"
  },
  {
    name: "is-array",
    implementation: "builtinIsarray",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is an array, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-array)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-array",
    signature: "is-array VALUE, DESTINATION"
  },
  {
    name: "is-map",
    implementation: "builtinIsmap",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a map, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-map)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-map",
    signature: "is-map VALUE, DESTINATION"
  },
  {
    name: "is-file-handle",
    implementation: "builtinIsfilehandle",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a file handle, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-file-handle)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-file-handle",
    signature: "is-file-handle VALUE, DESTINATION"
  },
  {
    name: "is-reg",
    implementation: "builtinIsreg",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a container, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-reg)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-reg",
    signature: "is-reg VALUE, DESTINATION"
  },
  {
    name: "is-function",
    implementation: "builtinIsfunction",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a function, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-function)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-function",
    signature: "is-function VALUE, DESTINATION"
  },
  {
    name: "is-label",
    implementation: "builtinIslabel",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a label, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-label)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-label",
    signature: "is-label VALUE, DESTINATION"
  },
  {
    name: "is-struct",
    implementation: "builtinIsStruct",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a structure, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-struct)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-struct",
    signature: "is-struct VALUE, DESTINATION"
  },
  {
    name: "is-of-struct",
    implementation: "builtinIsOfStruct",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "STRUCT",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRUCT (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is of struct `STRUCT`, otherwise 0. `VALUE` - array, `STRUCT` - structure, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-of-struct)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-of-struct",
    signature: "is-of-struct VALUE, STRUCT, DESTINATION"
  },
  {
    name: "is-null",
    implementation: "builtinIsnull",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is null, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-null)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-null",
    signature: "is-null VALUE, DESTINATION"
  },
  {
    name: "is-inf",
    implementation: "builtinIsinf",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a float and infinite, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-inf)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-inf",
    signature: "is-inf VALUE, DESTINATION"
  },
  {
    name: "is-nan",
    implementation: "builtinIsnan",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `VALUE` is a float and NaN, otherwise 0. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#is-nan)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#is-nan",
    signature: "is-nan VALUE, DESTINATION"
  },
  {
    name: "to-int",
    implementation: "builtinToint",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Converts `VALUE` to an integer and stores it in `DESTINATION`. If `VALUE` is a string and it isn't a valid number or is out of bounds, store null instead. `VALUE` - number, character or string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#to-int)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#to-int",
    signature: "to-int VALUE, DESTINATION"
  },
  {
    name: "to-float",
    implementation: "builtinTofloat",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Converts `VALUE` to a float and stores it in `DESTINATION`. If `VALUE` is a string and it isn't a valid number or is out of bounds, store null instead. `VALUE` - number, character or string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#to-float)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#to-float",
    signature: "to-float VALUE, DESTINATION"
  },
  {
    name: "to-char",
    implementation: "builtinTochar",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Converts `VALUE` to a character and stores it in `DESTINATION`. `VALUE` - number or character. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#to-char)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#to-char",
    signature: "to-char VALUE, DESTINATION"
  },
  {
    name: "time",
    implementation: "builtinTime",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the elapsed time in milliseconds since the first [time](https://pil-esolang.github.io/built-ins/builtins/#time) call in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#time)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#time",
    signature: "time DESTINATION"
  },
  {
    name: "unix-time",
    implementation: "builtinUnixTime",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores seconds since epoch in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#unix-time)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#unix-time",
    signature: "unix-time DESTINATION"
  },
  {
    name: "date",
    implementation: "builtinDate",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FORMAT-STRING",
        variadic: false,
        optional: false,
        role: "input",
        description: "FORMAT-STRING (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Formats and allocates a date based on `FORMAT-STRING`. All format options are available [here](https://en.cppreference.com/cpp/io/manip/put_time). All of them are available and are prefixed with `%`. `FORMAT-STRING` - string, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#date)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#date",
    signature: "date FORMAT-STRING, DESTINATION"
  },
  {
    name: "sleep",
    implementation: "builtinSleep",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "SECONDS",
        variadic: false,
        optional: false,
        role: "input",
        description: "SECONDS (input)"
      }
    ],
    documentation: "Sleep for `SECONDS` seconds. `SECONDS` - number.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#sleep)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#sleep",
    signature: "sleep SECONDS"
  },
  {
    name: "swap",
    implementation: "builtinSwap",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "inout",
        description: "A (inout)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "inout",
        description: "B (inout)"
      }
    ],
    documentation: "Swap both values in the given containers. `A` - container, `B` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#swap)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#swap",
    signature: "swap A, B"
  },
  {
    name: "set",
    implementation: "builtinSet",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Store `VALUE` in `DESTINATION`. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#set)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#set",
    signature: "set VALUE, DESTINATION"
  },
  {
    name: "valtable",
    implementation: "builtinValTable",
    minimumArity: 4,
    variadic: true,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "TARGET",
        variadic: false,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      },
      {
        name: "RESULT",
        variadic: true,
        optional: false,
        role: "output",
        description: "RESULT (output)"
      },
      {
        name: "DEFAULT",
        variadic: false,
        optional: true,
        role: "input",
        description: "DEFAULT (input)"
      }
    ],
    documentation: "Checks `VALUE` against all `TARGET`s and if there is a match, store the value after the `TARGET` in `DESTINATION`. Otherwise if there is an odd number of arguments, store `DEFAULT?`, else null. Each `TARGET` must have a `RESULT` after it. `VALUE` - any value except for map, `DESTINATION` - container, `TARGET...` - any value except for map, `RESULT...` - any value, `DEFAULT?` - optional value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#valtable)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#valtable",
    signature: "valtable VALUE, DESTINATION, TARGET, RESULT, ..., DEFAULT?",
    strategy: "valtable"
  },
  {
    name: "table-contains",
    implementation: "builtinTableContains",
    minimumArity: 3,
    variadic: true,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "TARGET",
        variadic: true,
        optional: false,
        role: "input",
        description: "TARGET (input)"
      }
    ],
    documentation: "Checks whether `VALUE` matches any of the values and stores 1 in `DESTINATION` if it does, otherwise 0. `VALUE` - any value except for map, `DESTINATION` - container, `TARGET...` - any value except for map.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#table-contains)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#table-contains",
    signature: "table-contains VALUE, DESTINATION, TARGET..."
  },
  {
    name: "reg-size",
    implementation: "builtinRegSize",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the total number of registers in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#reg-size)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#reg-size",
    signature: "reg-size DESTINATION"
  },
  {
    name: "reg-at",
    implementation: "builtinRegAt",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ID",
        variadic: false,
        optional: false,
        role: "input",
        description: "ID (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the value of the register at position `ID` and store it in `DESTINATION`. Throws if `ID` is out of bounds. `ID` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#reg-at)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#reg-at",
    signature: "reg-at ID, DESTINATION"
  },
  {
    name: "reg-set",
    implementation: "builtinRegSet",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ID",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ID (inout)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Set the register at position `ID` to `VALUE`. Throws if `ID` is out of bounds. `ID` - unsigned integer, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#reg-set)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#reg-set",
    signature: "reg-set ID, VALUE"
  },
  {
    name: "return-reg-size",
    implementation: "builtinReturnRegSize",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the total number of return registers in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#return-reg-size)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#return-reg-size",
    signature: "return-reg-size DESTINATION"
  },
  {
    name: "return-reg-at",
    implementation: "builtinReturnRegAt",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ID",
        variadic: false,
        optional: false,
        role: "input",
        description: "ID (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Get the value of the return register at position `ID` and store it in `DESTINATION`. Throws if `ID` is out of bounds. `ID` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#return-reg-at)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#return-reg-at",
    signature: "return-reg-at ID, DESTINATION"
  },
  {
    name: "return-reg-set",
    implementation: "builtinReturnRegSet",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "ID",
        variadic: false,
        optional: false,
        role: "inout",
        description: "ID (inout)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Set the return register at position `ID` to `VALUE`. Throws if `ID` is out of bounds. `ID` - unsigned integer, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#return-reg-set)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#return-reg-set",
    signature: "return-reg-set ID, VALUE"
  },
  {
    name: "return-count",
    implementation: "builtinReturnCount",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the number of values returned by the last function call in `DESTINATION`. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#return-count)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#return-count",
    signature: "return-count DESTINATION"
  },
  {
    name: "func-arity",
    implementation: "builtinFuncArity",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FUNCTION",
        variadic: false,
        optional: false,
        role: "input",
        description: "FUNCTION (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the parameter count of `FUNCTION` in `DESTINATION`. `FUNCTION` - function, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#func-arity)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#func-arity",
    signature: "func-arity FUNCTION, DESTINATION"
  },
  {
    name: "func-variadic",
    implementation: "builtinFuncVariadic",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "FUNCTION",
        variadic: false,
        optional: false,
        role: "input",
        description: "FUNCTION (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores 1 in `DESTINATION` if `FUNCTION` is variadic, otherwise 0. `FUNCTION` - function, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#func-variadic)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#func-variadic",
    signature: "func-variadic FUNCTION, DESTINATION"
  },
  {
    name: "func-arg-match",
    implementation: "builtinFuncArgMatch",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "FUNCTION",
        variadic: false,
        optional: false,
        role: "input",
        description: "FUNCTION (input)"
      },
      {
        name: "ARGS",
        variadic: false,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Checks whether `ARGS` would be a valid argument count for `FUNCTION` and stores 1 in `DESTINATION` if so, otherwise 0. `FUNCTION` - function, `ARGS` - unsigned integer, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#func-arg-match)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#func-arg-match",
    signature: "func-arg-match FUNCTION, ARGS, DESTINATION"
  },
  {
    name: "make",
    implementation: "builtinMake",
    minimumArity: 3,
    variadic: true,
    parameters: [
      {
        name: "STRUCT",
        variadic: false,
        optional: false,
        role: "input",
        description: "STRUCT (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      },
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "input",
        description: "ARGS (input)"
      }
    ],
    documentation: "Create a new structure based on `STRUCT` template and store in `DESTINATION`. `ARGS...` count must match structure's field count. `STRUCT` - structure, `DESTINATION` - container, `ARGS...` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#make)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#make",
    signature: "make STRUCT, DESTINATION, ARGS...",
    strategy: "make"
  },
  {
    name: "free",
    implementation: "builtinFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "inout",
        description: "ARGS (inout)"
      }
    ],
    documentation: "Deallocates all values. Throws if an argument is not an allocated value. `ARGS...` - string, array or map.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#free)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#free",
    signature: "free ARGS..."
  },
  {
    name: "deep-free",
    implementation: "builtinDeepFree",
    minimumArity: 1,
    variadic: true,
    parameters: [
      {
        name: "ARGS",
        variadic: true,
        optional: false,
        role: "inout",
        description: "ARGS (inout)"
      }
    ],
    documentation: "Deallocates all values and deallocates all children recursively if container has any. Throws if an argument is not an allocated value. `ARGS...` - string, array or map.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#deep-free)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#deep-free",
    signature: "deep-free ARGS..."
  },
  {
    name: "copy",
    implementation: "builtinCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Shallow copy `VALUE` to `DESTINATION`. Allocates the value if it is allocated. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#copy)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#copy",
    signature: "copy VALUE, DESTINATION"
  },
  {
    name: "deep-copy",
    implementation: "builtinDeepCopy",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Deep copy `VALUE` to `DESTINATION`. Allocates the value if it is allocated and all its children. If the container contains multiple identical references to the same object, it is only copied once. `VALUE` - any value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#deep-copy)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#deep-copy",
    signature: "deep-copy VALUE, DESTINATION"
  },
  {
    name: "size",
    implementation: "builtinSize",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Takes and stores the size of `VALUE` in `DESTINATION`. If `VALUE` is not a container, stores 1. `VALUE` - any value. `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#size)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#size",
    signature: "size VALUE, DESTINATION"
  },
  {
    name: "at",
    implementation: "builtinAt",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "CONTAINER",
        variadic: false,
        optional: false,
        role: "input",
        description: "CONTAINER (input)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      },
      {
        name: "DESTINATION",
        variadic: false,
        optional: false,
        role: "output",
        description: "DESTINATION (output)"
      }
    ],
    documentation: "Stores the value at `KEY` in `DESTINATION`. For maps `KEY` is the literal key and for arrays and strings it is the index. Throws if key is of incorrect type (non-integer for strings and arrays or non-key type for maps) or if it is out of bounds. Throws if `CONTAINER` cannot be accessed. `CONTAINER` - string, array or map, `KEY` - integer/key value, `DESTINATION` - container.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#at)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#at",
    signature: "at CONTAINER, KEY, DESTINATION"
  },
  {
    name: "store",
    implementation: "builtinStore",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "CONTAINER",
        variadic: false,
        optional: false,
        role: "inout",
        description: "CONTAINER (inout)"
      },
      {
        name: "KEY",
        variadic: false,
        optional: false,
        role: "input",
        description: "KEY (input)"
      },
      {
        name: "VALUE",
        variadic: false,
        optional: false,
        role: "input",
        description: "VALUE (input)"
      }
    ],
    documentation: "Store `VALUE` at `KEY`. For maps `KEY` is the literal key and for arrays and strings it is the index. Throws if key is of incorrect type (non-integer for strings and arrays or non-key type for maps) or if it is out of bounds. Throws if `CONTAINER` cannot be accessed. `CONTAINER` - dynamic string, array or map, `KEY` - integer/key value, `VALUE` - any value.\n\n[Documentation](https://pil-esolang.github.io/built-ins/builtins/#store)",
    source: "https://pil-esolang.github.io/built-ins/builtins/#store",
    signature: "store CONTAINER, KEY, VALUE"
  }
];

// src/catalog/builtins.ts
var builtins = builtins_default;
var byName = new Map(builtins.map((b) => [b.name, b]));
var getBuiltin = (name) => byName.get(name);
var listBuiltins = () => builtins;

// src/catalog/evaluator.json
var evaluator_default = [
  {
    name: "abs",
    implementation: "MEE:abs",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Get the absolute value\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "abs(N)"
  },
  {
    name: "min",
    implementation: "MEE:min",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      }
    ],
    documentation: "Get the minimum value of the two\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "min(N1, N2)"
  },
  {
    name: "max",
    implementation: "MEE:max",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      }
    ],
    documentation: "Get the maximum value of the two\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "max(N1, N2)"
  },
  {
    name: "sqrt",
    implementation: "MEE:sqrt",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Square root\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "sqrt(N)"
  },
  {
    name: "cbrt",
    implementation: "MEE:cbrt",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Cube root\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "cbrt(N)"
  },
  {
    name: "sin",
    implementation: "MEE:sin",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Sine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "sin(N)"
  },
  {
    name: "cos",
    implementation: "MEE:cos",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Cosine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "cos(N)"
  },
  {
    name: "tan",
    implementation: "MEE:tan",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Tangent\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "tan(N)"
  },
  {
    name: "asin",
    implementation: "MEE:asin",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Arcsine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "asin(N)"
  },
  {
    name: "acos",
    implementation: "MEE:acos",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Arccosine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "acos(N)"
  },
  {
    name: "atan",
    implementation: "MEE:atan",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Arctangent\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "atan(N)"
  },
  {
    name: "atan2",
    implementation: "MEE:atan2",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "Y",
        variadic: false,
        optional: false,
        role: "input",
        description: "Y (input)"
      },
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      }
    ],
    documentation: "Arctangent of Y / X using signs of argments to determine the correct quadrant\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "atan2(Y, X)"
  },
  {
    name: "asinh",
    implementation: "MEE:asinh",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Hyperbolic arcsine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "asinh(N)"
  },
  {
    name: "acosh",
    implementation: "MEE:acosh",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Hyperbolic arccosine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "acosh(N)"
  },
  {
    name: "atanh",
    implementation: "MEE:atanh",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Hyperbolic arctangent\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "atanh(N)"
  },
  {
    name: "sinh",
    implementation: "MEE:sinh",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Hyperbolic sine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "sinh(N)"
  },
  {
    name: "cosh",
    implementation: "MEE:cosh",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Hyperbolic cosine\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "cosh(N)"
  },
  {
    name: "tanh",
    implementation: "MEE:tanh",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Hyperbolic tangent\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "tanh(N)"
  },
  {
    name: "clamp",
    implementation: "MEE:clamp",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "LO",
        variadic: false,
        optional: false,
        role: "input",
        description: "LO (input)"
      },
      {
        name: "HI",
        variadic: false,
        optional: false,
        role: "input",
        description: "HI (input)"
      }
    ],
    documentation: "Clamp X in range [LO; HI]\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "clamp(X, LO, HI)"
  },
  {
    name: "sign",
    implementation: "MEE:sign",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Get the sign\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "sign(N)"
  },
  {
    name: "trunc",
    implementation: "MEE:trunc",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Truncate float\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "trunc(N)"
  },
  {
    name: "ceil",
    implementation: "MEE:ceil",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Round to smallest integer not less than N\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "ceil(N)"
  },
  {
    name: "floor",
    implementation: "MEE:floor",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Round to largest integer not greater than N\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "floor(N)"
  },
  {
    name: "round",
    implementation: "MEE:round",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Round float to nearest integer\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "round(N)"
  },
  {
    name: "exp",
    implementation: "MEE:exp",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Euler's number raised to power N\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "exp(N)"
  },
  {
    name: "ln",
    implementation: "MEE:ln",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Natural (base e) logarithm\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "ln(N)"
  },
  {
    name: "log",
    implementation: "MEE:log",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      }
    ],
    documentation: "Base B logarithm of N using formula ln(N) / ln(B)\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "log(N, B)"
  },
  {
    name: "log2",
    implementation: "MEE:log2",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Base 2 logarithm\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "log2(N)"
  },
  {
    name: "log10",
    implementation: "MEE:log10",
    minimumArity: 1,
    variadic: false,
    parameters: [
      {
        name: "N",
        variadic: false,
        optional: false,
        role: "input",
        description: "N (input)"
      }
    ],
    documentation: "Base 10 logarithm\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "log10(N)"
  },
  {
    name: "lerp",
    implementation: "MEE:lerp",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "A",
        variadic: false,
        optional: false,
        role: "input",
        description: "A (input)"
      },
      {
        name: "B",
        variadic: false,
        optional: false,
        role: "input",
        description: "B (input)"
      },
      {
        name: "T",
        variadic: false,
        optional: false,
        role: "input",
        description: "T (input)"
      }
    ],
    documentation: "Linearly interpolate A to B based on T [0; 1]\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "lerp(A, B, T)"
  },
  {
    name: "if",
    implementation: "MEE:if",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "COND",
        variadic: false,
        optional: false,
        role: "input",
        description: "COND (input)"
      },
      {
        name: "YES",
        variadic: false,
        optional: false,
        role: "input",
        description: "YES (input)"
      },
      {
        name: "NO",
        variadic: false,
        optional: false,
        role: "input",
        description: "NO (input)"
      }
    ],
    documentation: "Returns YES if COND is truthy, otherwise NO. Computes both YES and NO regardless of COND\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "if(COND, YES, NO)"
  },
  {
    name: "pi",
    implementation: "MEE:pi",
    minimumArity: 0,
    variadic: false,
    parameters: [],
    documentation: "3.141592653589793\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "pi()"
  },
  {
    name: "tau",
    implementation: "MEE:tau",
    minimumArity: 0,
    variadic: false,
    parameters: [],
    documentation: "6.283185307179586\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "tau()"
  },
  {
    name: "e",
    implementation: "MEE:e",
    minimumArity: 0,
    variadic: false,
    parameters: [],
    documentation: "2.718281828459045\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "e()"
  },
  {
    name: "hypot",
    implementation: "MEE:hypot",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "Y",
        variadic: false,
        optional: false,
        role: "input",
        description: "Y (input)"
      }
    ],
    documentation: "Calculate \u221Ax2+y2\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "hypot(X, Y)"
  },
  {
    name: "hypot3",
    implementation: "MEE:hypot3",
    minimumArity: 3,
    variadic: false,
    parameters: [
      {
        name: "X",
        variadic: false,
        optional: false,
        role: "input",
        description: "X (input)"
      },
      {
        name: "Y",
        variadic: false,
        optional: false,
        role: "input",
        description: "Y (input)"
      },
      {
        name: "Z",
        variadic: false,
        optional: false,
        role: "input",
        description: "Z (input)"
      }
    ],
    documentation: "Calculate \u221Ax2+y2+z2\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "hypot3(X, Y, Z)"
  },
  {
    name: "gcd",
    implementation: "MEE:gcd",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      }
    ],
    documentation: "Greated common divisor\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "gcd(N1, N2)"
  },
  {
    name: "lcm",
    implementation: "MEE:lcm",
    minimumArity: 2,
    variadic: false,
    parameters: [
      {
        name: "N1",
        variadic: false,
        optional: false,
        role: "input",
        description: "N1 (input)"
      },
      {
        name: "N2",
        variadic: false,
        optional: false,
        role: "input",
        description: "N2 (input)"
      }
    ],
    documentation: "Least common multiple\n\n[Documentation](https://pil-esolang.github.io/language/cevaluator/#functions)",
    source: "https://pil-esolang.github.io/language/cevaluator/#functions",
    signature: "lcm(N1, N2)"
  }
];

// src/catalog/evaluator.ts
var builtins2 = evaluator_default;
var byName2 = new Map(builtins2.map((b) => [b.name, b]));
var getEvaluatorBuiltin = (name) => byName2.get(name);
var listEvaluatorBuiltins = () => builtins2;

// src/language/arguments.ts
function splitArguments(tokens) {
  const args = [];
  let i = 0;
  const valueEnd = (start) => {
    let j = start;
    if (tokens[j]?.kind === "register") return valueEnd(j + 1);
    if (tokens[j]?.text === "[") {
      let depth = 0;
      do {
        const t = tokens[j++];
        if (t.text === "[") depth++;
        if (t.text === "]") depth--;
      } while (j < tokens.length && depth > 0);
      return j;
    }
    j++;
    while (tokens[j]?.text === "." && tokens[j + 1]?.kind === "identifier") j += 2;
    if (tokens[j]?.text === ".") j++;
    return j;
  };
  while (i < tokens.length) {
    if (tokens[i].text === ",") {
      i++;
      continue;
    }
    const end = valueEnd(i);
    args.push(tokens.slice(i, end));
    i = end;
  }
  return args;
}
function locateCall(document, offset) {
  if (document.tokens.some((t) => t.kind === "comment" && offset >= t.span.start && offset <= t.span.end)) return;
  const statement = document.statements.find((s) => s.kind === "call" && offset >= s.span.start && offset <= s.span.end);
  if (!statement) return;
  const command = statement.tokens[0];
  if (command.kind !== "identifier") return;
  const args = splitArguments(statement.tokens.slice(1)), spans = args.map((a) => ({ start: a[0].span.start, end: a.at(-1).span.end }));
  let active = spans.findIndex((s) => offset >= s.start && offset <= s.end);
  if (active < 0) active = spans.filter((s) => s.end < offset).length;
  if (active === args.length && args.length) {
    const depth = args.at(-1).reduce((n, t) => n + (t.text === "[" ? 1 : t.text === "]" ? -1 : 0), 0);
    if (depth > 0) active--;
  }
  return { command, arguments: args, argumentSpans: spans, activeArgument: active, span: statement.span };
}

// src/language/model.ts
var contains = (span, offset) => offset >= span.start && offset < span.end;

// src/language/expressions.ts
function expressionAt(document, offset) {
  const before = document.tokens.filter((t) => t.span.start < offset && !["comment", "newline", "string", "character"].includes(t.kind));
  const stack = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i].text === "[") stack.push(i);
    if (before[i].text === "]") stack.pop();
  }
  return stack.length ? before.slice(stack[0] + 1) : void 0;
}
function evaluatorCallAt(document, offset) {
  if (document.tokens.some((t) => t.kind === "comment" && offset >= t.span.start && offset <= t.span.end)) return;
  const expression = expressionAt(document, offset);
  if (!expression) return;
  const stack = [];
  for (let i = 0; i < expression.length; i++) {
    const t = expression[i];
    if (t.text === "(") stack.push({ name: expression[i - 1]?.kind === "identifier" ? expression[i - 1].text : void 0, commas: 0 });
    else if (t.text === ")") stack.pop();
    else if (t.text === "," && stack.length) stack.at(-1).commas++;
  }
  const call = stack.slice().reverse().find((c) => c.name);
  return call?.name ? { name: call.name, activeArgument: call.commas } : void 0;
}

// src/project/resolver.ts
function functionAt(project, uri, offset) {
  return project.symbols.find((s) => s.uri === uri && s.kind === "function" && offset >= s.span.start && offset <= s.span.end);
}
function visibleSymbols(project, uri, offset) {
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
function resolveName(project, uri, offset, name) {
  const visible = visibleSymbols(project, uri, offset).filter((s) => s.name === name);
  const locals = visible.filter((s) => s.kind === "variable" || s.kind === "parameter");
  return locals.length ? locals : visible;
}
function tokenAt(project, uri, offset) {
  const tokens = project.documents.get(uri)?.tokens ?? [];
  return tokens.find((t) => contains(t.span, offset)) ?? tokens.find((t) => t.span.end === offset && t.kind === "identifier");
}
function resolveAt(project, uri, offset) {
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
function enumMembers(project, uri, offset, name) {
  const owners = visibleSymbols(project, uri, offset).filter((s) => s.kind === "enum" && s.name === name);
  if (!owners.length) return;
  const ids = new Set(owners.map((s) => s.id));
  const doc = project.documents.get(uri), token = doc?.tokens.filter((t) => t.span.start <= offset).at(-1);
  const order = token ? project.order.get(`${uri}#${token.span.start}`) ?? Infinity : Infinity;
  return project.symbols.filter((s) => s.kind === "enumMember" && ids.has(s.parentId) && (project.order.get(s.id) ?? Infinity) <= order);
}

// src/language/structs.ts
function inferStructCandidates(project, symbolId, before = Infinity, fromUri) {
  const symbol = project.symbols.find((s) => s.id === symbolId);
  if (!symbol) return [];
  const fn = symbol.kind === "global" && fromUri ? functionAt(project, fromUri, before) : project.symbols.find((s) => s.id === symbol.parentId);
  const doc = project.documents.get(fromUri ?? symbol.uri);
  if (!fn || !doc) return [];
  const known = /* @__PURE__ */ new Map();
  const writes = /* @__PURE__ */ new Set();
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
function fieldCandidates(project, uri, offset, receiver) {
  const locals = resolveName(project, uri, offset, receiver);
  const structs = locals.flatMap((s) => inferStructCandidates(project, s.id, offset, uri));
  const ids = new Set(structs.map((s) => s.id));
  return { fields: project.symbols.filter((s) => s.kind === "field" && (!ids.size || ids.has(s.parentId))), known: ids.size > 0 };
}

// src/features/completion.ts
function callSnippet(name, parameters, minimumArity = 0) {
  let slots = parameters.filter((p) => !p.optional);
  const variadic = slots.findIndex((p) => p.variadic);
  if (slots.length < minimumArity && variadic >= 0) {
    const group = slots[variadic], count = minimumArity - slots.length + 1;
    slots = [...slots.slice(0, variadic), ...Array.from({ length: count }, (_, i) => ({ ...group, name: group.name.replace(/S$/, "") + (i + 1) })), ...slots.slice(variadic + 1)];
  }
  const args = slots.map((p, i) => `\${${i + 1}:${p.name}}`);
  return name + (args.length ? " " + args.join(", ") : "") + ";";
}
function complete(project, uri, offset) {
  const doc = project.documents.get(uri);
  if (!doc) return [];
  const at = doc.tokens.find((t) => offset > t.span.start && offset <= t.span.end);
  if (at && ["comment", "string", "character"].includes(at.kind)) return [];
  const before = doc.text.slice(0, offset), line = before.slice(before.lastIndexOf("\n") + 1);
  const match = line.match(/[A-Za-z_][A-Za-z0-9_-]*$|@[A-Za-z0-9_-]*$|(?:[Rr])?\$[0-9]*$/);
  const prefix = match?.[0] ?? "", span = { start: offset - prefix.length, end: offset };
  const finish = (items) => items.filter((i) => i.label.startsWith(prefix));
  const member = line.match(/([A-Za-z_][A-Za-z0-9_-]*)\.([A-Za-z0-9_-]*)$/);
  if (member) {
    const enumeration = enumMembers(project, uri, offset, member[1]);
    if (enumeration) return enumeration.filter((f) => f.name.startsWith(member[2])).map((f) => ({ label: f.name, kind: "enumMember", insertText: f.name, span: { start: offset - member[2].length, end: offset }, detail: `${member[1]}.${f.name}${f.value !== void 0 ? " = " + f.value : ""}` }));
    const { fields, known } = fieldCandidates(project, uri, offset, member[1]);
    return fields.filter((f) => f.name.startsWith(member[2])).map((f) => ({ label: f.name, kind: "field", insertText: f.name, span: { start: offset - member[2].length, end: offset }, detail: `${project.symbols.find((s) => s.id === f.parentId)?.name} field${known ? "" : " (receiver type unknown)"}` }));
  }
  if (expressionAt(doc, offset)) {
    const functions = listEvaluatorBuiltins().map((b) => ({ label: b.name, kind: "builtin", insertText: b.name + "(" + b.parameters.map((p, i) => `\${${i + 1}:${p.name}}`).join(", ") + ")", snippet: true, span, documentation: b.documentation, detail: b.signature }));
    const constants = visibleSymbols(project, uri, offset).filter((s) => ["constant", "enum", "enumMember"].includes(s.kind)).map((s) => ({ label: s.name, kind: s.kind, insertText: s.name, span, detail: s.kind }));
    return finish([...functions, ...constants]);
  }
  const directives = ["@include", "@reg-size", "@return-reg-size"].map((label) => ({ label, kind: "directive", insertText: label, span }));
  if (prefix.startsWith("@")) return finish(directives);
  const c = locateCall(doc, offset);
  const statement = !c || offset <= c.command.span.end;
  let symbols = visibleSymbols(project, uri, offset);
  if (!statement && c) {
    if (c.command.text === "goto" && c.activeArgument === 0 || ["jmp", "jmpn"].includes(c.command.text) && c.activeArgument === 1) symbols = symbols.filter((s) => s.kind === "label");
    if (c.command.text === "make" && c.activeArgument === 0) symbols = symbols.filter((s) => s.kind === "struct");
  }
  const result = symbols.filter((s) => !statement || s.kind === "function").map((s) => ({ label: s.name, kind: s.kind, insertText: statement && s.kind === "function" ? callSnippet(s.name, s.parameters) : s.name, snippet: statement && s.kind === "function", span, documentation: s.documentation, detail: s.kind === "function" ? `${s.name}(${s.parameters.map((p) => p.name + (p.variadic ? "..." : "")).join(", ")})` : s.kind }));
  const restricted = c && !statement && (c.command.text === "make" && c.activeArgument === 0 || c.command.text === "goto" && c.activeArgument === 0 || ["jmp", "jmpn"].includes(c.command.text) && c.activeArgument === 1);
  if (!restricted) {
    const callTarget = c && ["call", "func-call", "catch"].includes(c.command.text);
    if (statement || callTarget) result.push(...listBuiltins().map((b) => ({ label: b.name, kind: "builtin", insertText: statement ? callSnippet(b.name, b.parameters, b.minimumArity) : b.name, snippet: statement, span, documentation: b.documentation, detail: b.signature })));
    if (statement) result.push(...directives, ...["local", "const", "global", "enum", "enum array", "struct", "struct array"].map((label) => ({ label, kind: "directive", insertText: label, span })));
    if (!statement) {
      for (const [prefix2, directive, defaultCount] of [["$", "@reg-size", 16], ["R$", "@return-reg-size", 4]]) {
        let count = defaultCount;
        for (const d of project.documents.values()) for (let i = 0; i < d.tokens.length; i++) if (d.tokens[i].text === directive && d.tokens[i + 1]?.kind === "number") count = Number(d.tokens[i + 1].text);
        for (let i = 0; i < Math.min(count, 256); i++) result.push({ label: prefix2 + i, kind: "register", insertText: prefix2 + i, span });
      }
    }
  }
  return finish(result);
}

// src/features/hover.ts
function symbolSignature(s, parent) {
  if (s.kind === "function") return `${s.name}(${s.parameters.map((p) => p.variadic ? "..." : p.name).join(", ")})`;
  if (s.kind === "struct") return `struct ${s.name} (${s.parameters.map((p) => p.name).join(", ")})`;
  if (s.kind === "enum") return `enum ${s.name}`;
  if (s.kind === "enumMember") return `${parent?.name ? parent.name + "." : ""}${s.name}${s.value !== void 0 ? " = " + s.value : ""}`;
  return `${s.kind === "constant" ? "const" : s.kind} ${s.name}${s.value !== void 0 ? " = " + s.value : ""}`;
}
function hoverAt(project, uri, offset) {
  const s = resolveAt(project, uri, offset)[0];
  if (s) return { signature: symbolSignature(s, project.symbols.find((p) => p.id === s.parentId)), documentation: s.documentation };
  const t = tokenAt(project, uri, offset), doc = project.documents.get(uri);
  const b = t?.kind === "identifier" ? doc && expressionAt(doc, t.span.start) ? getEvaluatorBuiltin(t.text) : getBuiltin(t.text) : void 0;
  if (b) return { signature: b.signature, documentation: b.documentation };
}

// src/features/signature-help.ts
var param = (name, role = "input") => ({ name, variadic: false, role });
function signatureAt(project, uri, offset) {
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
  const names = c.arguments.map((a) => a.length === 1 && a[0].kind === "identifier" ? a[0].text : void 0);
  if (["call", "func-call", "catch"].includes(c.command.text)) {
    const start = c.command.text === "catch" ? 1 : 0;
    const candidates = c.command.text === "call" ? names.map((_, i) => i).filter((i) => i >= start) : [start];
    for (const index of candidates) {
      const name = names[index];
      if (!name) continue;
      const resolved = resolveName(project, uri, c.argumentSpans[index].start, name);
      const target = resolved.find((s) => s.kind === "function");
      const builtin = resolved.length ? void 0 : getBuiltin(name);
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
function parameterRanges(signature) {
  const opening = signature.label.indexOf("("), space = signature.label.indexOf(" ");
  let search = opening >= 0 && (space < 0 || opening < space) ? opening + 1 : space + 1;
  return signature.parameters.map((parameter) => {
    const label = parameter.name + (parameter.variadic ? "..." : "") + (parameter.optional ? "?" : "");
    const start = signature.label.indexOf(label, search);
    search = start + label.length;
    return [start, search];
  });
}

// src/features/definition.ts
function definitionsAt(project, uri, offset) {
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

// src/features/symbols.ts
function documentSymbols(document) {
  const trees = new Map(document.declarations.map((symbol) => [symbol.id, { symbol, children: [] }]));
  const roots = [];
  for (const tree of trees.values()) {
    const parent = tree.symbol.parentId ? trees.get(tree.symbol.parentId) : void 0;
    if (parent) parent.children.push(tree);
    else roots.push(tree);
  }
  return roots;
}
function workspaceSymbols(query, projects) {
  const seen = /* @__PURE__ */ new Set();
  return projects.flatMap((p) => p.symbols).filter((s) => {
    if (["variable", "parameter"].includes(s.kind) || !s.name.toLowerCase().includes(query.toLowerCase()) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// src/features/references.ts
function referencesTo(project, symbolId) {
  const found = [];
  for (const doc of project.documents.values()) for (const t of doc.references) {
    if (resolveAt(project, doc.uri, t.span.start).some((s) => s.id === symbolId)) found.push({ uri: doc.uri, span: t.span });
  }
  return found;
}

// src/features/semantic-tokens.ts
var tokenTypes = ["function", "struct", "parameter", "variable", "property", "label", "enum", "enumMember"];
var tokenModifiers = ["declaration", "readonly", "defaultLibrary"];
var types = { function: "function", struct: "struct", parameter: "parameter", variable: "variable", global: "variable", field: "property", label: "label", constant: "variable", enum: "enum", enumMember: "enumMember" };
function semanticTokens(project, uri) {
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

// src/features/builtin-documents.ts
function builtinDocument(name, evaluator = false) {
  const b = evaluator ? getEvaluatorBuiltin(name) : getBuiltin(name);
  if (!b) return `Unknown PIL builtin: ${name}`;
  return `${b.signature}

${b.documentation}

Parameters:
${b.parameters.map((p) => `  ${p.name}${p.variadic ? "..." : ""}${p.optional ? "?" : ""} \u2014 ${p.description ?? p.role ?? "value"}`).join("\n")}

Minimum arguments: ${b.minimumArity}${b.variadic ? " (variadic)" : ""}

Documentation: ${b.source}
`;
}

// src/extension.ts
var kinds = { function: vscode2.SymbolKind.Function, struct: vscode2.SymbolKind.Struct, field: vscode2.SymbolKind.Field, label: vscode2.SymbolKind.Key, constant: vscode2.SymbolKind.Constant, global: vscode2.SymbolKind.Variable, enum: vscode2.SymbolKind.Enum, enumMember: vscode2.SymbolKind.EnumMember, variable: vscode2.SymbolKind.Variable, parameter: vscode2.SymbolKind.Variable };
var completionKinds = { function: vscode2.CompletionItemKind.Function, struct: vscode2.CompletionItemKind.Struct, field: vscode2.CompletionItemKind.Field, label: vscode2.CompletionItemKind.Reference, constant: vscode2.CompletionItemKind.Constant, global: vscode2.CompletionItemKind.Variable, enum: vscode2.CompletionItemKind.Enum, enumMember: vscode2.CompletionItemKind.EnumMember, variable: vscode2.CompletionItemKind.Variable, parameter: vscode2.CompletionItemKind.Variable, builtin: vscode2.CompletionItemKind.Function, directive: vscode2.CompletionItemKind.Keyword, register: vscode2.CompletionItemKind.Variable, file: vscode2.CompletionItemKind.File };
var range = (d, s) => new vscode2.Range(d.positionAt(s.start), d.positionAt(s.end));
var markdown = (signature, documentation) => new vscode2.MarkdownString().appendCodeblock(signature, "pil").appendMarkdown(documentation ? "\n\n" + documentation : "");
async function location(target) {
  const uri = vscode2.Uri.parse(target.uri);
  if (target.span.start === 0 && target.span.end === 0) return new vscode2.Location(uri, new vscode2.Position(0, 0));
  const d = await vscode2.workspace.openTextDocument(uri);
  return new vscode2.Location(uri, range(d, target.span));
}
function activate(context) {
  const service = new ProjectService();
  context.subscriptions.push(service);
  const selector = [{ language: "pil", scheme: "file" }, { language: "pil", scheme: "untitled" }];
  const diagnostics = vscode2.languages.createDiagnosticCollection("pil");
  context.subscriptions.push(diagnostics);
  const analyze = async (d, token) => {
    const version = d.version, p = await service.get(d, token);
    if (!token?.isCancellationRequested && d.version === version) {
      diagnostics.set(d.uri, p.issues.filter((i) => i.uri === d.uri.toString()).map((i) => new vscode2.Diagnostic(range(d, i.span), i.message, vscode2.DiagnosticSeverity.Warning)));
    }
    return p;
  };
  let timer;
  context.subscriptions.push(vscode2.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId !== "pil") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void analyze(e.document).catch(() => {
      });
    }, 150);
  }), vscode2.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)), { dispose: () => {
    if (timer) clearTimeout(timer);
  } });
  context.subscriptions.push(vscode2.workspace.registerTextDocumentContentProvider("pil-builtin", { provideTextDocumentContent: (uri) => builtinDocument(uri.path.slice(1)) }));
  context.subscriptions.push(vscode2.workspace.registerTextDocumentContentProvider("pil-evaluator", { provideTextDocumentContent: (uri) => builtinDocument(uri.path.slice(1), true) }));
  context.subscriptions.push(vscode2.languages.registerCompletionItemProvider(selector, {
    async provideCompletionItems(d, pos, token) {
      const p = await analyze(d, token);
      if (token.isCancellationRequested) return [];
      const offset = d.offsetAt(pos), parsed = p.documents.get(d.uri.toString()), include = parsed ? includeCompletionContext(parsed, offset) : void 0;
      if (include) {
        try {
          const directory = vscode2.Uri.parse(service.resolvePath(p.entryUri, include.directoryPart));
          const entries = await vscode2.workspace.fs.readDirectory(directory);
          return entries.filter(([name, type]) => name.startsWith(include.prefix) && (type === vscode2.FileType.Directory || name.endsWith(".pil"))).map(([name, type]) => {
            const item = new vscode2.CompletionItem(name, type === vscode2.FileType.Directory ? vscode2.CompletionItemKind.Folder : vscode2.CompletionItemKind.File);
            item.insertText = name + (type === vscode2.FileType.Directory ? "/" : "");
            item.range = range(d, include.span);
            return item;
          });
        } catch {
          return [];
        }
      }
      return complete(p, d.uri.toString(), offset).map((c) => {
        const item = new vscode2.CompletionItem(c.label, completionKinds[c.kind]);
        item.detail = c.detail;
        item.documentation = markdown(c.detail ?? c.label, c.documentation);
        item.range = range(d, c.span);
        item.insertText = c.snippet ? new vscode2.SnippetString(c.insertText) : c.insertText;
        if (c.snippet) item.command = { command: "editor.action.triggerParameterHints", title: "Show PIL parameters" };
        return item;
      });
    }
  }, ".", "@", "$", "/", '"'));
  context.subscriptions.push(vscode2.languages.registerSignatureHelpProvider(selector, {
    async provideSignatureHelp(d, pos, token) {
      const p = await analyze(d, token);
      if (token.isCancellationRequested) return;
      const s = signatureAt(p, d.uri.toString(), d.offsetAt(pos));
      if (!s) return;
      const help = new vscode2.SignatureHelp(), signature = new vscode2.SignatureInformation(s.label, s.documentation ? new vscode2.MarkdownString(s.documentation) : void 0);
      signature.parameters = parameterRanges(s).map((label, index) => {
        const param2 = s.parameters[index];
        return new vscode2.ParameterInformation(label, param2.description ?? param2.role);
      });
      help.signatures = [signature];
      help.activeSignature = 0;
      help.activeParameter = s.activeParameter;
      return help;
    }
  }, " ", ",", "("));
  context.subscriptions.push(vscode2.languages.registerHoverProvider(selector, { async provideHover(d, pos, token) {
    const p = await analyze(d, token);
    const h = hoverAt(p, d.uri.toString(), d.offsetAt(pos));
    return h ? new vscode2.Hover(markdown(h.signature, h.documentation)) : void 0;
  } }));
  context.subscriptions.push(vscode2.languages.registerDefinitionProvider(selector, { async provideDefinition(d, pos, token) {
    const p = await analyze(d, token);
    if (token.isCancellationRequested) return [];
    return Promise.all(definitionsAt(p, d.uri.toString(), d.offsetAt(pos)).map(location));
  } }));
  context.subscriptions.push(vscode2.languages.registerDocumentSymbolProvider(selector, { async provideDocumentSymbols(d, token) {
    const p = await analyze(d, token), doc = p.documents.get(d.uri.toString());
    if (!doc) return [];
    const tree = (t) => {
      const s = t.symbol, result = new vscode2.DocumentSymbol(s.name, symbolSignature(s), kinds[s.kind], range(d, s.span), range(d, s.nameSpan));
      result.children = t.children.map(tree);
      return result;
    };
    return documentSymbols(doc).map(tree);
  } }));
  context.subscriptions.push(vscode2.languages.registerWorkspaceSymbolProvider({ async provideWorkspaceSymbols(query, token) {
    const projects = await service.all(token);
    return Promise.all(workspaceSymbols(query, projects).map(async (s) => new vscode2.SymbolInformation(s.name, kinds[s.kind], s.parentId ? projects.flatMap((p) => p.symbols).find((p) => p.id === s.parentId)?.name ?? "" : "", await location({ uri: s.uri, span: s.nameSpan }))));
  } }));
  context.subscriptions.push(vscode2.languages.registerReferenceProvider(selector, { async provideReferences(d, pos, referenceContext, token) {
    const p = await analyze(d, token), symbols = resolveAt(p, d.uri.toString(), d.offsetAt(pos)), projects = await service.all(token), seen = /* @__PURE__ */ new Set();
    const targets = symbols.flatMap((s) => [...projects.flatMap((project) => referencesTo(project, s.id)), ...referenceContext.includeDeclaration ? [{ uri: s.uri, span: s.nameSpan }] : []]).filter((t) => {
      const key = `${t.uri}#${t.span.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return Promise.all(targets.map(location));
  } }));
  const legend = new vscode2.SemanticTokensLegend([...tokenTypes], [...tokenModifiers]);
  context.subscriptions.push(vscode2.languages.registerDocumentSemanticTokensProvider(selector, { async provideDocumentSemanticTokens(d, token) {
    const p = await analyze(d, token), builder = new vscode2.SemanticTokensBuilder(legend);
    for (const t of semanticTokens(p, d.uri.toString())) builder.push(range(d, t.span), t.type, t.modifiers);
    return builder.build();
  } }, legend));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate
});
//# sourceMappingURL=extension.js.map
