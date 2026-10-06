import type { PreparedTranslation } from "tikz-editor/edit/prepared-translation";
import type { EditHandle, SceneElement } from "tikz-editor/semantic/types";
import { collectGeometryInvalidation, type SemanticDependencyGraph } from "tikz-editor/semantic/dependencies";

/** Disposable display-only translation. The source is written once on release.
 * Complex dependent geometry keeps using semantic previews for correctness. */
export class ElementTranslationPreview {
  private readonly transforms: { element: SVGElement; original: string | null }[];
  constructor(elements: SVGElement[]) {
    this.transforms = elements.map((element) => ({ element, original: element.getAttribute("transform") }));
  }
  move(x: number, y: number): void {
    for (const { element, original } of this.transforms) element.setAttribute("transform", `translate(${x},${-y})${original ? ` ${original}` : ""}`);
  }
  restore(): void {
    for (const { element, original } of this.transforms) {
      if (original === null) element.removeAttribute("transform"); else element.setAttribute("transform", original);
    }
  }
}

export function createElementTranslationPreview(host: HTMLElement | null, plan: PreparedTranslation, handles: readonly EditHandle[], dependencies: SemanticDependencyGraph, scene: readonly SceneElement[]): ElementTranslationPreview | null {
  if (!host) return null;
  const moving = new Set(plan.movingSourceIds);
  const affected = collectGeometryInvalidation(dependencies, { changedSourceIds: [...moving] });
  if (affected.reachedOpaque) return null;
  for (const id of affected.affectedSourceIds) {
    if (moving.has(id)) continue;
    const own = handles.filter((handle) => handle.sourceRef.sourceId === id);
    if (!own.length || !own.every((handle) => plan.followingHandleIds.has(handle.id))) return null;
    moving.add(id);
  }
  for (const element of scene) {
    if (element.adornment && moving.has(element.adornment.ownerSourceId)) moving.add(element.sourceRef.sourceId);
    if (moving.has(element.sourceRef.sourceId) && element.clipChain?.length) return null;
  }
  const layer = host.querySelector('[data-testid="canvas-svg-layer"]');
  if (!layer) return null;
  const all = Array.from(layer.querySelectorAll<SVGElement>("[data-source-id]"));
  const selected = all.filter((element) => moving.has(element.getAttribute("data-source-id") ?? ""));
  const selectedSet = new Set(selected);
  const outermost = selected.filter((element) => { let parent = element.parentElement; while (parent) { if (selectedSet.has(parent as unknown as SVGElement)) return false; parent = parent.parentElement; } return true; });
  const overlay = host.querySelector<SVGElement>("[data-element-drag-overlay]");
  if (overlay) outermost.push(overlay);
  return outermost.length ? new ElementTranslationPreview(outermost) : null;
}
