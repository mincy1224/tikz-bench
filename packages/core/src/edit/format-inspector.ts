import type { EditableObject } from "./editable-objects.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { collectArrangeWorldBounds } from "./scope-bounds.js";
import { prepareTranslation } from "./prepared-translation.js";
import { applyResizeElementAction } from "./actions/resize-element.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { pt, worldPoint } from "../coords/index.js";

export type FormatField = { key: string; label: string; unit?: string; group: "size" | "matrix" | "text-box" | "effects" };
const fields: readonly FormatField[] = [
  { key: "width", label: "实际宽度", unit: "pt / mm / cm", group: "size" },
  { key: "height", label: "实际高度", unit: "pt / mm / cm", group: "size" },
  { key: "x", label: "中心 X", unit: "pt / mm / cm", group: "size" },
  { key: "y", label: "中心 Y", unit: "pt / mm / cm", group: "size" },
  { key: "rotate", label: "旋转（度）", group: "size" },
  { key: "row sep", label: "行间距", unit: "pt / mm / cm", group: "matrix" },
  { key: "column sep", label: "列间距", unit: "pt / mm / cm", group: "matrix" },
  { key: "inner xsep", label: "水平内边距", unit: "pt / mm / cm", group: "text-box" },
  { key: "inner ysep", label: "垂直内边距", unit: "pt / mm / cm", group: "text-box" },
  { key: "text width", label: "文本宽度", unit: "pt / mm / cm", group: "text-box" },
  { key: "minimum width", label: "最小宽度约束", unit: "pt / mm / cm", group: "text-box" },
  { key: "minimum height", label: "最小高度约束", unit: "pt / mm / cm", group: "text-box" },
  { key: "opacity", label: "不透明度（0–1）", group: "effects" },
  { key: "rounded corners", label: "圆角", unit: "pt / mm / cm", group: "effects" }
];
export function supportsFormatProperty(object: EditableObject, key: string): boolean {
  const matrix = object.type === "tikz:matrix";
  const node = object.properties.has("supports-text") && object.type !== "group";
  if (["font", "text", "align"].includes(key)) return object.properties.has("supports-text") || Boolean(object.advanced);
  if (["row sep", "column sep"].includes(key)) return matrix;
  if (["minimum width", "minimum height", "text width"].includes(key)) return node && !matrix;
  if (["inner xsep", "inner ysep"].includes(key)) return node && !matrix;
  if (key === "rotate") return !matrix && !object.id.includes(":matrix-cell:");
  if (key === "fill") return !["tikz:line", "tikz:curve"].includes(object.type) || object.element?.kind === "Path" && object.element.commands.some((command) => command.kind === "Z");
  if (["width", "height", "x", "y"].includes(key)) return object.properties.has(`resolved-${key}`) && !object.id.includes(":matrix-cell:");
  return true;
}
export function formatFieldsForSelection(objects: readonly EditableObject[]): readonly FormatField[] {
  return objects.length ? fields.filter((field) => objects.every((object) => supportsFormatProperty(object, field.key))) : [];
}
export function setGeometryField(source: string, id: string, key: "x" | "y" | "width" | "height", raw: string, scaleContents = false, options: EditParseOptions = {}): string {
  const value = parseLength(raw, "pt");
  if (value === null || !Number.isFinite(value)) throw new Error("请输入有效尺寸或位置。");
  const parsed = parseTikzForEdit(source, options), semantic = evaluateTikzFigure(parsed.figure, source);
  const b = collectArrangeWorldBounds(semantic.scene.elements, parsed.figure.body).get(id);
  if (!b) throw new Error("无法确定对象的几何位置。");
  if (key === "x" || key === "y") {
    const plan = prepareTranslation(source, semantic.editHandles, [id], options, semantic, parsed);
    if (!plan) throw new Error("此对象无法安全移动。");
    const delta = worldPoint(pt(key === "x" ? value - (b.minX + b.maxX) / 2 : 0), pt(key === "y" ? value - (b.minY + b.maxY) / 2 : 0));
    return plan.apply(new Map([[id, delta]])).source;
  }
  if (value <= 0) throw new Error("尺寸必须大于零。");
  const matrix = semantic.scene.elements.some((element) => element.matrixCell?.matrixSourceId === id);
  const centered = !matrix && semantic.editHandles.some((handle) => handle.sourceRef.sourceId === id && handle.kind === "node-position");
  const x = key === "width" ? centered ? (b.minX + b.maxX + value) / 2 : b.minX + value : (b.minX + b.maxX) / 2;
  const y = key === "height" ? centered ? (b.minY + b.maxY + value) / 2 : b.minY + value : (b.minY + b.maxY) / 2;
  const result = applyResizeElementAction(source, { elementId: id, role: key === "width" ? "right" : "top", newWorld: worldPoint(pt(x), pt(y)), scaleContents, formatPrecision: "fine" }, undefined, options);
  if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
  const after = parseTikzForEdit(result.newSource, options);
  const actual = collectArrangeWorldBounds(evaluateTikzFigure(after.figure, result.newSource).scene.elements, after.figure.body).get(id);
  if (!actual || Math.abs((key === "width" ? actual.maxX - actual.minX : actual.maxY - actual.minY) - value) > .15) throw new Error("布局或内容最小尺寸限制，无法达到此尺寸。");
  return result.newSource;
}
