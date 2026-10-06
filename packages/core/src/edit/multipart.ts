import { parseNodePartSource, resolveRectangleSplitParts } from "../semantic/nodes/multipart.js";
import { resolvePropertyTarget } from "./property-target.js";
import { applyOptionMutationsToTarget, type OptionMutation } from "./option-mutations.js";
import { parseTikzForEdit } from "./parse-options.js";
import type { Statement, NodeItem } from "../ast/types.js";
import { advancedObject, advancedEffectiveOptions, setAdvancedOption } from "./advanced-objects.js";
import { parseOptionListRaw } from "../options/parse.js";

export function getEditableNodeParts(source: string, elementId: string) {
  if (elementId.startsWith("advanced:")) {
    const object = advancedObject(source, elementId);
    if (object.family !== "forest" || !object.content) return null;
    const values = advancedEffectiveOptions(source, object);
    if (!values.has("rectangle split") && values.get("shape") !== "rectangle split") return null;
    const options = parseOptionListRaw(`[${[...values].map(([key, value]) => value === "true" ? key : `${key}=${value}`).join(",")}]`);
    return { target: { id: elementId, kind: "node-item" as const, insertOffset: object.options.from, span: object.span, options, textSpan: object.content }, count: resolveRectangleSplitParts(options), parts: parseNodePartSource(source.slice(object.content.from, object.content.to), object.content.from) };
  }
  const findNode = (statements: Statement[]): NodeItem | undefined => {
    for (const statement of statements) {
      if (statement.kind === "Scope") { const nested = findNode(statement.body); if (nested) return nested; }
      if (statement.kind === "Path") {
        const node = statement.items.find((item): item is NodeItem => item.kind === "Node" && (item.id === elementId || (statement.id === elementId && statement.command === "node")));
        if (node) return node;
      }
    }
    return undefined;
  };
  const node = findNode(parseTikzForEdit(source).figure.body);
  if (!node) return null;
  const result = resolvePropertyTarget(source, node.id);
  if (result.kind !== "found") return null;
  const target = { ...result.target, textSpan: node.textSpan };
  const shape = target.options?.entries.some((entry) => entry.kind !== "unknown" && (entry.key === "rectangle split" || (entry.kind === "kv" && entry.key === "shape" && entry.valueRaw.trim() === "rectangle split")));
  if (!shape) return null;
  const span = target.textSpan;
  return { target, count: resolveRectangleSplitParts(target.options), parts: parseNodePartSource(source.slice(span.from, span.to), span.from) };
}

export function updateNodePart(source: string, elementId: string, index: number, property: "text" | "font" | "align", value: string): string {
  const model = getEditableNodeParts(source, elementId);
  if (!model) throw new Error("Multipart source target is unavailable");
  const part = model.parts.slice().reverse().find((candidate) => candidate.logicalIndex === index);
  if (!part?.contentSpan) {
    if (property !== "text" || index < 0 || index >= model.count) throw new Error("This partition has no direct source range");
    const names = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
    const end = model.target.textSpan.to;
    return source.slice(0, end) + `\\nodepart{${names[index]}}${value}` + source.slice(end);
  }
  if (property === "text") return source.slice(0, part.contentSpan.from) + value + source.slice(part.contentSpan.to);
  if (part.optionsInsertOffset === undefined) {
    return source.slice(0, part.contentSpan.from) + `\\nodepart[${property}=${value}]{one}` + source.slice(part.contentSpan.from);
  }
  if (elementId.startsWith("advanced:")) {
    const options = part.options?.entries.filter((entry) => entry.kind === "unknown" || entry.key !== property).map((entry) => entry.raw) ?? [];
    if (value) options.push(`${property}=${value}`);
    const replacement = options.length ? `[${options.join(",")}]` : "";
    const span = part.optionsSpan ?? { from: part.optionsInsertOffset, to: part.optionsInsertOffset };
    return source.slice(0, span.from) + replacement + source.slice(span.to);
  }
  const result = applyOptionMutationsToTarget(source, { ...model.target, options: part.options, optionsSpan: part.optionsSpan, insertOffset: part.optionsInsertOffset }, new Map<string, OptionMutation>([[property, { kind: "set", value }]]));
  return result?.source ?? source;
}

export function updateNodePartFill(source: string, elementId: string, index: number, value: string): string {
  const model = getEditableNodeParts(source, elementId);
  if (!model) throw new Error("Multipart source target is unavailable");
  const entry = model.target.options?.entries.slice().reverse().find((candidate) => candidate.kind === "kv" && candidate.key === "rectangle split part fill");
  const fills = entry?.kind === "kv" ? entry.valueRaw.replace(/^\{|\}$/gu, "").split(",").map((color) => color.trim()) : [];
  const globalFill = model.target.options?.entries.slice().reverse().find((candidate) => candidate.kind === "kv" && candidate.key === "fill");
  while (fills.length < model.count) fills.push(fills.at(-1) ?? (globalFill?.kind === "kv" ? globalFill.valueRaw : "none"));
  fills[index] = value.trim() || "none";
  if (elementId.startsWith("advanced:")) {
    const next = setAdvancedOption(source, elementId, "rectangle split uses custom fill", "true");
    return setAdvancedOption(next, elementId, "rectangle split part fill", `{${fills.join(",")}}`);
  }
  const result = applyOptionMutationsToTarget(source, model.target, new Map<string, OptionMutation>([
    ["rectangle split use custom fill", { kind: "remove" }],
    ["rectangle split uses custom fill", { kind: "set", value: "true" }],
    ["rectangle split part fill", { kind: "set", value: `{${fills.join(",")}}` }]
  ]));
  return result?.source ?? source;
}

/** Values shown in the format panel come from the same source model as writes. */
export function nodePartProperty(source: string, elementId: string, index: number, property: "fill" | "font" | "align"): string {
  const model = getEditableNodeParts(source, elementId);
  if (!model) return "";
  const read = (entries: typeof model.target.options, key: string): string => {
    const entry = entries?.entries.slice().reverse().find((candidate) => candidate.kind === "kv" && candidate.key === key);
    return entry?.kind === "kv" ? entry.valueRaw : "";
  };
  if (property === "fill") {
    const values = read(model.target.options, "rectangle split part fill").replace(/^\{|\}$/gu, "").split(",").map((value) => value.trim()).filter(Boolean);
    return values[index] ?? values.at(-1) ?? (read(model.target.options, "fill") || "none");
  }
  return read(model.parts.find((part) => part.logicalIndex === index)?.options, property) || read(model.target.options, property);
}
