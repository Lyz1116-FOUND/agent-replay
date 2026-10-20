import { create } from 'zustand'

type UiState = {
  importOpen: boolean
  setImportOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  importOpen: false,
  setImportOpen: (importOpen) => set({ importOpen }),
}))
