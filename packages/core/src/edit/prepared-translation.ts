import type { Span, Statement } from "../ast/types.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { pt, worldPoint, type WorldPoint } from "../coords/index.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { followingAnchorHandleIds } from "./anchored-selection.js";
import { rewriteCoordinate } from "./rewrite.js";
import { applyTextReplacements } from "./statement-ops.js";
import { formatNumber } from "./format.js";

type Writer = { id: string; span: Span; write: (delta: WorldPoint) => string };
export type PreparedTranslation = { ids: string[]; movingSourceIds: Set<string>; followingHandleIds: Set<string>; apply: (deltas: ReadonlyMap<string, WorldPoint>) => ReturnType<typeof applyTextReplacements> };

/** Resolve identities, frames and spans once. Frames perform only coordinate
 * arithmetic and one atomic splice; they never parse or evaluate a document. */
export function prepareTranslation(source: string, handles: readonly EditHandle[], ids: readonly string[], options: EditParseOptions = {}): PreparedTranslation | null {
  const parsed = parseTikzForEdit(source, options);
  const statements = new Map<string, Statement>();
  const nested = new Set<string>();
  const visit = (body: readonly Statement[], inside = false) => {
    for (const statement of body) {
      statements.set(statement.id, statement);
      if (inside) nested.add(statement.id);
      if (statement.kind === "Scope") visit(statement.body, true);
    }
  };
  visit(parsed.figure.body);
  const selected = [...new Set(ids)].filter((id) => {
    const child = statements.get(id); if (!child) return true;
    return !ids.some((parentId) => { const parent = statements.get(parentId); return parentId !== id && parent?.kind === "Scope" && parent.span.from <= child.span.from && parent.span.to >= child.span.to; });
  });
  const following = followingAnchorHandleIds(parsed.figure.body, handles, new Set(selected));
  const writers: Writer[] = [];
  for (const id of selected) {
    const statement = statements.get(id);
    if (statement?.kind === "Scope") {
      let a = 1, b = 0, c = 0, d = 1;
      if (nested.has(id) || parsed.figure.options?.entries.length) {
        const probe = "\\path (0pt,0pt);";
        const input = source.slice(0, statement.span.from) + probe + source.slice(statement.span.from);
        const result = evaluateTikzFigure(parseTikzForEdit(input, options).figure, input);
        const handle = result.editHandles.find((candidate) => isFrameLocalCoordinateEditHandle(candidate) && candidate.sourceRef.sourceSpan.from >= statement.span.from && candidate.sourceRef.sourceSpan.to <= statement.span.from + probe.length);
        if (!handle || !isFrameLocalCoordinateEditHandle(handle)) return null;
        ({ a, b, c, d } = handle.frame);
      }
      const determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-12) return null;
      const span = statement.options?.span ?? { from: source.indexOf("}", statement.span.from) + 1, to: source.indexOf("}", statement.span.from) + 1 };
      const original = statement.options ? source.slice(span.from + 1, span.to - 1) : "";
      writers.push({ id, span, write: (delta) => {
        const x = (d * delta.x - c * delta.y) / determinant;
        const y = (-b * delta.x + a * delta.y) / determinant;
        return `[shift={(${formatNumber(x, { fractionDigits: 5 })}pt,${formatNumber(y, { fractionDigits: 5 })}pt)}${original.trim() ? `,${original}` : ""}]`;
      } });
      continue;
    }
    // Matrices, automatic trees and fit nodes use their specialised action.
    if (statement?.kind === "Path" && (statement.items.some((item) => item.kind === "ChildOperation" || item.kind === "Node" && /\b(?:fit|matrix)\b/u.test(item.options?.raw ?? "")) || /\bmatrix\b/u.test(statement.options?.raw ?? ""))) return null;
    const own = handles.filter((handle) => handle.sourceRef.sourceId === id);
    if (!own.length) return null;
    for (const handle of own) {
      if (following.has(handle.id)) continue;
      if (handle.rewriteMode === "unsupported" || source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) !== handle.sourceText) return null;
      writers.push({ id, span: handle.sourceRef.sourceSpan, write: (delta) => {
        const text = rewriteCoordinate(worldPoint(pt(handle.world.x + delta.x), pt(handle.world.y + delta.y)), handle, source);
        if (text === null) throw new Error("This coordinate cannot be translated safely.");
        return text;
      } });
    }
  }
  const movingSourceIds = new Set(selected);
  for (const [id, statement] of statements) {
    if (!selected.some((selectedId) => { const parent = statements.get(selectedId); return parent?.kind === "Scope" && parent.span.from <= statement.span.from && parent.span.to >= statement.span.to; }) && !movingSourceIds.has(id)) continue;
    movingSourceIds.add(id);
    if (statement.kind === "Path") for (const item of statement.items) if (item.kind === "Node") movingSourceIds.add(item.id);
  }
  return { ids: selected, movingSourceIds, followingHandleIds: following, apply: (deltas) => {
    const replacements = new Map<string, { span: Span; text: string }>();
    for (const writer of writers) {
      const delta = deltas.get(writer.id);
      if (!delta || Math.abs(delta.x) + Math.abs(delta.y) < 1e-9) continue;
      const text = writer.write(delta), key = `${writer.span.from}:${writer.span.to}`;
      const previous = replacements.get(key);
      if (previous && previous.text !== text) throw new Error("Conflicting coordinate replacements.");
      replacements.set(key, { span: writer.span, text });
    }
    return applyTextReplacements(source, [...replacements.values()]);
  } };
}
