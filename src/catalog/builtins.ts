import type { BuiltinInfo, RawBuiltin } from "../types";
import data from "./builtins.json";
import { loadBuiltin } from "./load";

export const builtins: BuiltinInfo[] = (data as unknown as RawBuiltin[]).map(loadBuiltin);
const byName = new Map(builtins.map((b) => [b.name, b]));
export const getBuiltin = (name: string): BuiltinInfo | undefined => byName.get(name);
export const listBuiltins = (): BuiltinInfo[] => builtins;
