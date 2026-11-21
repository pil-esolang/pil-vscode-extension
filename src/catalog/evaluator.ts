import type { BuiltinInfo } from "../types";
import data from "./evaluator.json";

// Constant evaluator functions (the `[ ... ]` expressions). Generated like builtins.json.
export const evaluatorBuiltins = data as BuiltinInfo[];
const byName = new Map(evaluatorBuiltins.map((b) => [b.name, b]));
export const getEvaluatorBuiltin = (name: string): BuiltinInfo | undefined => byName.get(name);
export const listEvaluatorBuiltins = (): BuiltinInfo[] => evaluatorBuiltins;
