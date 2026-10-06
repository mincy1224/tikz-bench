import { parseTikzForEdit } from "tikz-editor/edit/parse-options";
import { evaluateTikzFigure } from "tikz-editor/semantic/evaluate";
import { useCallback, useEffect, useRef } from "react";
import { applyEditAction } from "tikz-editor/edit/actions";
import { pt, worldPoint } from "tikz-editor/coords/index";
import type { EditHandle } from "tikz-editor/semantic/types";
import { SourceEditTransaction } from "../../store/source-edit-transaction";
import { useEditorStore } from "../../store/store";

export function useKeyboardNudge(onError: (message: string) => void) {
  const documentId = useEditorStore((state) => state.activeDocumentId);
  const selectionKey = useEditorStore((state) => [...state.selectedElementIds].sort().join("\0"));
  const gesture = useRef<{ transaction: SourceEditTransaction; figureId: string | null; ids: string[]; handles: EditHandle[]; x: number; y: number; frame: number | null; keys: Set<string> } | null>(null);
  const flush = useCallback(() => {
    const current = gesture.current;
    if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    current.frame = null;
    try {
      current.transaction.preview((base) => {
        const result = applyEditAction(base, current.handles, { kind: "moveElements", elementIds: current.ids, delta: worldPoint(pt(current.x), pt(current.y)) }, { parseOptions: { sourceFingerprint: current.handles[0]?.sourceRef.sourceFingerprint, activeFigureId: current.figureId } });
        if (result.kind !== "success") throw new Error(result.kind === "error" ? result.message : result.reason);
        return result.newSource;
      });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }, [onError]);
  const finish = useCallback((cancel = false) => {
    const current = gesture.current;
    if (!current) return;
    if (cancel) { if (current.frame !== null) cancelAnimationFrame(current.frame); }
    else flush();
    current.transaction.finish(cancel);
    gesture.current = null;
  }, [flush]);
  useEffect(() => {
    const keyup = (event: KeyboardEvent) => {
      gesture.current?.keys.delete(event.key);
      if (gesture.current?.keys.size === 0) finish();
    };
    const blur = () => { finish(); };
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => { finish(); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", blur); };
  }, [documentId, selectionKey, finish]);
  return {
    cancel: () => { if (!gesture.current) return false; finish(true); return true; },
    nudge: (key: string, x: number, y: number, ids: string[], _handles: EditHandle[]) => {
      if (!gesture.current) {
        const transaction = new SourceEditTransaction("移动"); const figureId = useEditorStore.getState().activeFigureId;
        const parsed = parseTikzForEdit(transaction.base, { activeFigureId: figureId });
        const handles = evaluateTikzFigure(parsed.figure, transaction.base).editHandles;
        gesture.current = { transaction, figureId, ids, handles, x: 0, y: 0, frame: null, keys: new Set<string>() };
      }
      const current = gesture.current;
      current.keys.add(key); current.x += x; current.y += y;
      current.frame ??= requestAnimationFrame(flush);
    }
  };
}
