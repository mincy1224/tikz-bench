import type { Statement } from "../ast/types.js";
import { worldBounds, type WorldBounds } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { SceneElement } from "../semantic/types.js";
import { collectSourceWorldBounds } from "./snapping/index.js";

/** A group is arranged using the union of its descendant geometry. */
export function collectArrangeWorldBounds(elements: SceneElement[], statements: Statement[]): Map<string, WorldBounds> {
  const bounds = new Map<string, WorldBounds>(collectSourceWorldBounds(elements));
  for (const element of elements) {
    const cell = element.matrixCell;
    if (!cell) continue;
    const b = bounds.get(cell.cellSourceId), previous = bounds.get(cell.matrixSourceId);
    if (b) bounds.set(cell.matrixSourceId, previous ? worldBounds(pt(Math.min(b.minX, previous.minX)), pt(Math.min(b.minY, previous.minY)), pt(Math.max(b.maxX, previous.maxX)), pt(Math.max(b.maxY, previous.maxY))) : b);
  }
  const visit = (body: Statement[]): void => {
    for (const statement of body) {
      if (statement.kind !== "Scope") continue;
      visit(statement.body);
      const children = statement.body.map((child) => bounds.get(child.id)).filter((value): value is WorldBounds => value !== undefined);
      if (!children.length) continue;
      bounds.set(statement.id, worldBounds(pt(Math.min(...children.map((child) => child.minX))), pt(Math.min(...children.map((child) => child.minY))), pt(Math.max(...children.map((child) => child.maxX))), pt(Math.max(...children.map((child) => child.maxY)))));
    }
  };
  visit(statements);
  return bounds;
}
