"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type AliasesState = {
  aliases: Record<string, string>; // model_id → alias
  setAlias: (id: string, alias: string) => void;
  clearAlias: (id: string) => void;
  getAlias: (id: string) => string | undefined;
};

export const useAliasesStore = create<AliasesState>()(
  persist(
    (set, get) => ({
      aliases: {},
      setAlias: (id, alias) =>
        set((s) => ({ aliases: { ...s.aliases, [id]: alias } })),
      clearAlias: (id) =>
        set((s) => {
          const next = { ...s.aliases };
          delete next[id];
          return { aliases: next };
        }),
      getAlias: (id) => get().aliases[id],
    }),
    { name: "crucible-aliases" }
  )
);
