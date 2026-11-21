import type { BuiltinInfo } from "../types";
import data from "./builtins.json";

// Generated from the PIL interpreter + documentation by scripts/import-upstream.mjs.
export const builtins = data as BuiltinInfo[];
const byName = new Map(builtins.map((b) => [b.name, b]));
export const getBuiltin = (name: string): BuiltinInfo | undefined => byName.get(name);
export const listBuiltins = (): BuiltinInfo[] => builtins;
