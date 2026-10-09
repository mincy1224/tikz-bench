/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { SourceEditTransaction } from "../../packages/app/src/store/source-edit-transaction";
import { applyTextReplacements } from "../../packages/core/src/edit/statement-ops";

beforeEach(() => { useEditorStore.setState(makeInitialState()); });
describe("source gesture ownership", () => {
  it("retains baseline operation patches for the release render and clears them on undo", () => {
    const { dispatch } = useEditorStore.getState();
    dispatch({ type: "CODE_EDITED", source: String.raw`\begin{tikzpicture}\node at (0,0) {A};\end{tikzpicture}` });
    const baseRevision = useEditorStore.getState().sourceRevision;
    const tx = new SourceEditTransaction();
    const from = tx.base.indexOf("(0,0)");
    for (const point of ["(1,0)", "(12.34,0)"]) {
      expect(tx.previewEdit((base) => ({ ...applyTextReplacements(base, [{ span: { from, to: from + 5 }, text: point }]), changedSourceIds: ["path:0"] }))).toBe(true);
    }
    const patches = useEditorStore.getState().lastEditPatches;
    expect(patches).toHaveLength(1);
    expect(tx.finish().kind).toBe("committed");
    expect(useEditorStore.getState().lastEditPatches).toBe(patches);
    expect(useEditorStore.getState().lastEditChangedSourceIds).toEqual(["path:0"]);
    expect(useEditorStore.getState().lastEditPatchBaseRevision).toBe(baseRevision);
    dispatch({ type: "UNDO" });
    expect(useEditorStore.getState().lastEditPatches).toBeNull();
    expect(useEditorStore.getState().source).toBe(tx.base);
  });
  it("commits many baseline previews as one history entry", () => {
    const tx = new SourceEditTransaction();
    for (let i = 0; i < 50; i++) expect(tx.preview((base) => `${base}% ${i}`)).toBe(true);
    expect(useEditorStore.getState().history).toHaveLength(0);
    expect(tx.finish().kind).toBe("committed");
    expect(useEditorStore.getState().history).toHaveLength(1);
    useEditorStore.getState().dispatch({ type: "UNDO" });
    expect(useEditorStore.getState().source).toBe(tx.base);
  });
  it("cancels without a persistent history entry", () => {
    const tx = new SourceEditTransaction(); tx.preview((base) => `${base}% preview`);
    expect(tx.finish(true).kind).toBe("cancelled"); expect(useEditorStore.getState().source).toBe(tx.base);
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
  it("restores the ready baseline scene and rejects late preview snapshots on cancel", () => {
    const initial = useEditorStore.getState();
    const baseline = { ...initial.snapshot, source: initial.source };
    initial.dispatch({ type: "RESTORE_EDIT_PREVIEW_SNAPSHOT", snapshot: baseline, documentId: initial.activeDocumentId });
    const tx = new SourceEditTransaction(); tx.preview((base) => `${base}% preview`);
    const preview = { ...baseline, source: useEditorStore.getState().source };
    initial.dispatch({ type: "COMPUTE_REQUESTED", requestId: "preview" });
    initial.dispatch({ type: "SNAPSHOT_READY", requestId: "preview", snapshot: preview });
    expect(tx.finish(true).kind).toBe("cancelled");
    expect(useEditorStore.getState().snapshot).toBe(baseline);
    initial.dispatch({ type: "SNAPSHOT_READY", requestId: "preview", snapshot: preview });
    expect(useEditorStore.getState().snapshot).toBe(baseline);
  });
  it("invalidates even when external edits return to identical text", () => {
    const tx = new SourceEditTransaction(); const { dispatch } = useEditorStore.getState();
    dispatch({ type: "CODE_EDITED", source: `${tx.base}% manual` }); dispatch({ type: "CODE_EDITED", source: tx.base });
    expect(tx.valid()).toBe(false); expect(tx.preview(() => "stale")).toBe(false);
    expect(tx.finish().kind).toBe("invalidated"); expect(useEditorStore.getState().source).toBe(tx.base);
  });
  it("navigation restores the old preview and leaves the new document intact", () => {
    const tx = new SourceEditTransaction(); tx.preview((base) => `${base}% preview`);
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: "new document" });
    expect(tx.preview(() => "stale")).toBe(false); expect(tx.finish().kind).toBe("cancelled");
    expect(useEditorStore.getState().source).toBe("new document");
    expect(useEditorStore.getState().documents[tx.documentId].source).toBe(tx.base);
  });
});
