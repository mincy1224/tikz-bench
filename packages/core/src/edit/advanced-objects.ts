import type { Span } from "../ast/types.js";
import { parseOptionListRaw, splitTopLevel } from "../options/parse.js";

export type AdvancedObject = {
  id: string; type: string; label: string; family: "forest" | "plot" | "circuit";
  span: Span; content?: Span; options: Span; optionPrefix: string;
  parentId?: string; children: string[]; environment: Span;
  data?: { span: Span; x: string; y: string }[];
  endpoints?: Span[];
};
export type AdvancedDocument = { source: string; objects: AdvancedObject[] };

export function texCodeMask(source: string): string {
  // Preserve offsets while excluding comments from structural recognition.
  return source.replace(/(^|[^\\])%[^\r\n]*/gu, (match, prefix: string) => prefix + " ".repeat(match.length - prefix.length));
}
export function balancedEnd(source: string, start: number, open = source[start], close = open === "[" ? "]" : open === "(" ? ")" : "}"): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "%") { while (i < source.length && source[i] !== "\n") i++; continue; }
    // Braced content may contain literal brackets or parentheses.
    if (open !== "{" && source[i] === "{") { i = balancedEnd(source, i) - 1; continue; }
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return i + 1;
    // Only closing tokens decrement their own nesting level.
    if (source[i] === close && depth < 0) break;
  }
  throw new Error(`Unclosed ${open} at ${start}`);
}
function trimmed(source: string, from: number, to: number): Span {
  while (from < to && /\s/u.test(source[from])) from++;
  while (to > from && /\s/u.test(source[to - 1])) to--;
  return { from, to };
}
function headerBoundary(source: string, from: number, to: number, tokens: string): number {
  for (let i = from; i < to; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "%") { while (i < to && source[i] !== "\n") i++; continue; }
    if (source[i] === "{") { i = balancedEnd(source, i) - 1; continue; }
    if (tokens.includes(source[i])) return i;
  }
  return to;
}
function optionalOptions(source: string, from: number): { span: Span; end: number } {
  while (/\s/u.test(source[from] ?? "")) from++;
  if (source[from] !== "[") return { span: { from, to: from }, end: from };
  const end = balancedEnd(source, from);
  return { span: { from, to: end }, end };
}

export function parseAdvancedObjects(source: string): AdvancedDocument {
  const mask = texCodeMask(source); const objects: AdvancedObject[] = [];
  let environmentIndex = 0;
  for (const match of mask.matchAll(/\\begin\{(forest|axis|semilogxaxis|semilogyaxis|loglogaxis|groupplot|circuitikz)\}/gu)) {
    const kind = match[1]; const endToken = `\\end{${kind}}`;
    const end = mask.indexOf(endToken, match.index + match[0].length);
    if (end < 0) continue;
    const environment = { from: match.index, to: end + endToken.length };
    const prefix = `advanced:${environmentIndex++}`;
    if (kind === "forest") {
      const rootStart = headerBoundary(source, match.index + match[0].length, end, "[");
      const visit = (start: number, path: string, parentId?: string): AdvancedObject => {
        const finish = balancedEnd(source, start);
        const first = headerBoundary(source, start + 1, finish - 1, ",[");
        let content = trimmed(source, start + 1, first);
        if (source[content.from] === "{" && balancedEnd(source, content.from) === content.to) content = { from: content.from + 1, to: content.to - 1 };
        const childStart = headerBoundary(source, first + (source[first] === "," ? 1 : 0), finish - 1, "[");
        const object: AdvancedObject = { id: `${prefix}:forest:${path}`, type: "forest:node", label: source.slice(content.from, content.to), family: "forest", span: { from: start, to: finish }, content,
          options: { from: first + (source[first] === "," ? 1 : 0), to: childStart }, optionPrefix: source[first] === "," ? "" : ",", parentId, children: [], environment };
        objects.push(object);
        let position = childStart; let childIndex = 0;
        while (position < finish - 1) {
          position = headerBoundary(source, position, finish - 1, "[");
          if (position >= finish - 1) break;
          const child = visit(position, `${path}.${childIndex++}`, object.id);
          object.children.push(child.id); position = child.span.to;
        }
        return object;
      };
      if (rootStart < end) { try { visit(rootStart, "0"); } catch { /* Incomplete source remains editable in the source pane. */ } }
      continue;
    }
    if (kind !== "circuitikz") {
      const options = optionalOptions(source, match.index + match[0].length);
      const axis: AdvancedObject = { id: `${prefix}:axis`, type: `plot:${kind}`, label: "坐标轴", family: "plot", span: environment, options: options.span, optionPrefix: "[]", children: [], environment };
      objects.push(axis);
      let plotIndex = 0;
      for (const plot of mask.slice(options.end, end).matchAll(/\\addplot\+?(?![A-Za-z])/gu)) {
        const start = options.end + plot.index;
        const plotOptions = optionalOptions(source, start + plot[0].length);
        const semicolon = headerBoundary(source, plotOptions.end, end, ";");
        const body = source.slice(plotOptions.end, semicolon);
        const data: NonNullable<AdvancedObject["data"]> = [];
        const coordinateMatch = /\bcoordinates\s*\{/u.exec(texCodeMask(body));
        let content: Span | undefined;
        if (coordinateMatch) {
          const open = plotOptions.end + coordinateMatch.index + coordinateMatch[0].length - 1;
          const finish = balancedEnd(source, open);
          for (const pair of source.slice(open + 1, finish - 1).matchAll(/\(([^,()]+),([^()]+)\)/gu)) {
            const from = open + 1 + pair.index;
            data.push({ span: { from, to: from + pair[0].length }, x: pair[1].trim(), y: pair[2].trim() });
          }
          content = { from: open + 1, to: finish - 1 };
        } else {
          const open = source.indexOf("{", plotOptions.end);
          if (open >= 0 && open < semicolon) content = { from: open + 1, to: balancedEnd(source, open) - 1 };
        }
        const rawOptions = source.slice(plotOptions.span.from, plotOptions.span.to);
        const type = /boxplot/u.test(rawOptions) ? "boxplot" : /[xy]bar/u.test(source.slice(options.span.from, options.span.to) + rawOptions) ? "bar" : /only marks/u.test(rawOptions) ? "scatter" : coordinateMatch ? "line" : "function";
        const object: AdvancedObject = { id: `${prefix}:plot:${plotIndex++}`, type: `plot:${type}`, label: `曲线 ${plotIndex}`, family: "plot", span: { from: start, to: semicolon + 1 }, options: plotOptions.span, optionPrefix: "[]", parentId: axis.id, children: [], environment, data, content };
        axis.children.push(object.id); objects.push(object);
      }
      continue;
    }
    let circuitIndex = 0;
    for (const component of mask.slice(match.index + match[0].length, end).matchAll(/\b(to|node)\s*\[/gu)) {
      const start = match.index + match[0].length + component.index;
      const open = start + component[0].lastIndexOf("["); const finish = balancedEnd(source, open);
      const entries = parseOptionListRaw(source.slice(open, finish)).entries;
      const kinds = ["R", "C", "L", "V", "I", "D", "led", "sD", "switch", "closing switch", "opening switch", "ground", "op amp", "npn", "pnp", "nmos", "pmos", "nfet", "pfet", "short", "resistor", "capacitor", "inductor", "battery"];
      const type = entries.find((entry) => entry.kind !== "unknown" && kinds.includes(entry.key));
      if (!type || type.kind === "unknown") continue;
      const after = optionalOptions(source, finish).end;
      let componentEnd = finish; let content: Span | undefined; const endpoints: Span[] = [];
      if (component[1] === "to") {
        const previous = mask.lastIndexOf(")", start); const before = previous >= 0 ? mask.lastIndexOf("(", previous) : -1;
        if (before >= 0) endpoints.push({ from: before, to: previous + 1 });
        if (source[after] === "(") { componentEnd = balancedEnd(source, after); endpoints.push({ from: after, to: componentEnd }); }
      } else {
        const brace = source.indexOf("{", finish); const semicolon = source.indexOf(";", finish);
        const placement = /\bat\s*\(/u.exec(mask.slice(finish, semicolon));
        if (placement) { const from = finish + placement.index + placement[0].lastIndexOf("("); endpoints.push({ from, to: balancedEnd(source, from) }); }
        if (brace >= 0 && brace < semicolon) { componentEnd = balancedEnd(source, brace); content = { from: brace + 1, to: componentEnd - 1 }; }
      }
      objects.push({ id: `${prefix}:circuit:${circuitIndex++}`, type: `circuit:${type.key}`, label: type.key, family: "circuit", span: { from: start, to: componentEnd }, options: { from: open, to: finish }, optionPrefix: "[]", children: [], environment, content, endpoints });
    }
  }
  return { source, objects };
}

export function advancedObject(source: string, id: string): AdvancedObject {
  const object = parseAdvancedObjects(source).objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error("对象已改变，请重新选择。");
  return object;
}
export function advancedOptionValues(source: string, object: AdvancedObject): Map<string, string> {
  const raw = source.slice(object.options.from, object.options.to);
  return new Map(parseOptionListRaw(object.optionPrefix === "[]" && raw ? raw : `[${raw}]`).entries.flatMap((entry) => entry.kind === "unknown" ? [] : [[entry.key, entry.kind === "kv" ? entry.valueRaw : "true"] as const]));
}
/** Resolve supported Forest tree defaults without rewriting the shared policy. */
export function advancedEffectiveOptions(source: string, object: AdvancedObject): Map<string, string> {
  if (object.family !== "forest") return advancedOptionValues(source, object);
  const prefix = source.slice(object.environment.from, parseAdvancedObjects(source).objects.find((candidate) => candidate.environment.from === object.environment.from)?.span.from ?? object.span.from);
  const inherited = new Map<string, string>();
  const defaults = /for tree\s*=\s*\{/u.exec(texCodeMask(prefix));
  if (defaults) {
    const start = defaults.index + defaults[0].length - 1;
    const end = balancedEnd(prefix, start);
    for (const entry of parseOptionListRaw(`[${prefix.slice(start + 1, end - 1)}]`).entries) if (entry.kind !== "unknown") inherited.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
  }
  for (const [key, value] of advancedOptionValues(source, object)) inherited.set(key, value);
  return inherited;
}
export function setAdvancedOption(source: string, id: string, key: string, value: string): string {
  const object = advancedObject(source, id);
  const raw = source.slice(object.options.from, object.options.to);
  const body = object.optionPrefix === "[]" ? raw.replace(/^\[|\]$/gu, "") : raw;
  const entries = splitTopLevel(body, ",").filter((entry) => entry.trim() && entry.trim().split("=")[0].trim() !== key);
  if (value.trim()) entries.push(value === "true" ? key : `${key}=${value}`);
  const replacement = object.optionPrefix === "[]" ? entries.length ? `[${entries.join(",")}]` : "" : `${object.optionPrefix}${entries.join(",")} `;
  return source.slice(0, object.options.from) + replacement + source.slice(object.options.to);
}
export function setAdvancedContent(source: string, id: string, value: string): string {
  const object = advancedObject(source, id);
  if (!object.content) throw new Error("此对象没有可编辑正文。");
  return source.slice(0, object.content.from) + value + source.slice(object.content.to);
}
export function editForestStructure(source: string, id: string, operation: "child" | "sibling" | "delete" | "promote"): string {
  const object = advancedObject(source, id);
  if (object.family !== "forest") throw new Error("请选择树节点。");
  if (operation === "sibling" && !object.parentId) throw new Error("根节点不能添加同级节点。");
  if (operation === "child" || operation === "sibling") {
    const at = operation === "child" ? object.span.to - 1 : object.span.to;
    return source.slice(0, at) + "\n[{新节点}]\n" + source.slice(at);
  }
  if (operation === "promote" && !object.parentId && object.children.length !== 1) throw new Error("根节点只能提升唯一子节点；多个子节点需要保留共同根节点。");
  if (operation === "delete" && !object.parentId) return source.slice(0, object.environment.from) + source.slice(object.environment.to);
  const replacement = operation === "promote" ? object.children.map((childId) => { const child = advancedObject(source, childId); return source.slice(child.span.from, child.span.to); }).join("\n") : "";
  return source.slice(0, object.span.from) + replacement + source.slice(object.span.to);
}
export function moveCircuitObject(source: string, id: string, dx: number, dy: number): string {
  const object = advancedObject(source, id);
  if (object.family !== "circuit" || !object.endpoints?.length) throw new Error("此组件没有直接坐标端点。");
  const changes = object.endpoints.map((span) => {
    const pair = /^\(\s*([-+\d.eE]+)\s*(pt|cm|mm|in)?\s*,\s*([-+\d.eE]+)\s*(pt|cm|mm|in)?\s*\)$/u.exec(source.slice(span.from, span.to));
    if (!pair) throw new Error("锚定或参数化端点请在端点面板编辑，以保留连接语义。");
    const factors: Record<string, number> = { cm: 72.27 / 2.54, mm: 72.27 / 25.4, in: 72.27, pt: 1 };
    const x = Number(pair[1]) * factors[pair[2] || "cm"] + dx;
    const y = Number(pair[3]) * factors[pair[4] || "cm"] + dy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("无效端点坐标。");
    return { span, text: `(${Number(x.toFixed(5))}pt,${Number(y.toFixed(5))}pt)` };
  });
  let next = source;
  for (const change of changes.sort((a, b) => b.span.from - a.span.from)) next = next.slice(0, change.span.from) + change.text + next.slice(change.span.to);
  return next;
}
