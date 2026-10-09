import { create } from "zustand";

/** A matrix is selected as an object until the user explicitly enters its cells. */
export const useMatrixEditing = create<{
  documentId: string | null; matrixId: string | null;
  enter: (documentId: string, matrixId: string) => void; leave: () => void;
}>((set) => ({ documentId: null, matrixId: null,
  enter: (documentId, matrixId) => { set({ documentId, matrixId }); },
  leave: () => { set({ documentId: null, matrixId: null }); }
}));
