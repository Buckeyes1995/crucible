"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type PrivacyState = {
  ephemeral: boolean;
  setEphemeral: (v: boolean) => void;
  toggleEphemeral: () => void;
};

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set) => ({
      ephemeral: false,
      setEphemeral: (v) => set({ ephemeral: v }),
      toggleEphemeral: () => set((s) => ({ ephemeral: !s.ephemeral })),
    }),
    { name: "crucible-privacy" },
  ),
);
