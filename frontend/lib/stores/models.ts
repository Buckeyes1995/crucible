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
  cancelLoad: () => Promise<void>;
  stopModel: () => Promise<void>;
};

// Held outside Zustand state so it's never stale in closures
let _loadAbortController: AbortController | null = null;

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
    // Abort any in-progress load
    _loadAbortController?.abort();
    const controller = new AbortController();
    _loadAbortController = controller;

    set({ loadingModelId: id, loadStage: "starting", error: null, activeModelId: null });
    let gotCompletion = false;
    try {
      const { readSSE } = await import("@/lib/api");
      const resp = await api.models.load(id, controller.signal);

      // Catch non-streaming error responses before attempting SSE read
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        let msg = `Load failed (${resp.status})`;
        try { msg = JSON.parse(body).detail ?? msg; } catch { /* raw text */ }
        if (body && !body.startsWith("{")) msg = body.slice(0, 200);
        set({ error: msg, loadingModelId: null, loadStage: "" });
        return;
      }

      await readSSE(
        resp,
        (data) => {
          if (controller.signal.aborted) return;
          const event = data.event as string;
          const payload = data.data as Record<string, unknown> | undefined;
          if (event === "stage") {
            set({ loadStage: (payload?.message as string) ?? "" });
          } else if (event === "done") {
            gotCompletion = true;
            // Verify with status API rather than trusting the SSE event blindly
            api.status().then((s) => {
              set({ activeModelId: s.active_model_id, loadingModelId: null, loadStage: "" });
            }).catch(() => {
              set({ activeModelId: id, loadingModelId: null, loadStage: "" });
            });
          } else if (event === "error") {
            gotCompletion = true;
            set({
              error: (payload?.message as string) ?? "Unknown error",
              loadingModelId: null,
              loadStage: "",
            });
          }
        },
        (err) => {
          if (controller.signal.aborted) return; // expected — user cancelled
          set({ error: err.message, loadingModelId: null, loadStage: "" });
        }
      );

      // Stream ended without a done/error event — clear stuck state
      if (!gotCompletion && !controller.signal.aborted) {
        set({ error: "Load stream ended unexpectedly", loadingModelId: null, loadStage: "" });
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") return; // user cancelled, no error
      set({ error: String(e), loadingModelId: null, loadStage: "" });
    }
  },

  cancelLoad: async () => {
    _loadAbortController?.abort();
    _loadAbortController = null;
    set({ loadingModelId: null, loadStage: "", error: null });
    // Also tell the backend to stop — this kills the subprocess
    await api.models.stop().catch(() => {});
  },

  stopModel: async () => {
    await api.models.stop();
    set({ activeModelId: null });
  },
}));
