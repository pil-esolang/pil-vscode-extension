import * as vscode from "vscode";
import { ProjectIndex } from "./index";
import { includeUri } from "./includes";
import { selectProgram } from "./context";

export const ProjectService = class {
  index;
  paths = new Set();
  versions = new Map();
  snapshots = new Map();
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
      const entryUri = entry ? includeUri(uri.scheme === "file" ? uri.toString() : vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.file(process.cwd()), "untitled.pil").toString(), entry, folder?.uri.toString()) : undefined;
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
