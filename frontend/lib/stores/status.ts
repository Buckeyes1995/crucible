"use client";
import { create } from "zustand";
import { api } from "@/lib/api";

type Status = {
  active_model_id: string | null;
  engine_state: string;
  memory_pressure: number | null;
  thermal_state: string;
  total_memory_bytes: number;
  available_memory_bytes: number;
};

type StatusState = {
  status: Status | null;
  fetch: () => Promise<void>;
};

export const useStatusStore = create<StatusState>((set) => ({
  status: null,
  fetch: async () => {
    try {
      const s = await api.status();
      set({ status: s });
    } catch {
      // silently ignore — status polling should not crash the UI
    }
  },
}));
