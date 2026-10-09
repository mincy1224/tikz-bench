import type { EditHandle } from "tikz-editor/semantic/types";

export type DragCapability = {
  draggableHandleIds: ReadonlySet<string>;
  draggableSourceIds: ReadonlySet<string>;
};

export function computeDragCapability(editHandles: readonly EditHandle[]): DragCapability {
  const byId = new Map(editHandles.map((handle) => [handle.id, handle]));
  const ownersBySpan = new Map<string, Set<string>>();
  const rewriteTargetsByHandleId = new Map<string, EditHandle | null>();
  for (const handle of editHandles) {
    const target = handle.rewriteTargetHandleId ? byId.get(handle.rewriteTargetHandleId) ?? null : handle;
    rewriteTargetsByHandleId.set(handle.id, target);
    if (target) { const span = target.sourceRef.sourceSpan, key = `${span.from}:${span.to}`; const owners = ownersBySpan.get(key) ?? new Set<string>(); owners.add(target.id); ownersBySpan.set(key, owners); }
  }

  const draggableHandleIds = new Set<string>();
  for (const handle of editHandles) {
    const rewriteTarget = rewriteTargetsByHandleId.get(handle.id) ?? null;
    if (!rewriteTarget) {
      continue;
    }
    if (rewriteTarget.rewriteMode === "unsupported") {
      if (!isNamedEndpointDetachHandle(handle)) {
        continue;
      }
      if (hasConflictingRewriteTarget(rewriteTarget, ownersBySpan)) {
        continue;
      }
      draggableHandleIds.add(handle.id);
      continue;
    }
    if (hasConflictingRewriteTarget(rewriteTarget, ownersBySpan)) {
      continue;
    }
    draggableHandleIds.add(handle.id);
  }

  const handlesBySourceId = new Map<string, EditHandle[]>();
  for (const handle of editHandles) {
    const sourceId = handle.sourceRef.sourceId;
    const existing = handlesBySourceId.get(sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySourceId.set(sourceId, [handle]);
    }
  }

  const draggableSourceIds = new Set<string>();
  for (const [sourceId, handles] of handlesBySourceId) {
    if (handles.length === 0) {
      continue;
    }
    const sourceFullyRewritable = handles.every((handle) => {
      const rewriteTarget = rewriteTargetsByHandleId.get(handle.id) ?? null;
      if (!rewriteTarget || rewriteTarget.rewriteMode === "unsupported") {
        return false;
      }
      return !hasConflictingRewriteTarget(rewriteTarget, ownersBySpan);
    });
    if (sourceFullyRewritable) {
      draggableSourceIds.add(sourceId);
    }
  }

  return { draggableHandleIds, draggableSourceIds };
}

function isNamedEndpointDetachHandle(handle: EditHandle): boolean {
  return handle.kind === "path-point" && handle.coordinateForm === "named";
}

function hasConflictingRewriteTarget(target: EditHandle, owners: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const span = target.sourceRef.sourceSpan;
  return (owners.get(`${span.from}:${span.to}`)?.size ?? 0) > 1;
}
