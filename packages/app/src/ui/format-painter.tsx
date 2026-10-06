import { useEffect } from "react";
import { create } from "zustand";
import { applyFormat, captureFormat, editableObjects, type FormatSnapshot } from "tikz-editor/edit/editable-objects";
import { useEditorStore } from "../store/store";

export const useFormatPainter = create<{ snapshot: FormatSnapshot | null; documentId: string | null; message: string; set: (snapshot: FormatSnapshot | null, documentId: string | null, message?: string) => void }>((set) => ({
  snapshot: null, documentId: null, message: "", set: (snapshot, documentId, message = "") => { set({ snapshot, documentId, message }); }
}));

export function paintObject(id: string): boolean {
  const painter = useFormatPainter.getState();
  if (!painter.snapshot) return false;
  const state = useEditorStore.getState();
  if (painter.documentId !== state.activeDocumentId) { painter.set(null, null); return false; }
  try {
    const object = editableObjects(state.source, state.snapshot.scene?.elements).find((candidate) => candidate.id === id);
    if (!object || object.type === "group") throw new Error("此对象不支持格式刷；组合请先选择内部对象。");
    const source = applyFormat(state.source, object, painter.snapshot);
    state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", source, expectedSource: state.source, label: "格式刷" });
    painter.set(painter.snapshot, painter.documentId, "已应用格式；可继续点击同类型对象。");
  } catch (error) { painter.set(painter.snapshot, painter.documentId, error instanceof Error ? error.message : String(error)); }
  return true;
}

export function FormatPainterButton() {
  const state = useEditorStore();
  const painter = useFormatPainter();
  useEffect(() => {
    if (painter.documentId && painter.documentId !== state.activeDocumentId) painter.set(null, null);
  }, [painter, state.activeDocumentId]);
  const selected = [...state.selectedElementIds];
  return <button type="button" aria-label="格式刷" aria-pressed={Boolean(painter.snapshot)} disabled={!painter.snapshot && selected.length !== 1}
    title={painter.message || "复制颜色、字号和线宽；再次点击关闭"}
    style={{ border: "1px solid var(--color-border, #aaa)", borderRadius: 5, padding: "5px 9px", background: painter.snapshot ? "#dbeafe" : "transparent", color: painter.snapshot ? "#174da3" : "inherit" }}
    onClick={() => {
      if (painter.snapshot) { painter.set(null, null); return; }
      const object = editableObjects(state.source, state.snapshot.scene?.elements).find((candidate) => candidate.id === selected[0]);
      if (!object || object.type === "group") { painter.set(null, null, "请选择具体组件，组合不支持整体刷。"); return; }
      const snapshot = captureFormat(object);
      painter.set(snapshot, state.activeDocumentId, snapshot.skipped.length ? `已跳过 ${snapshot.skipped.join("、")}` : "点击同类型组件应用格式");
      state.dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    }}>🖌 格式刷</button>;
}
