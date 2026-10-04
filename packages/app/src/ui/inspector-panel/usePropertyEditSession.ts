import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../store/store";

export function usePropertyEditSession(targetKey: string) {
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ base: string; last: string; documentId: string } | null>(null);
  const cancel = useCallback(() => {
    const current = session.current;
    session.current = null;
    const state = useEditorStore.getState();
    if (state.activeDocumentId === current?.documentId && state.source === current.last) {
      state.dispatch({ type: "SET_SOURCE_TRANSIENT", source: current.base });
    }
  }, []);
  useEffect(() => cancel, [cancel, targetKey]);
  const update = useCallback((build: (source: string) => string, preview: boolean) => {
    const state = useEditorStore.getState();
    const current = session.current ?? { base: state.source, last: state.source, documentId: state.activeDocumentId };
    if (current.documentId !== state.activeDocumentId || current.last !== state.source) {
      session.current = null;
      return;
    }
    let source: string;
    try { source = build(current.base); setError(null); }
    catch (error_) { setError(error_ instanceof Error ? error_.message : String(error_)); return; }
    if (preview) {
      session.current = { ...current, last: source };
      state.dispatch({ type: "SET_SOURCE_TRANSIENT", source });
    } else {
      session.current = null;
      state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", source, expectedSource: state.source });
    }
  }, []);
  const previewMutation = useCallback((apply: () => void) => {
    const state = useEditorStore.getState();
    const current = session.current ?? { base: state.source, last: state.source, documentId: state.activeDocumentId };
    if (current.documentId !== state.activeDocumentId || current.last !== state.source) { session.current = null; return; }
    apply();
    session.current = { ...current, last: useEditorStore.getState().source };
  }, []);
  const commitPreview = useCallback(() => {
    const current = session.current;
    const state = useEditorStore.getState();
    session.current = null;
    if (current?.documentId === state.activeDocumentId && current.last === state.source) {
      state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", source: current.last, expectedSource: current.last });
    }
  }, []);
  return { update, cancel, error, previewMutation, commitPreview };
}
