import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { InspectorDescriptor } from "tikz-editor/edit/inspector";
import type { EditorAction } from "../../store/types";
import { useEditorStore } from "../../store/store";
import { createNumberScrubState, updateNumberScrubState } from "./number-scrub";
import type { InspectorPropertyProvenanceMap, MultiInspectorModel } from "./panel-helpers";
import type { FrozenInspectorView } from "./useInspectorModel";

type NumberLabelScrubBinding = {
  writable: boolean;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

type HoverPreviewSession = {
  ownerKey: string;
  baseSource: string;
  lastSource: string;
  documentId: string;
};

type NumberLabelScrubSession = {
  pointerId: number;
  baseSource: string;
  lastSource: string;
  documentId: string;
  state: ReturnType<typeof createNumberScrubState>;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

export function useInspectorPreviewScrub(args: {
  dispatch: (action: EditorAction) => void;
  selectedSourceIds: string[];
  descriptor: InspectorDescriptor | null;
  multiModel: MultiInspectorModel | null;
  singlePropertyProvenance: InspectorPropertyProvenanceMap;
  multiPropertyProvenance: InspectorPropertyProvenanceMap;
  setFrozenInspectorView: (v: FrozenInspectorView | null) => void;
}) {
  const {
    dispatch,
    selectedSourceIds,
    descriptor,
    multiModel,
    singlePropertyProvenance,
    multiPropertyProvenance,
    setFrozenInspectorView
  } = args;

  const hoverPreviewSessionRef = useRef<HoverPreviewSession | null>(null);
  const numberLabelScrubSessionRef = useRef<NumberLabelScrubSession | null>(null);
  const numberLabelScrubListenersAttachedRef = useRef(false);
  const selectedChangedSourceIds = useMemo(
    () => selectedSourceIds.length > 0 ? selectedSourceIds : null,
    [selectedSourceIds]
  );

  const clearHoverPreviewSession = useCallback((ownerKey?: string) => {
    const current = hoverPreviewSessionRef.current;
    if (!current) {
      return;
    }
    if (ownerKey && current.ownerKey !== ownerKey) {
      return;
    }
    const currentSource = useEditorStore.getState().source;
    if (currentSource !== current.baseSource && currentSource === current.lastSource && useEditorStore.getState().activeDocumentId === current.documentId) {
      dispatch({
        type: "SET_SOURCE_TRANSIENT",
        source: current.baseSource,
        changedSourceIds: selectedChangedSourceIds
      });
    }
    hoverPreviewSessionRef.current = null;
    setFrozenInspectorView(null);
  }, [dispatch, selectedChangedSourceIds, setFrozenInspectorView]);

  const restoreHoverPreviewBase = useCallback((ownerKey?: string) => {
    const current = hoverPreviewSessionRef.current;
    if (!current) {
      return;
    }
    if (ownerKey && current.ownerKey !== ownerKey) {
      return;
    }
    const currentSource = useEditorStore.getState().source;
    if (currentSource !== current.baseSource && currentSource === current.lastSource && useEditorStore.getState().activeDocumentId === current.documentId) {
      dispatch({
        type: "SET_SOURCE_TRANSIENT",
        source: current.baseSource,
        changedSourceIds: selectedChangedSourceIds
      });
      current.lastSource = current.baseSource;
    }
  }, [dispatch, selectedChangedSourceIds]);

  const ensureHoverPreviewSession = useCallback((ownerKey: string) => {
    const current = hoverPreviewSessionRef.current;
    if (!current) {
      hoverPreviewSessionRef.current = {
        ownerKey,
        baseSource: useEditorStore.getState().source,
        lastSource: useEditorStore.getState().source,
        documentId: useEditorStore.getState().activeDocumentId
      };
      setFrozenInspectorView({
        selectedSourceIds: [...selectedSourceIds],
        descriptor,
        multiModel,
        singlePropertyProvenance,
        multiPropertyProvenance
      });
      return;
    }
    if (current.ownerKey === ownerKey) {
      return;
    }
    const currentSource = useEditorStore.getState().source;
    if (currentSource !== current.baseSource && currentSource === current.lastSource && useEditorStore.getState().activeDocumentId === current.documentId) {
      dispatch({
        type: "SET_SOURCE_TRANSIENT",
        source: current.baseSource,
        changedSourceIds: selectedChangedSourceIds
      });
    }
    hoverPreviewSessionRef.current = {
      ownerKey,
      baseSource: current.baseSource,
      lastSource: current.baseSource,
      documentId: current.documentId
    };
  }, [descriptor, dispatch, multiModel, multiPropertyProvenance, selectedChangedSourceIds, selectedSourceIds, setFrozenInspectorView, singlePropertyProvenance]);

  const applyHoverPreview = useCallback((ownerKey: string, applyPreview: () => void) => {
    const existing = hoverPreviewSessionRef.current;
    const state = useEditorStore.getState();
    if (existing && (existing.documentId !== state.activeDocumentId || existing.lastSource !== state.source)) {
      hoverPreviewSessionRef.current = null;
      setFrozenInspectorView(null);
      return;
    }
    ensureHoverPreviewSession(ownerKey);
    applyPreview();
    const session = hoverPreviewSessionRef.current;
    if (session) session.lastSource = useEditorStore.getState().source;
  }, [ensureHoverPreviewSession, setFrozenInspectorView]);

  const commitAfterHoverPreview = useCallback((ownerKey: string, commit: () => void) => {
    const current = hoverPreviewSessionRef.current;
    if (current?.ownerKey === ownerKey) {
      const currentSource = useEditorStore.getState().source;
      if (currentSource !== current.lastSource || useEditorStore.getState().activeDocumentId !== current.documentId) {
        hoverPreviewSessionRef.current = null;
        setFrozenInspectorView(null);
        return;
      }
      if (currentSource !== current.baseSource && currentSource === current.lastSource && useEditorStore.getState().activeDocumentId === current.documentId) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: current.baseSource,
          changedSourceIds: selectedChangedSourceIds
        });
      }
      hoverPreviewSessionRef.current = null;
      setFrozenInspectorView(null);
    }
    commit();
  }, [dispatch, selectedChangedSourceIds, setFrozenInspectorView]);

  const stopNumberLabelScrubRef = useRef<(commit: boolean, pointerId?: number) => void>(() => {});

  const handleNumberLabelScrubPointerMove = useCallback((event: PointerEvent) => {
    const session = numberLabelScrubSessionRef.current;
    if (event.pointerId !== session?.pointerId) {
      return;
    }

    const result = updateNumberScrubState(session.state, {
      currentX: event.clientX,
      modifiers: {
        shiftKey: event.shiftKey,
        altKey: event.altKey
      }
    });
    session.state = result.nextState;
    if (result.didActivate) {
      document.body.classList.add("is-scrubbing");
    }
    if (result.nextValue == null) {
      return;
    }
    if (useEditorStore.getState().source !== session.lastSource) { stopNumberLabelScrubRef.current(false); return; }
    session.onPreview(result.nextValue);
    session.lastSource = useEditorStore.getState().source;
  }, []);

  const handleNumberLabelScrubPointerUp = useCallback((event: PointerEvent) => {
    stopNumberLabelScrubRef.current(true, event.pointerId);
  }, []);

  const handleNumberLabelScrubPointerCancel = useCallback((event: PointerEvent) => {
    stopNumberLabelScrubRef.current(false, event.pointerId);
  }, []);

  const handleNumberLabelScrubWindowBlur = useCallback(() => {
    stopNumberLabelScrubRef.current(false);
  }, []);

  const removeNumberLabelScrubListeners = useCallback(() => {
    if (!numberLabelScrubListenersAttachedRef.current) {
      return;
    }
    window.removeEventListener("pointermove", handleNumberLabelScrubPointerMove);
    window.removeEventListener("pointerup", handleNumberLabelScrubPointerUp);
    window.removeEventListener("pointercancel", handleNumberLabelScrubPointerCancel);
    window.removeEventListener("blur", handleNumberLabelScrubWindowBlur);
    numberLabelScrubListenersAttachedRef.current = false;
  }, [
    handleNumberLabelScrubPointerCancel,
    handleNumberLabelScrubPointerMove,
    handleNumberLabelScrubPointerUp,
    handleNumberLabelScrubWindowBlur
  ]);

  const stopNumberLabelScrub = useCallback((commit: boolean, pointerId?: number) => {
    const session = numberLabelScrubSessionRef.current;
    if (!session || (pointerId != null && pointerId !== session.pointerId)) {
      return;
    }
    numberLabelScrubSessionRef.current = null;
    removeNumberLabelScrubListeners();

    if (session.state.hasActivated) {
      const currentSource = useEditorStore.getState().source;
      if (currentSource !== session.baseSource && currentSource === session.lastSource && useEditorStore.getState().activeDocumentId === session.documentId) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: session.baseSource,
          changedSourceIds: selectedChangedSourceIds
        });
      }
      if (commit && currentSource === session.lastSource && useEditorStore.getState().activeDocumentId === session.documentId) {
        session.onCommit(session.state.lastValue);
      }
    }

    document.body.classList.remove("is-scrubbing");
  }, [dispatch, removeNumberLabelScrubListeners, selectedChangedSourceIds]);

  useEffect(() => {
    stopNumberLabelScrubRef.current = stopNumberLabelScrub;
  }, [stopNumberLabelScrub]);

  const ensureNumberLabelScrubListeners = useCallback(() => {
    if (numberLabelScrubListenersAttachedRef.current) {
      return;
    }
    window.addEventListener("pointermove", handleNumberLabelScrubPointerMove);
    window.addEventListener("pointerup", handleNumberLabelScrubPointerUp);
    window.addEventListener("pointercancel", handleNumberLabelScrubPointerCancel);
    window.addEventListener("blur", handleNumberLabelScrubWindowBlur);
    numberLabelScrubListenersAttachedRef.current = true;
  }, [
    handleNumberLabelScrubPointerCancel,
    handleNumberLabelScrubPointerMove,
    handleNumberLabelScrubPointerUp,
    handleNumberLabelScrubWindowBlur
  ]);

  const beginNumberLabelScrub = useCallback((event: ReactPointerEvent<HTMLElement>, binding: NumberLabelScrubBinding) => {
    if (!binding.writable || event.button !== 0 || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    clearHoverPreviewSession();
    stopNumberLabelScrub(false);

    numberLabelScrubSessionRef.current = {
      pointerId: event.pointerId,
      baseSource: useEditorStore.getState().source,
        lastSource: useEditorStore.getState().source,
        documentId: useEditorStore.getState().activeDocumentId,
      state: createNumberScrubState({
        startX: event.clientX,
        startValue: binding.value,
        step: binding.step,
        min: binding.min,
        max: binding.max
      }),
      onPreview: binding.onPreview,
      onCommit: binding.onCommit
    };
    ensureNumberLabelScrubListeners();
  }, [clearHoverPreviewSession, ensureNumberLabelScrubListeners, stopNumberLabelScrub]);

  useEffect(() => {
    clearHoverPreviewSession();
    stopNumberLabelScrub(false);
  }, [selectedSourceIds, clearHoverPreviewSession, stopNumberLabelScrub]);

  useEffect(() => {
    return () => {
      clearHoverPreviewSession();
      stopNumberLabelScrub(false);
    };
  }, [clearHoverPreviewSession, stopNumberLabelScrub]);

  return {
    clearHoverPreviewSession,
    restoreHoverPreviewBase,
    applyHoverPreview,
    commitAfterHoverPreview,
    beginNumberLabelScrub
  };
}
