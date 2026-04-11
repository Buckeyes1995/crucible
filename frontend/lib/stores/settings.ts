"use client";
import { create } from "zustand";
import { api, type CrucibleConfig } from "@/lib/api";

type SettingsState = {
  config: CrucibleConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;

  fetchSettings: () => Promise<void>;
  saveSettings: (cfg: CrucibleConfig) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  config: null,
  loading: false,
  saving: false,
  error: null,

  fetchSettings: async () => {
    set({ loading: true, error: null });
    try {
      const config = await api.settings.get();
      set({ config, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveSettings: async (cfg) => {
    set({ saving: true, error: null });
    try {
      const saved = await api.settings.save(cfg);
      set({ config: saved, saving: false });
    } catch (e) {
      set({ error: String(e), saving: false });
    }
  },
}));
