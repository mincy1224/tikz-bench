import { useEditorStore } from "./store";
import type { SessionSnapshot } from "../compute";
import type { SourcePatch } from "tikz-editor/edit/types";

export type TransactionResult = { kind: "committed" | "cancelled" | "unchanged" | "invalidated" };

/** A gesture owns one immutable source baseline and never writes over another edit. */
export class SourceEditTransaction {
  readonly documentId: string;
  readonly base: string;
  private last: string;
  private ended = false;
  private revision: number;
  private readonly baseRevision: number;
  private readonly figureId: string | null;
  private readonly baselineSnapshot: SessionSnapshot | null;
  constructor(private readonly label = "修改格式") {
    const state = useEditorStore.getState();
    this.documentId = state.activeDocumentId;
    this.base = this.last = state.source;
    this.revision = state.sourceRevision;
    this.baseRevision = state.sourceRevision;
    this.figureId = state.activeFigureId;
    this.baselineSnapshot = state.snapshot.source === this.base ? state.snapshot : null;
  }
  preview(build: (base: string) => string, changedSourceIds?: readonly string[], patches?: readonly SourcePatch[]): boolean {
    if (!this.valid()) return false;
    const next = build(this.base);
    useEditorStore.getState().dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: this.documentId, source: next, changedSourceIds: changedSourceIds ? [...changedSourceIds] : undefined, patches: patches ? [...patches] : undefined, patchBaseRevision: patches ? this.baseRevision : undefined });
    if (useEditorStore.getState().documents[this.documentId].source !== next) return false;
    this.last = next;
    this.revision = useEditorStore.getState().documents[this.documentId].sourceRevision;
    return true;
  }
  previewEdit(build: (base: string) => { source: string; patches: readonly SourcePatch[]; changedSourceIds?: readonly string[] }): boolean {
    if (!this.valid()) return false;
    const edit = build(this.base);
    return this.preview(() => edit.source, edit.changedSourceIds, edit.patches);
  }
  /** Adapter for existing synchronous transient edit callbacks. */
  previewMutation(apply: () => void): boolean {
    if (!this.valid()) return false;
    apply();
    const documents = useEditorStore.getState().documents;
    if (!Object.hasOwn(documents, this.documentId)) return false;
    const document = documents[this.documentId];
    this.last = document.source;
    this.revision = document.sourceRevision;
    return true;
  }
  finish(cancel = false): TransactionResult {
    if (!this.ownsCurrentRevision()) { this.ended = true; return { kind: "invalidated" }; }
    const state = useEditorStore.getState();
    // Navigation may happen before effect cleanup. Roll back only this owned
    // preview in the former document, never apply edits to the new document.
    cancel ||= state.activeDocumentId !== this.documentId || state.documents[this.documentId].activeFigureId !== this.figureId;
    if (this.last === this.base) { this.ended = true; return { kind: "unchanged" }; }
    if (cancel) {
      state.dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: this.documentId, source: this.base });
      if (this.baselineSnapshot && state.documents[this.documentId].activeFigureId === this.figureId) state.dispatch({ type: "RESTORE_EDIT_PREVIEW_SNAPSHOT", documentId: this.documentId, snapshot: this.baselineSnapshot });
    }
    else state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", documentId: this.documentId, source: this.last, expectedSource: this.last, label: this.label });
    this.ended = true;
    return { kind: cancel ? "cancelled" : "committed" };
  }
  valid(): boolean {
    const state = useEditorStore.getState();
    return state.activeDocumentId === this.documentId && state.activeFigureId === this.figureId && this.ownsCurrentRevision();
  }
  private ownsCurrentRevision(): boolean {
    const { documents } = useEditorStore.getState();
    return !this.ended && Object.hasOwn(documents, this.documentId) && documents[this.documentId].source === this.last && documents[this.documentId].sourceRevision === this.revision;
  }
}
