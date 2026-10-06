import type { SceneElement } from "../semantic/types.js";
import { resolveNodeShape } from "../semantic/nodes/options.js";
import type { NodeItem, Span, Statement } from "../ast/types.js";
import { parseTikzForEdit } from "./parse-options.js";
import { resolvePropertyTarget } from "./property-target.js";
import { applyEditAction } from "./actions.js";
import { advancedObject, advancedOptionValues, advancedEffectiveOptions, parseAdvancedObjects, setAdvancedOption, type AdvancedObject } from "./advanced-objects.js";

export type EditableObject = { id: string; type: string; label: string; span: Span; parentId?: string; children: string[]; properties: Map<string, string>; advanced?: AdvancedObject; element?: SceneElement };
export type FormatSnapshot = { type: string; properties: Map<string, string>; skipped: string[] };

function shapeName(properties: Map<string, string>, fallback = "rectangle"): string {
  return properties.get("shape") ?? ["rectangle split", "circle", "ellipse", "diamond", "rectangle", "rounded rectangle"].find((key) => properties.has(key)) ?? fallback;
}
export function sourceNode(source: string, id: string): NodeItem | undefined {
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
  return visit(parseTikzForEdit(source).figure.body);
}
export function editableObjects(source: string, elements: readonly SceneElement[] = []): EditableObject[] {
  const advanced = parseAdvancedObjects(source);
  const objects: EditableObject[] = advanced.objects.map((object) => {
    const properties = advancedEffectiveOptions(source, object);
    if (object.content) properties.set("content", source.slice(object.content.from, object.content.to));
    return { ...object, type: object.family === "forest" ? `forest:${shapeName(properties)}` : object.type, properties, advanced: object };
  });
  const parsed = parseTikzForEdit(source);
  const visitScopes = (statements: typeof parsed.figure.body) => {
    for (const statement of statements) {
      if (statement.kind !== "Scope") continue;
      const properties = new Map<string, string>();
      for (const entry of statement.options?.entries ?? []) if (entry.kind !== "unknown") properties.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
      if (properties.get("name") !== "__tikz_bench_semantic") objects.push({ id: statement.id, type: "group", label: "组合", span: statement.span, children: statement.body.map((child) => child.id), properties });
      visitScopes(statement.body);
    }
  };
  visitScopes(parsed.figure.body);
  const seen = new Set<string>();
  for (const element of elements) {
    const id = element.sourceRef.sourceId;
    if (seen.has(id) || element.adornment) continue;
    const target = resolvePropertyTarget(source, id);
    if (target.kind !== "found") continue;
    const properties = new Map<string, string>();
    for (const entry of target.target.options?.entries ?? []) if (entry.kind !== "unknown") properties.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
    const node = sourceNode(source, id);
    for (const entry of node?.options?.entries ?? []) if (entry.kind !== "unknown") properties.set(entry.key, entry.kind === "kv" ? entry.valueRaw : "true");
    const isNode = element.kind === "Text" || Boolean(node) || elements.some((candidate) => candidate.sourceRef.sourceId === id && candidate.kind === "Text");
    const shape = isNode ? (node?.options ? resolveNodeShape(node.options) : shapeName(properties)) : element.kind === "Path" ? element.shapeHint ?? (element.commands.some((command) => command.kind === "C") ? "curve" : "line") : element.kind.toLowerCase();
    if (isNode) properties.set("supports-text", "true");
    if (element.style.fillPattern) properties.set("fill-mode", "pattern");
    properties.set("resolved-fill", element.style.fill ?? "none");
    properties.set("resolved-draw", element.style.stroke ?? "none");
    properties.set("resolved-text", element.style.textColor ?? element.style.stroke ?? "black");
    const textElement = elements.find((candidate) => candidate.sourceRef.sourceId === id && candidate.kind === "Text");
    const explicitSize = /\\fontsize\s*\{([^}]+)\}/u.exec(properties.get("font") ?? "")?.[1];
    properties.set("resolved-size", explicitSize ?? String(Number((textElement?.style.fontSize ?? element.style.fontSize).toFixed(2))));
    properties.set("resolved-line-width", String(element.style.lineWidth));
    objects.push({ id, type: `tikz:${shape}`, label: shape, span: target.target.span, children: [], properties, element });
    seen.add(id);
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
export function setObjectProperty(source: string, id: string, key: string, value: string): string {
  if (id.startsWith("advanced:")) return setAdvancedOption(source, id, key, value);
  const result = applyEditAction(source, [], { kind: "setProperty", elementId: sourceNode(source, id)?.id ?? id, level: "command", key, value });
  if (result.kind === "success") return result.newSource;
  if (result.kind === "unsupported" && /would not change|already|matches|No property changes/iu.test(result.reason)) return source;
  throw new Error(result.kind === "error" ? result.message : result.kind === "partial" ? result.reason : result.reason);
}
export function captureFormat(object: EditableObject): FormatSnapshot {
  const properties = new Map<string, string>(); const skipped: string[] = [];
  for (const [key, resolved] of [["fill", "resolved-fill"], ["draw", "resolved-draw"], ["text", "resolved-text"]]) {
    const value = object.properties.get(resolved) ?? object.properties.get(key);
    if (key === "fill" && (object.properties.has("fill-mode") || object.properties.has("shade") || object.properties.has("shading") || object.properties.has("pattern"))) { skipped.push("渐变／图案填充"); continue; }
    if (value && value !== "true") properties.set(key, tikzColor(value));
  }
  const width = object.properties.get("resolved-line-width") ?? object.properties.get("line width");
  if (width) properties.set("line width", /[a-z]/iu.test(width) ? width : `${width}pt`);
  const font = object.properties.get("font") ?? "";
  const preset = /\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b/u.exec(font)?.[1];
  const presets: Record<string, number> = { tiny: 5, scriptsize: 7, footnotesize: 8, small: 9, normalsize: 10, large: 12, Large: 14.4, LARGE: 17.28, huge: 20.74, Huge: 24.88 };
  const size = object.properties.get("resolved-size") ?? /\\fontsize\{([^}]+)\}/u.exec(font)?.[1] ?? (preset ? `${presets[preset]}pt` : object.advanced ? "10pt" : undefined);
  if (size) properties.set("font-size", /[a-z]/iu.test(size) ? size : `${size}pt`);
  return { type: object.type, properties, skipped };
}
export function applyFormat(source: string, object: EditableObject, snapshot: FormatSnapshot): string {
  if (object.type !== snapshot.type) throw new Error("格式刷只能用于相同组件类型。");
  let next = source;
  for (const [key, value] of snapshot.properties) {
    if (key === "font-size") {
      if (!object.advanced && !object.properties.has("supports-text")) continue;
      const font = object.advanced ? advancedOptionValues(next, advancedObject(next, object.id)).get("font") ?? "" : resolvePropertyTarget(next, object.id).kind === "found" ? object.properties.get("font") ?? "" : "";
      next = setObjectProperty(next, object.id, "font", fontWithSize(font, value));
    } else next = setObjectProperty(next, object.id, key, value);
  }
  return next;
}
