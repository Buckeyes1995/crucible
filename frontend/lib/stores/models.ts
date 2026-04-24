"use client";
import { create } from "zustand";
import { api, type ModelEntry } from "@/lib/api";
import { toast } from "@/components/Toast";

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

// Translate cryptic adapter errors into actionable hints (#166, #167).
// Most useful pattern today: oMLX's DFlash code path crashes with
//   "generate_dflash_once() got an unexpected keyword argument 'temperature'"
// surfacing as a generic "peer closed connection without sending complete
// message body". Detect either form and tell the user what to do.
function explainLoadError(raw: string): string {
  const r = (raw || "").toLowerCase();
  if (r.includes("generate_dflash_once") || (r.includes("dflash") && r.includes("argument"))) {
    return "DFlash engine crashed in oMLX (upstream bug). Open the model's Notes dialog and disable DFlash, then retry.";
  }
  if (r.includes("peer closed connection") || r.includes("incomplete chunked read")) {
    return "oMLX warmup failed — likely DFlash crash or OOM. If the model is DFlash-eligible, disable DFlash in Notes. Otherwise check oMLX logs.";
  }
  if (r.includes("not found. available models")) {
    return "oMLX hasn't seen this model yet. The auto-kick should fire after downloads — try restarting oMLX manually if this persists.";
  }
  return raw || "Unknown error";
}

export const useModelsStore = create<ModelsState>((set, get) => ({
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

    // Remember the previous active model so we can restore it on failure
    // (#167) — otherwise the chat page falsely shows "No model loaded"
    // when the prior model is still warm on the inference engine.
    const prev = (get() as { activeModelId: string | null }).activeModelId;
    set({ loadingModelId: id, loadStage: "starting", error: null, activeModelId: null });
    const loadingToastId = toast(`Loading ${id.replace(/^mlx:/, "")}…`, "loading", 0);
    let gotCompletion = false;

    const failWith = (raw: string) => {
      const msg = explainLoadError(raw);
      import("@/components/Toast").then(({ toastUpdate }) =>
        toastUpdate(loadingToastId, msg, "error"));
      set({ error: msg, loadingModelId: null, loadStage: "", activeModelId: prev });
    };

    // Abort path: if THIS controller is still the tracked one, nobody else
    // will clean up the loadingModelId/stage/toast — do it ourselves.
    // Skip if a newer loadModel replaced us (state is theirs), if cancelLoad
    // ran (null'd the tracker and cleared state already), or if done already
    // fired (state is correctly set to the loaded model).
    const cleanupIfOrphaned = () => {
      if (gotCompletion) return;
      if (_loadAbortController !== controller) return;
      _loadAbortController = null;
      set({ loadingModelId: null, loadStage: "", activeModelId: prev });
      import("@/components/Toast").then(({ toastUpdate }) =>
        toastUpdate(loadingToastId, `${id.replace(/^mlx:/, "")} load cancelled`, "info"));
    };

    try {
      const { readSSE } = await import("@/lib/api");
      const resp = await api.models.load(id, controller.signal);

      // Catch non-streaming error responses before attempting SSE read
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        let raw = `Load failed (${resp.status})`;
        try { raw = JSON.parse(body).detail ?? raw; } catch { /* raw text */ }
        if (body && !body.startsWith("{")) raw = body.slice(0, 200);
        failWith(raw);
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
            import("@/components/Toast").then(({ toastUpdate }) =>
              toastUpdate(loadingToastId, `${id.replace(/^mlx:/, "")} loaded`, "success"));
            api.status().then((s) => {
              set({ activeModelId: s.active_model_id, loadingModelId: null, loadStage: "" });
            }).catch(() => {
              set({ activeModelId: id, loadingModelId: null, loadStage: "" });
            });
          } else if (event === "error") {
            gotCompletion = true;
            failWith((payload?.message as string) ?? "Unknown error");
          }
        },
        (err) => {
          if (controller.signal.aborted) {
            cleanupIfOrphaned();
            return;
          }
          failWith(err.message);
        }
      );

      // Stream ended. Three outcomes:
      //   - done event fired: state already set by the done handler above.
      //   - aborted: clean up if we're still the tracked controller.
      //   - neither: stream closed without a terminal event — show an error.
      if (!gotCompletion) {
        if (controller.signal.aborted) {
          cleanupIfOrphaned();
        } else {
          failWith("Load stream ended unexpectedly");
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") {
        cleanupIfOrphaned();
        return;
      }
      failWith(String(e));
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
