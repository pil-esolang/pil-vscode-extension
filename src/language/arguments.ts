export function splitArguments(tokens) {
  const args = [];
  let i = 0;
  const valueEnd = (start) => {
    let j = start;
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
export function locateCall(document, offset) {
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
