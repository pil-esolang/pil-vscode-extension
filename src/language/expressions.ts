export function expressionAt(document, offset) {
  const before = document.tokens.filter((t) => t.span.start < offset && !["comment", "newline", "string", "character"].includes(t.kind));
  const stack = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i].text === "[") stack.push(i);
    if (before[i].text === "]") stack.pop();
  }
  return stack.length ? before.slice(stack[0] + 1) : undefined;
}
export function evaluatorCallAt(document, offset) {
  if (document.tokens.some((t) => t.kind === "comment" && offset >= t.span.start && offset <= t.span.end)) return;
  const expression = expressionAt(document, offset);
  if (!expression) return;
  const stack = [];
  for (let i = 0; i < expression.length; i++) {
    const t = expression[i];
    if (t.text === "(") stack.push({ name: expression[i - 1]?.kind === "identifier" ? expression[i - 1].text : undefined, commas: 0 });
    else if (t.text === ")") stack.pop();
    else if (t.text === "," && stack.length) stack.at(-1).commas++;
  }
  const call = stack.slice().reverse().find((c) => c.name);
  return call?.name ? { name: call.name, activeArgument: call.commas } : undefined;
}
