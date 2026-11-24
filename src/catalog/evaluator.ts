import type { BuiltinInfo, RawEvaluatorFunction } from "../types";
import data from "./evaluator.json";
import { loadEvaluatorFunction } from "./load";

export const evaluatorBuiltins: BuiltinInfo[] = (data as RawEvaluatorFunction[]).map(loadEvaluatorFunction);
const byName = new Map(evaluatorBuiltins.map((b) => [b.name, b]));
export const getEvaluatorBuiltin = (name: string): BuiltinInfo | undefined => byName.get(name);
export const listEvaluatorBuiltins = (): BuiltinInfo[] => evaluatorBuiltins;
