import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Trace } from '../schema/trace'

type RunsState = {
  imported: Trace[]
  transient: Trace[]
  addImported: (trace: Trace) => void
  addTransient: (trace: Trace) => void
  removeImported: (id: string) => void
}

export const useRunsStore = create<RunsState>()(
  persist(
    (set) => ({
      imported: [],
      transient: [],
      addImported: (trace) =>
        set((state) => ({
          imported: [trace, ...state.imported.filter((item) => item.id !== trace.id)],
        })),
      addTransient: (trace) =>
        set((state) => ({
          transient: [trace, ...state.transient.filter((item) => item.id !== trace.id)],
        })),
      removeImported: (id) =>
        set((state) => ({ imported: state.imported.filter((item) => item.id !== id) })),
    }),
    {
      name: 'agent-replay:imports',
      version: 1,
      partialize: (state) => ({ imported: state.imported }),
    },
  ),
)
