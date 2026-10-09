import type { PathStatement, Span } from "../ast/types.js";
import type { WorldTransform } from "../coords/transforms.js";
import { pt, worldPoint, type WorldPoint } from "../coords/index.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import { parseCoordinateLike, parseLength } from "../semantic/coords/parse-length.js";
import { formatNumber, CM_PER_PT } from "./format.js";

/** An editor-created center pivot travels with its shape. Authored external
 * pivots stay fixed. Resolve against the baseline, before any coordinate edit. */
export type CenterPivotTranslation = {
  span: Span;
  write: (delta: WorldPoint) => string;
  coordinateDelta: (handle: EditHandle, delta: WorldPoint) => WorldPoint;
};
export function centerPivotTranslation(source: string, statement: PathStatement, handles: readonly EditHandle[], parent?: WorldTransform): CenterPivotTranslation | null {
  const entry = statement.options?.entries.find((item) => item.kind === "kv" && ["rotate around", "/tikz/rotate around"].includes(item.key));
  if (!entry || !parent) return null;
  const raw = source.slice(entry.span.from, entry.span.to);
  const match = /\{\s*([^:]+):\s*(\([^)]*\))\s*\}/u.exec(raw);
  const coord = match && parseCoordinateLike(match[2]);
  if (!coord) return null;
  const x = parseLength(coord.x, "cm"), y = parseLength(coord.y, "cm");
  if (x === null || y === null) return null;
  const points = handles.filter((handle) => handle.kind === "path-point");
  const shape = statement.items.find((item) => item.kind === "PathKeyword" && ["rectangle", "circle", "ellipse"].includes(item.keyword));
  if (!shape || !points.length || points.length > 2) return null;
  const cx = points.reduce((sum, handle) => sum + handle.world.x, 0) / points.length;
  const cy = points.reduce((sum, handle) => sum + handle.world.y, 0) / points.length;
  if (Math.abs(cx - (parent.a * x + parent.c * y + parent.e)) > 0.001 || Math.abs(cy - (parent.b * x + parent.d * y + parent.f)) > 0.001) return null;
  const determinant = parent.a * parent.d - parent.b * parent.c;
  if (Math.abs(determinant) < 1e-12) return null;
  const local = (delta: WorldPoint) => ({ x: (parent.d * delta.x - parent.c * delta.y) / determinant, y: (-parent.b * delta.x + parent.a * delta.y) / determinant });
  return {
    span: entry.span,
    write(this: void, delta: WorldPoint) { const d = local(delta); return raw.replace(match[2], `(${formatNumber((x + d.x) * CM_PER_PT)},${formatNumber((y + d.y) * CM_PER_PT)})`); },
    coordinateDelta(handle: EditHandle, delta: WorldPoint) { if (!isFrameLocalCoordinateEditHandle(handle)) return delta; const d = local(delta); return worldPoint(pt(handle.frame.a * d.x + handle.frame.c * d.y), pt(handle.frame.b * d.x + handle.frame.d * d.y)); }
  };
}
