import type { ParseTikzResult } from "../../parser/index.js";
import { evaluateTikzFigure, type EvaluateTikzResult } from "../../semantic/evaluate.js";
import type { Statement } from "../../ast/types.js";
import { pt, worldPoint } from "../../coords/index.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { collectArrangeWorldBounds } from "../scope-bounds.js";
import { scaleObjectStyle } from "../scale-object-style.js";
import { prepareTranslation } from "../prepared-translation.js";
import { applyTextReplacements } from "../statement-ops.js";
import type { EditActionResultLike } from "../result-types.js";
import { applyResizeElementAction, type ResizeElementAction } from "./resize-element.js";
import { resolveMatrixMode } from "../../semantic/nodes/matrix.js";

/** A scope transform moves placement coordinates, but TikZ node and matrix
 * layouts do not necessarily scale with it. Resize those layouts explicitly,
 * then restore their desired centers through the same movement planner. */
export function resizeGroupLayout(source: string, geometric: Extract<EditActionResultLike, { kind: "success" }>, action: ResizeElementAction, parsed: ParseTikzResult, baseline: EvaluateTikzResult, options: EditParseOptions): EditActionResultLike {
  const baselineBounds = collectArrangeWorldBounds(baseline.scene.elements, parsed.figure.body);
  const b = action.referenceBounds ?? baselineBounds.get(action.elementId);
  if (!b) return { kind: "unsupported", reason: "无法测量组合。" };
  const left = action.role.includes("left"), right = action.role.includes("right"), top = action.role.includes("top"), bottom = action.role.includes("bottom");
  const width = b.maxX - b.minX, height = b.maxY - b.minY;
  const fixedX = left ? b.maxX : right ? b.minX : (b.minX + b.maxX) / 2;
  const fixedY = bottom ? b.maxY : top ? b.minY : (b.minY + b.maxY) / 2;
  let sx = left || right ? Math.abs(action.newWorld.x - fixedX) / width : 1;
  let sy = top || bottom ? Math.abs(action.newWorld.y - fixedY) / height : 1;
  if (action.preserveAspect || action.scaleContents) sx = sy = left || right ? top || bottom ? Math.max(sx, sy) : sx : sy;
  const leaves: Extract<Statement, { kind: "Path" }>[] = [];
  const visit = (body: readonly Statement[], inside = false) => { for (const item of body) {
    const selected = inside || item.id === action.elementId;
    if (item.kind === "Scope") visit(item.body, selected);
    else if (selected && item.kind === "Path") leaves.push(item);
  } };
  visit(parsed.figure.body);
  let next = geometric.newSource;
  const layoutIds = new Set<string>();
  for (const item of leaves) {
    const node = item.items.find((part) => part.kind === "Node");
    const matrix = node?.kind === "Node" && resolveMatrixMode(node.options).enabled;
    const standaloneNode = item.command === "node" && node?.kind === "Node";
    if (!matrix && !standaloneNode) {
      if (action.scaleContents) next = scaleObjectStyle(next, item.id, sx, source, baseline.scene.elements, options);
      continue;
    }
    const old = baselineBounds.get(item.id);
    if (!old) return { kind: "unsupported", reason: "组合包含无法测量的布局对象，未修改任何对象。" };
    layoutIds.add(item.id);
    if (action.scaleContents && !matrix) next = scaleObjectStyle(next, item.id, sx, source, baseline.scene.elements, options);
    const measure = () => {
      const p = parseTikzForEdit(next, options), semantic = evaluateTikzFigure(p.figure, next);
      return { parsed: p, semantic, bounds: collectArrangeWorldBounds(semantic.scene.elements, p.figure.body).get(item.id) };
    };
    let current = measure();
    const wantedWidth = (old.maxX - old.minX) * sx, wantedHeight = (old.maxY - old.minY) * sy;
    const resize = (role: "right" | "top" | "top-right", w: number, h: number, whole: boolean) => {
      const bounds = current.bounds;
      if (!bounds) throw new Error("布局对象无法测量。");
      // Matrix handles keep the opposite edge fixed. Node handles resize about
      // their placement center; supply half dimensions for that contract.
      const x = matrix ? bounds.minX + w : (bounds.minX + bounds.maxX + w) / 2;
      const y = matrix ? bounds.minY + h : (bounds.minY + bounds.maxY + h) / 2;
      const result = applyResizeElementAction(next, { elementId: item.id, role, newWorld: worldPoint(pt(x), pt(y)), scaleContents: whole, formatPrecision: "fine" }, undefined, options);
      if (result.kind !== "success") {
        if (result.kind === "unsupported" && result.reason === "Resize would not change node constraints." && !matrix) return;
        throw new Error(result.kind === "error" ? result.message : result.reason);
      }
      next = result.newSource; current = measure();
    };
    try {
      if (matrix) {
        if (Math.abs((current.bounds?.maxX ?? 0) - (current.bounds?.minX ?? 0) - wantedWidth) > .01 || Math.abs((current.bounds?.maxY ?? 0) - (current.bounds?.minY ?? 0) - wantedHeight) > .01) resize("top-right", wantedWidth, wantedHeight, Boolean(action.scaleContents));
      } else {
        if (current.bounds && Math.abs(current.bounds.maxX - current.bounds.minX - wantedWidth) > .01) resize("right", wantedWidth, current.bounds.maxY - current.bounds.minY, false);
        if (current.bounds && Math.abs(current.bounds.maxY - current.bounds.minY - wantedHeight) > .01) resize("top", current.bounds.maxX - current.bounds.minX, wantedHeight, false);
      }
      const bounds = current.bounds;
      if (!bounds) throw new Error("布局对象无法测量。");
      const x = fixedX + ((old.minX + old.maxX) / 2 - fixedX) * sx;
      const y = fixedY + ((old.minY + old.maxY) / 2 - fixedY) * sy;
      const plan = prepareTranslation(next, current.semantic.editHandles, [item.id], options, current.semantic, current.parsed);
      if (!plan) throw new Error("布局对象的放置关系无法安全修改。");
      next = plan.apply(new Map([[item.id, worldPoint(pt(x - (bounds.minX + bounds.maxX) / 2), pt(y - (bounds.minY + bounds.maxY) / 2))]])).source;
    } catch (error) { return { kind: "unsupported", reason: error instanceof Error ? error.message : String(error) }; }
  }
  if (layoutIds.size) {
    const p = parseTikzForEdit(next, options), semantic = evaluateTikzFigure(p.figure, next);
    const actual = collectArrangeWorldBounds(semantic.scene.elements, p.figure.body).get(action.elementId);
    if (!actual || Math.abs(actual.maxX - actual.minX - width * sx) > .15 || Math.abs(actual.maxY - actual.minY - height * sy) > .15) return { kind: "unsupported", reason: "组合的布局约束无法达到此尺寸；请调整内部对象或使用整体缩放。" };
  }
  if (next === geometric.newSource) return geometric;
  const finalParsed = parseTikzForEdit(next, options);
  const finalPaths = new Map<string, Extract<Statement, { kind: "Path" }>>();
  const indexPaths = (body: readonly Statement[]) => { for (const item of body) {
    if (item.kind === "Scope") indexPaths(item.body);
    else if (item.kind === "Path") finalPaths.set(item.id, item);
  } };
  indexPaths(finalParsed.figure.body);
  const replacements = geometric.patches.map((patch) => ({ span: patch.oldSpan, text: patch.replacement }));
  for (const item of leaves) {
    const final = finalPaths.get(item.id);
    if (!final) return { kind: "unsupported", reason: "组合对象身份已改变，未提交尺寸修改。" };
    const text = next.slice(final.span.from, final.span.to);
    if (text !== source.slice(item.span.from, item.span.to)) replacements.push({ span: item.span, text });
  }
  const result = applyTextReplacements(source, replacements);
  if (result.source !== next) return { kind: "unsupported", reason: "组合尺寸补丁不一致，未提交修改。" };
  return { kind: "success", newSource: next, patches: result.patches, changedSourceIds: [...new Set([...(geometric.changedSourceIds ?? [action.elementId]), ...leaves.map((item) => item.id)])] };
}
