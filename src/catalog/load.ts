import type { BuiltinInfo, ParameterInfo, RawBuiltin, RawEvaluatorFunction } from "../types";

const label = (p: ParameterInfo) => p.name + (p.variadic ? "..." : "") + (p.optional ? "?" : "");

export function loadBuiltin(raw: RawBuiltin): BuiltinInfo {
	const parameters: ParameterInfo[] = raw.params.map(([name, role, flag]) => ({
		name,
		role,
		variadic: flag === "variadic",
		optional: flag === "optional",
	}));
	const info: BuiltinInfo = {
		name: raw.name,
		minimumArity: raw.args,
		variadic: parameters.some((p) => p.variadic),
		parameters,
		documentation: raw.docs,
		signature: raw.code ?? (parameters.length ? `${raw.name} ${parameters.map(label).join(", ")}` : raw.name),
	};
	if (raw.strategy) info.strategy = raw.strategy;
	return info;
}

export function loadEvaluatorFunction(raw: RawEvaluatorFunction): BuiltinInfo {
	return {
		name: raw.name,
		minimumArity: raw.params.length,
		variadic: false,
		parameters: raw.params.map((name) => ({ name, role: "input", variadic: false, optional: false })),
		documentation: raw.docs,
		signature: `${raw.name}(${raw.params.join(", ")})`,
	};
}