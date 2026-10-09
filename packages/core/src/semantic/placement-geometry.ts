import type { Statement } from "../ast/types.js";
import type { WorldPoint } from "../coords/points.js";
import type { WorldTransform } from "../coords/transforms.js";
import type { EditHandle, SceneElement } from "./types.js";

export type PlacementGeometry = { sourceId: string; parentId: string | null; parentFrame: WorldTransform; anchor?: WorldPoint; children: string[] };

/** Index semantic ownership once, without inferring placement from visual bounds. */
export function buildPlacementGeometry(body: readonly Statement[], frames: ReadonlyMap<string, WorldTransform>, handles: readonly EditHandle[], elements: readonly SceneElement[]): ReadonlyMap<string, PlacementGeometry> {
  const anchors = new Map<string, WorldPoint>();
  for (const handle of handles) if (handle.kind === "node-position" && !anchors.has(handle.sourceRef.sourceId)) anchors.set(handle.sourceRef.sourceId, handle.world);
  const index = new Map<string, PlacementGeometry>();
  const visit = (statements: readonly Statement[], parentId: string | null) => {
    for (const statement of statements) {
      const frame = frames.get(statement.id);
      if (frame) index.set(statement.id, { sourceId: statement.id, parentId, parentFrame: frame, anchor: anchors.get(statement.id), children: statement.kind === "Scope" ? statement.body.map((item) => item.id) : [] });
      if (statement.kind === "Scope") visit(statement.body, statement.id);
    }
  };
  visit(body, null);
  const seenCells = new Set<string>();
  for (const element of elements) if (element.matrixCell && !seenCells.has(element.matrixCell.cellSourceId)) {
    seenCells.add(element.matrixCell.cellSourceId);
    const owner = index.get(element.matrixCell.matrixSourceId);
    if (owner) owner.children.push(element.matrixCell.cellSourceId);
  }
  return index;
}
