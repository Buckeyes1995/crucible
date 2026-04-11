"use client";
import { create } from "zustand";
import { api, type ModelEntry } from "@/lib/api";

type ModelsState = {
  models: ModelEntry[];
  activeModelId: string | null;   // ground truth from /api/status
  loading: boolean;
  loadingModelId: string | null;
  loadStage: string;
  error: string | null;

  fetchModels: () => Promise<void>;
  refreshModels: () => Promise<void>;
  syncStatus: () => Promise<void>;
  loadModel: (id: string) => Promise<void>;
  stopModel: () => Promise<void>;
};

export const useModelsStore = create<ModelsState>((set) => ({
  models: [],
  activeModelId: null,
  loading: false,
  loadingModelId: null,
  loadStage: "",
  error: null,

  syncStatus: async () => {
    try {
      const status = await api.status();
      set({ activeModelId: status.active_model_id });
    } catch {
      // non-fatal
    }
  },

  fetchModels: async () => {
    set({ loading: true, error: null });
    try {
      const [models, status] = await Promise.all([api.models.list(), api.status()]);
      set({ models, loading: false, activeModelId: status.active_model_id });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  refreshModels: async () => {
    set({ loading: true, error: null });
    try {
      const models = await api.models.refresh();
      set({ models, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadModel: async (id: string) => {
    set({ loadingModelId: id, loadStage: "starting", error: null, activeModelId: null });
    try {
      const { readSSE } = await import("@/lib/api");
      const resp = await api.models.load(id);
      await readSSE(
        resp,
        (data) => {
          const event = data.event as string;
          const payload = data.data as Record<string, unknown> | undefined;
          if (event === "stage") {
            set({ loadStage: (payload?.message as string) ?? "" });
          } else if (event === "done") {
            // Verify with status API rather than trusting the SSE event blindly
            api.status().then((s) => {
              set({ activeModelId: s.active_model_id, loadingModelId: null, loadStage: "" });
            }).catch(() => {
              set({ activeModelId: id, loadingModelId: null, loadStage: "" });
            });
          } else if (event === "error") {
            set({
              error: (payload?.message as string) ?? "Unknown error",
              loadingModelId: null,
              loadStage: "",
            });
          }
        },
        (err) => set({ error: err.message, loadingModelId: null, loadStage: "" })
      );
    } catch (e) {
      set({ error: String(e), loadingModelId: null, loadStage: "" });
    }
  },

  stopModel: async () => {
    await api.models.stop();
    set({ activeModelId: null });
  },
}));
