import { useEditorStore } from "./store";

/** A gesture owns one immutable source baseline and never writes over another edit. */
export class SourceEditTransaction {
  readonly documentId: string;
  readonly base: string;
  private last: string;
  private ended = false;
  constructor(private readonly label = "修改格式") {
    const state = useEditorStore.getState();
    this.documentId = state.activeDocumentId;
    this.base = this.last = state.source;
  }
  preview(build: (base: string) => string): boolean {
    if (!this.valid()) return false;
    const next = build(this.base);
    useEditorStore.getState().dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: this.documentId, source: next });
    this.last = next;
    return true;
  }
  /** Adapter for existing synchronous transient edit callbacks. */
  previewMutation(apply: () => void): boolean {
    if (!this.valid()) return false;
    apply();
    const documents = useEditorStore.getState().documents;
    if (!Object.hasOwn(documents, this.documentId)) return false;
    const document = documents[this.documentId];
    this.last = document.source;
    return true;
  }
  finish(cancel = false): void {
    if (!this.valid()) { this.ended = true; return; }
    const state = useEditorStore.getState();
    if (cancel) state.dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: this.documentId, source: this.base });
    else state.dispatch({ type: "COMMIT_PROPERTY_SOURCE", documentId: this.documentId, source: this.last, expectedSource: this.last, label: this.label });
    this.ended = true;
  }
  private valid(): boolean {
    const documents = useEditorStore.getState().documents;
    return !this.ended && Object.hasOwn(documents, this.documentId) && documents[this.documentId].source === this.last;
  }
}
