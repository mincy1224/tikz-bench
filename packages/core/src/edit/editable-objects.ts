import type { SceneElement } from "../semantic/types.js";
import { resolveNodeShape } from "../semantic/nodes/options.js";
import { collectArrangeWorldBounds } from "./scope-bounds.js";
import { resolveMatrixMode } from "../semantic/nodes/matrix.js";
import type { NodeItem, Span, Statement } from "../ast/types.js";
import type { ParseTikzResult } from "../parser/index.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { resolvePropertyTarget, resolvePropertyTargetFromParseResult } from "./property-target.js";
import { applyEditAction } from "./actions.js";
import { advancedObject, advancedOptionValues, advancedEffectiveOptions, parseAdvancedObjects, setAdvancedOption, type AdvancedObject } from "./advanced-objects.js";

export type EditableObject = { id: string; type: string; label: string; span: Span; parentId?: string; children: string[]; properties: Map<string, string>; advanced?: AdvancedObject; element?: SceneElement };
export type FormatSnapshot = { type: string; properties: Map<string, string>; skipped: string[] };

function shapeName(properties: Map<string, string>, fallback = "rectangle"): string {
  return properties.get("shape") ?? ["rectangle split", "circle", "ellipse", "diamond", "rectangle", "rounded rectangle"].find((key) => properties.has(key)) ?? fallback;
}
export function sourceNode(source: string, id: string, options: EditParseOptions = {}): NodeItem | undefined {
  const visit = (body: Statement[]): NodeItem | undefined => {
    for (const statement of body) {
      if (statement.kind === "Scope") { const node = visit(statement.body); if (node) return node; }
      if (statement.kind === "Path") {
        const node = statement.items.find((item): item is NodeItem => item.kind === "Node" && (item.id === id || statement.id === id && statement.command === "node"));
        if (node) return node;
      }
    }
    return undefined;
  };
  return visit(parseTikzForEdit(source, options).figure.body);
}
export function editableObjects(source: string, elements: readonly SceneElement[] = [], selectedIds?: ReadonlySet<string>, parseResult?: ParseTikzResult | null, options: EditParseOptions = {}): EditableObject[] {
  if (selectedIds?.size === 0) return [];
  const advanced = parseAdvancedObjects(source);
  const objects: EditableObject[] = advanced.objects.filter((object) => !selectedIds || selectedIds.has(object.id)).map((object) => {
    const properties = advancedEffectiveOptions(source, object);
    if (object.content) properties.set("content", source.slice(object.content.from, object.content.to));
    return { ...object, type: object.family === "forest" ? `forest:${shapeName(properties)}` : object.type, properties, advanced: object };
  });
  const parsed = parseResult?.source === source ? parseResult : parseTikzForEdit(source, { activeFigureId: parseResult?.activeFigureId, ...options });
  const nodes = new Map<string, NodeItem>();
  const visitScopes = (statements: typeof parsed.figure.body) => {
    for (const statement of statements) {
      if (statement.kind === "Path") {
        for (const item of statement.items) if (item.kind === "Node") {
          nodes.set(item.id, item);
          if (statement.command === "node" && !nodes.has(statement.id)) nodes.set(statement.id, item);
        }
      }
      if (statement.kind !== "Scope") continue;
      const properties = new Map<string, string>();
      for (const entry of statement.options?.entries ?? []) if (entry.kind !== "unknown") properties.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
      if (properties.get("name") !== "__tikz_bench_semantic" && (!selectedIds || selectedIds.has(statement.id))) objects.push({ id: statement.id, type: "group", label: "组合", span: statement.span, children: statement.body.map((child) => child.id), properties });
      visitScopes(statement.body);
    }
  };
  visitScopes(parsed.figure.body);
  const textElements = new Map(elements.filter((element) => element.kind === "Text").map((element) => [element.sourceRef.sourceId, element]));
  const seen = new Set<string>();
  for (const element of elements) {
    const id = selectedIds?.has(element.matrixCell?.matrixSourceId ?? "") ? element.matrixCell!.matrixSourceId : element.sourceRef.sourceId;
    if (seen.has(id) || element.adornment || selectedIds && !selectedIds.has(id)) continue;
    const target = resolvePropertyTargetFromParseResult(source, parsed, id);
    if (target.kind !== "found") continue;
    const properties = new Map<string, string>();
    for (const entry of target.target.options?.entries ?? []) if (entry.kind !== "unknown") properties.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
    const node = nodes.get(id);
    if (target.target.kind === "matrix-statement") {
      const mode = resolveMatrixMode(target.target.options);
      properties.set("resolved-row sep", String(mode.rowSep.gap));
      properties.set("resolved-column sep", String(mode.columnSep.gap));
    }
    for (const entry of node?.options?.entries ?? []) if (entry.kind !== "unknown") properties.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
    const isNode = element.kind === "Text" || Boolean(node) || textElements.has(id);
    const shape = target.target.kind === "matrix-statement" ? "matrix" : isNode ? (node?.options ? resolveNodeShape(node.options) : shapeName(properties)) : element.kind === "Path" ? element.shapeHint ?? (element.commands.some((command) => command.kind === "C") ? "curve" : "line") : element.kind.toLowerCase();
    if (isNode) properties.set("supports-text", "true");
    if (element.style.fillPattern) properties.set("fill-mode", "pattern");
    properties.set("resolved-fill", element.style.fill ?? "none");
    properties.set("resolved-draw", element.style.stroke ?? "none");
    properties.set("resolved-text", element.style.textColor ?? element.style.stroke ?? "black");
    const textElement = textElements.get(id);
    const explicitSize = /\\fontsize\s*\{([^}]+)\}/u.exec(properties.get("font") ?? "")?.[1];
    properties.set("resolved-size", explicitSize ?? String(Number((textElement?.style.fontSize ?? element.style.fontSize).toFixed(2))));
    properties.set("resolved-line-width", String(element.style.lineWidth));
    properties.set("resolved-family", textElement?.style.fontFamily ?? element.style.fontFamily);
    properties.set("resolved-weight", textElement?.style.fontWeight ?? element.style.fontWeight);
    properties.set("resolved-style", textElement?.style.fontStyle ?? element.style.fontStyle);
    objects.push({ id, type: `tikz:${shape}`, label: shape, span: target.target.span, children: [], properties, element });
    seen.add(id);
  }
  const bounds = collectArrangeWorldBounds([...elements], parsed.figure.body);
  for (const object of objects) {
    const b = bounds.get(object.id);
    if (b) { object.properties.set("resolved-width", String(b.maxX - b.minX)); object.properties.set("resolved-height", String(b.maxY - b.minY)); object.properties.set("resolved-x", String((b.minX + b.maxX) / 2)); object.properties.set("resolved-y", String((b.minY + b.maxY) / 2)); }
    if (object.type !== "tikz:matrix" && object.type !== "group") continue;
    const target = resolvePropertyTargetFromParseResult(source, parsed, object.id);
    if (target.kind !== "found") continue;
    const texts = elements.filter((element) => element.kind === "Text" && (element.matrixCell?.matrixSourceId === object.id || element.sourceRef.sourceSpan.from >= object.span.from && element.sourceRef.sourceSpan.to <= object.span.to));
    const inheritedValues: [string, string[]][] = [["resolved-size", texts.map((element) => String(element.style.fontSize))], ["resolved-family", texts.map((element) => element.style.fontFamily)], ["resolved-weight", texts.map((element) => element.style.fontWeight)], ["resolved-style", texts.map((element) => element.style.fontStyle)]];
    inheritedValues.push(["resolved-text", texts.map((element) => element.style.textColor ?? element.style.stroke ?? "black")]);
    const shapes = elements.filter((element) => element.kind !== "Text" && !element.adornment && (object.type === "group" ? element.sourceRef.sourceSpan.from >= object.span.from && element.sourceRef.sourceSpan.to <= object.span.to : element.sourceRef.sourceId === object.id));
    inheritedValues.push(["resolved-fill", shapes.map((element) => element.style.fill ?? "none")], ["resolved-draw", shapes.map((element) => element.style.stroke ?? "none")], ["resolved-line-width", shapes.map((element) => String(element.style.lineWidth))]);
    if (object.type === "tikz:matrix" && !shapes.length) {
      // An undrawn matrix has no outer fill or stroke. Cell colors belong to
      // cell formatting, and must not masquerade as the matrix's border.
      object.properties.set("resolved-fill", "none"); object.properties.set("resolved-draw", "none");
    }
    for (const [key, values] of inheritedValues) {
      if (values.length) object.properties.set(key, values.every((value) => value === values[0]) ? values[0] : "__mixed__");
    }
    if (texts.length) object.properties.set("supports-text", "true");
  }
  return objects;
}
export function tikzColor(value: string): string {
  if (!/^#[0-9a-f]{6}$/iu.test(value)) return value;
  return `{rgb,255:red,${Number.parseInt(value.slice(1, 3), 16)};green,${Number.parseInt(value.slice(3, 5), 16)};blue,${Number.parseInt(value.slice(5, 7), 16)}}`;
}
export function fontWithSize(font: string, size: string): string {
  return font.replace(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b|\\fontsize\s*\{[^}]*\}\s*\{[^}]*\}\s*\\selectfont/gu, "") + `\\fontsize{${size}}{${Number.parseFloat(size) * 1.2}pt}\\selectfont`;
}
export function setObjectProperty(source: string, id: string, key: string, value: string, options: EditParseOptions = {}): string {
  if (id.startsWith("advanced:")) return setAdvancedOption(source, id, key, value);
  const result = applyEditAction(source, [], { kind: "setProperty", elementId: sourceNode(source, id, options)?.id ?? id, level: "command", key, value }, { parseOptions: options });
  if (result.kind === "success") return result.newSource;
  if (result.kind === "unsupported" && /would not change|already|matches|No property changes/iu.test(result.reason)) return source;
  throw new Error(result.kind === "error" ? result.message : result.kind === "partial" ? result.reason : result.reason);
}
export function captureFormat(object: EditableObject): FormatSnapshot {
  const properties = new Map<string, string>(); const skipped: string[] = [];
  for (const [key, resolved] of [["fill", "resolved-fill"], ["draw", "resolved-draw"], ["text", "resolved-text"]]) {
    const value = object.properties.get(resolved) ?? object.properties.get(key);
    if (key === "fill" && (object.properties.has("fill-mode") || object.properties.has("shade") || object.properties.has("shading") || object.properties.has("pattern"))) { skipped.push("渐变／图案填充"); continue; }
    if (value === "__mixed__") { skipped.push(key); continue; }
    if (value && value !== "true") properties.set(key, tikzColor(value));
  }
  const width = object.properties.get("resolved-line-width") ?? object.properties.get("line width");
  if (width === "__mixed__") skipped.push("线宽");
  else if (width) properties.set("line width", /[a-z]/iu.test(width) ? width : `${width}pt`);
  const font = object.properties.get("font") ?? "";
  const preset = /\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b/u.exec(font)?.[1];
  const presets: Record<string, number> = { tiny: 5, scriptsize: 7, footnotesize: 8, small: 9, normalsize: 10, large: 12, Large: 14.4, LARGE: 17.28, huge: 20.74, Huge: 24.88 };
  const size = object.properties.get("resolved-size") ?? /\\fontsize\{([^}]+)\}/u.exec(font)?.[1] ?? (preset ? `${presets[preset]}pt` : object.advanced ? "10pt" : undefined);
  if (size === "__mixed__") skipped.push("字号");
  else if (size) properties.set("font-size", /[a-z]/iu.test(size) ? size : `${size}pt`);
  return { type: object.type, properties, skipped };
}
export function applyFormat(source: string, object: EditableObject, snapshot: FormatSnapshot, options: EditParseOptions = {}): string {
  if (object.type !== snapshot.type) throw new Error("格式刷只能用于相同组件类型。");
  let next = source;
  for (const [key, value] of snapshot.properties) {
    if (key === "font-size") {
      if (!object.advanced && !object.properties.has("supports-text")) continue;
      const font = object.advanced ? advancedOptionValues(next, advancedObject(next, object.id)).get("font") ?? "" : resolvePropertyTarget(next, object.id, options).kind === "found" ? object.properties.get("font") ?? "" : "";
      next = setObjectProperty(next, object.id, "font", fontWithSize(font, value), options);
    } else next = setObjectProperty(next, object.id, key, value, options);
  }
  return next;
}
