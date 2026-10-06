import { create } from "zustand";
export const useResizePreference = create<{ whole: boolean; set: (whole: boolean) => void }>((set) => ({ whole: false, set: (whole) => { set({ whole }); } }));
