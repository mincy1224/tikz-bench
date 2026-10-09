import { parseTikzForEdit } from "tikz-editor/edit/parse-options";
import { evaluateTikzFigure } from "tikz-editor/semantic/evaluate";
import { useCallback, useEffect, useRef } from "react";
import { prepareTranslation, type PreparedTranslation } from "tikz-editor/edit/prepared-translation";
import { createElementTranslationPreview, type ElementTranslationPreview } from "./element-translation-preview";
import { pt, worldPoint } from "tikz-editor/coords/index";
import type { EditHandle } from "tikz-editor/semantic/types";
import { SourceEditTransaction } from "../../store/source-edit-transaction";
import { previewTranslation, commitTranslationPreview } from "./translation-executor";
import { useEditorStore } from "../../store/store";

export function useKeyboardNudge(onError: (message: string) => void) {
  const documentId = useEditorStore((state) => state.activeDocumentId);
  const selectionKey = useEditorStore((state) => [...state.selectedElementIds].sort().join("\0"));
  const snapshotSource = useEditorStore((state) => state.snapshot.source);
  const source = useEditorStore((state) => state.source);
  const committed = useRef<{ source: string; visual: ElementTranslationPreview } | null>(null);
  useEffect(() => { if (committed.current && (committed.current.source === snapshotSource || source !== committed.current.source)) { committed.current.visual.restore(); committed.current = null; } }, [snapshotSource, source]);
  const gesture = useRef<{ transaction: SourceEditTransaction; plan: PreparedTranslation; visual: ElementTranslationPreview | null; x: number; y: number; frame: number | null; keys: Set<string> } | null>(null);
  const flush = useCallback(() => {
    const current = gesture.current;
    if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    current.frame = null;
    try {
      previewTranslation(current.transaction, current.plan, current.visual, worldPoint(pt(current.x), pt(current.y)));
    } catch (error) { current.visual?.restore(); current.transaction.finish(true); gesture.current = null; useEditorStore.getState().dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: null }); onError(error instanceof Error ? error.message : String(error)); }
  }, [onError]);
  const finish = useCallback((cancel = false) => {
    const current = gesture.current;
    if (!current) return;
    if (cancel) { if (current.frame !== null) cancelAnimationFrame(current.frame); }
    else flush();
    if (gesture.current !== current) return;
    try { if (current.visual) {
      if (cancel) current.visual.restore();
      else {
        const final = commitTranslationPreview(current.transaction, current.plan, worldPoint(pt(current.x), pt(current.y)));
        if (final !== current.transaction.base) committed.current = { source: final, visual: current.visual };
        else current.visual.restore();
      }
    }
    } catch (error) { current.visual?.restore(); current.transaction.finish(true); onError(error instanceof Error ? error.message : String(error)); }
    current.transaction.finish(cancel);
    gesture.current = null;
    useEditorStore.getState().dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: null });
  }, [flush, onError]);
  useEffect(() => () => { committed.current?.visual.restore(); committed.current = null; }, []);
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
        committed.current?.visual.restore(); committed.current = null;
        useEditorStore.getState().dispatch({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
        const transaction = new SourceEditTransaction("移动"); const state = useEditorStore.getState(), figureId = state.activeFigureId;
        const parsed = state.snapshot.source === transaction.base && state.snapshot.parseResult ? state.snapshot.parseResult : parseTikzForEdit(transaction.base, { activeFigureId: figureId });
        const semantic = state.snapshot.source === transaction.base && state.snapshot.semanticResult ? state.snapshot.semanticResult : evaluateTikzFigure(parsed.figure, transaction.base);
        const plan = prepareTranslation(transaction.base, semantic.editHandles, ids, { activeFigureId: figureId }, semantic, parsed);
        if (!plan) { onError("选区无法安全移动，未修改任何对象。"); return; }
        const visual = createElementTranslationPreview(document.querySelector('[data-canvas-viewport="true"]'), plan, semantic.editHandles, semantic.dependencies, semantic.scene.elements);
        gesture.current = { transaction, plan, visual, x: 0, y: 0, frame: null, keys: new Set<string>() };
        state.dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: "element" });
      }
      const current = gesture.current;
      current.keys.add(key); current.x += x; current.y += y;
      current.frame ??= requestAnimationFrame(flush);
    }
  };
}
