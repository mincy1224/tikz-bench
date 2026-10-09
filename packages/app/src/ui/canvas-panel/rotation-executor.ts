import { applyEditAction } from "tikz-editor/edit/actions";
import type { EditParseOptions } from "tikz-editor/edit/parse-options";
import type { WorldPoint } from "../coords/types";
import type { DragState } from "./types";
import { angleDeg, normalizeSignedDeg, resolveDraggedRotateDeg } from "./rotate-handle";

type RotationGesture = Extract<DragState, { kind: "rotate" }>;
export function planRotation(drag: RotationGesture, world: WorldPoint, shift: boolean, ctrlOrMeta: boolean, alt: boolean) {
  const mode: RotationGesture["activeRotateMode"] = alt ? "center-pivot" : drag.activeRotateMode === "center-pivot" ? "origin" : drag.activeRotateMode;
  const centerPivot = mode === "center-pivot";
  const angle = resolveDraggedRotateDeg({
    baseRotateDeg: drag.baseRotateDeg,
    startPointerAngleDeg: centerPivot ? drag.startCenterPivotPointerAngleDeg : drag.startPointerAngleDeg,
    currentPointerAngleDeg: angleDeg(centerPivot ? drag.centerPivotWorld : drag.centerWorld, world),
    shiftKey: shift, ctrlOrMetaKey: ctrlOrMeta, shiftSnapStepDeg: 15,
    magneticSnapStepDeg: 90, magneticSnapThresholdDeg: 7, roundToInteger: true
  });
  return { mode, angle, changed: Math.abs(normalizeSignedDeg(angle - drag.lastAppliedRotateDeg)) > 1e-6 || mode !== drag.lastAppliedRotateMode };
}

export function previewRotation(drag: RotationGesture, rotation: ReturnType<typeof planRotation>, options: EditParseOptions): void {
  if (!rotation.changed) return;
  if (!drag.transaction.previewEdit((base) => {
    const result = applyEditAction(base, [], {
      kind: "rotateElement", elementId: drag.sourceId, targetId: rotation.mode === "property" ? drag.elementId : drag.sourceId,
      angleDeg: rotation.angle, mode: rotation.mode
    }, { parseOptions: options });
    if (result.kind === "unsupported" && result.reason === "rotateElement would not change the source.") return { source: base, patches: [], changedSourceIds: [drag.sourceId] };
    if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
    return { source: result.newSource, patches: result.patches, changedSourceIds: result.changedSourceIds ?? [drag.sourceId] };
  })) throw new Error("源码已改变，旋转已取消。");
  drag.lastAppliedRotateDeg = rotation.angle;
  drag.lastAppliedRotateMode = rotation.mode;
  drag.activeRotateMode = rotation.mode;
}
