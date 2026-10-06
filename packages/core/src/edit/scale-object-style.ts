import { sourceNode } from "./editable-objects.js";
import { resolvePropertyTarget } from "./property-target.js";
import { applyOptionMutationsToTarget, type OptionMutation } from "./option-mutations.js";
import { getInspectorDescriptor } from "./inspector.js";
import { buildArrowTipSizeMutation } from "./property-write-builders.js";
import type { SceneElement } from "../semantic/types.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { getEditableNodeParts, updateNodePart } from "./multipart.js";

function scaledFont(font: string, size: number): string {
  return font.replace(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b|\\fontsize\s*\{[^}]*\}\s*\{[^}]*\}\s*\\selectfont/gu, "") + `\\fontsize{${size}pt}{${size * 1.2}pt}\\selectfont`;
}
export function scaleObjectStyle(source: string, id: string, factor: number, baselineSource: string, elements: readonly SceneElement[]): string {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("Invalid scaling factor");
  const element = elements.find((candidate) => candidate.sourceRef.sourceId === id && !candidate.adornment);
  const target = resolvePropertyTarget(source, sourceNode(source, id)?.id ?? id); if (!element || target.kind !== "found") return source;
  const mutations = new Map<string, OptionMutation>();
  const text = elements.find((candidate) => candidate.sourceRef.sourceId === id && candidate.kind === "Text");
  const font = target.target.options?.entries.slice().reverse().find((entry) => entry.kind === "kv" && entry.key === "font");
  if (text) mutations.set("font", { kind: "set", value: scaledFont(font?.kind === "kv" ? font.valueRaw : "", text.style.fontSize * factor) });
  mutations.set("line width", { kind: "set", value: `${element.style.lineWidth * factor}pt` });
  for (const key of ["inner xsep", "inner ysep", "inner sep"]) {
    const entry = target.target.options?.entries.slice().reverse().find((candidate) => candidate.kind === "kv" && candidate.key === key);
    const length = entry?.kind === "kv" ? parseLength(entry.valueRaw, "pt") : null;
    if (length !== null) mutations.set(key, { kind: "set", value: `${length * factor}pt` });
  }
  let next = applyOptionMutationsToTarget(source, target.target, mutations)?.source ?? source;
  for (const side of ["start", "end"] as const) {
    const descriptor = getInspectorDescriptor(element, { source: next });
    const property = descriptor.sections.flatMap((section) => section.properties).find((field) => field.kind === "arrowTip" && field.side === side);
    if (property?.kind !== "arrowTip" || property.value === "none") continue;
    const raw = side === "start" ? property.write.arrowContext.startRaw : property.write.arrowContext.endRaw;
    const prior = Number(/(?:\[|,)\s*scale\s*=\s*([^,\]]+)/u.exec(raw)?.[1] ?? "1");
    const change = buildArrowTipSizeMutation(property.write.arrowContext, side, "scale", String(prior * factor));
    const refreshed = resolvePropertyTarget(next, sourceNode(next, id)?.id ?? id);
    if (refreshed.kind === "found") next = applyOptionMutationsToTarget(next, refreshed.target, new Map([[change.key, { kind: "set", value: change.value }]]))?.source ?? next;
  }
  const parts = getEditableNodeParts(baselineSource, id);
  if (parts) for (const [index, part] of parts.parts.entries()) {
    const local = part.options?.entries.slice().reverse().find((entry) => entry.kind === "kv" && entry.key === "font");
    if (local?.kind !== "kv") continue;
    const size = /\\fontsize\{([^}]+)\}/u.exec(local.valueRaw)?.[1];
    const base = size ? parseLength(size, "pt") : text?.style.fontSize;
    if (base) next = updateNodePart(next, id, part.logicalIndex ?? index, "font", scaledFont(local.valueRaw, base * factor));
  }
  return next;
}
