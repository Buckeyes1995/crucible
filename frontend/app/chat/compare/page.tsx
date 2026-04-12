"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ModelEntry, type ChatMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Send, Square, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type Slot = "a" | "b";

type SlotState = {
  modelId: string | null;
  modelName: string;
  selectedId: string;       // what's in the dropdown (may not be loaded yet)
  messages: { role: string; content: string }[];
  streaming: boolean;
  partial: string;
  ttft: number | null;
  tps: number | null;
  loading: boolean;
  ready: boolean;           // explicitly loaded and ready
  kind: string;             // "mlx" | "gguf" | "ollama" | ""
};

const emptySlot = (): SlotState => ({
  modelId: null,
  modelName: "",
  selectedId: "",
  messages: [],
  streaming: false,
  partial: "",
  ttft: null,
  tps: null,
  loading: false,
  ready: false,
  kind: "",
});

export default function CompareChatPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [slotA, setSlotA] = useState<SlotState>(emptySlot());
  const [slotB, setSlotB] = useState<SlotState>(emptySlot());
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [sending, setSending] = useState(false);

  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.models.list().then((ms) => {
      setModels(ms);
      // Auto-populate slot A if a model is already loaded
      api.status().then((s) => {
        if (s.active_model_id) {
          const m = ms.find((x) => x.id === s.active_model_id);
          setSlotA((p) => ({
            ...p,
            modelId: s.active_model_id,
            modelName: m?.name ?? s.active_model_id ?? "",
            selectedId: s.active_model_id ?? "",
            ready: true,
            kind: (m as any)?.kind ?? "",
          }));
        }
        if (s.compare_model_id) {
          const m = ms.find((x) => x.id === s.compare_model_id);
          setSlotB((p) => ({
            ...p,
            modelId: s.compare_model_id,
            modelName: m?.name ?? s.compare_model_id ?? "",
            selectedId: s.compare_model_id ?? "",
            ready: true,
            kind: (m as any)?.kind ?? "",
          }));
        }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => { aRef.current?.scrollTo(0, aRef.current.scrollHeight); }, [slotA.messages, slotA.partial]);
  useEffect(() => { bRef.current?.scrollTo(0, bRef.current.scrollHeight); }, [slotB.messages, slotB.partial]);

  const loadSlot = async (slot: Slot) => {
    const state = slot === "a" ? slotA : slotB;
    const setter = slot === "a" ? setSlotA : setSlotB;
    const id = state.selectedId;
    if (!id) return;

    const m = models.find((x) => x.id === id);
    setter((p) => ({ ...p, loading: true, ready: false, modelId: null, kind: (m as any)?.kind ?? "" }));

    let succeeded = false;
    try {
      const endpoint = slot === "a" ? api.models.load : api.models.loadCompare;
      const resp = await endpoint(id);
      await readSSE(resp, (evt) => {
        if (evt.event === "done") {
          succeeded = true;
          setter((p) => ({
            ...p,
            loading: false,
            ready: true,
            modelId: id,
            modelName: m?.name ?? id,
            messages: [],
          }));
        } else if (evt.event === "error") {
          setter((p) => ({ ...p, loading: false, ready: false }));
        }
      });
    } catch {
      // network error
    } finally {
      // Always clear loading — handles cases where SSE closed without done/error
      if (!succeeded) {
        setter((p) => ({ ...p, loading: false }));
      }
    }
  };

  const send = async () => {
    if (!prompt.trim() || sending) return;
    if (!slotA.ready || !slotB.ready) return;

    const userMsg: ChatMessage = { role: "user", content: prompt.trim() };
    const msgs: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...slotA.messages,
      userMsg,
    ];

    // Accumulate text outside React state to avoid batching issues on done
    const accumulated: Record<Slot, string> = { a: "", b: "" };

    setSlotA((p) => ({ ...p, messages: [...p.messages, userMsg], partial: "", streaming: true, ttft: null, tps: null }));
    setSlotB((p) => ({ ...p, messages: [...p.messages, userMsg], partial: "", streaming: true, ttft: null, tps: null }));
    setPrompt("");
    setSending(true);

    try {
      const resp = await api.chatCompare({ messages: msgs, temperature, max_tokens: maxTokens });

      await readSSE(resp, (evt) => {
        const slot = evt.slot as Slot | undefined;
        if (!slot || (slot !== "a" && slot !== "b")) return;
        const setter = slot === "a" ? setSlotA : setSlotB;

        if (evt.event === "token") {
          accumulated[slot] += evt.token as string;
          const text = accumulated[slot];
          setter((p) => ({ ...p, partial: text }));
        } else if (evt.event === "done") {
          const text = accumulated[slot];
          setter((p) => ({
            ...p,
            messages: [...p.messages, { role: "assistant", content: text }],
            partial: "",
            streaming: false,
            ttft: (evt.ttft_ms as number) ?? null,
            tps: (evt.tps as number) ?? null,
          }));
        } else if (evt.event === "error") {
          setter((p) => ({
            ...p,
            messages: [...p.messages, { role: "assistant", content: `Error: ${String(evt.message)}` }],
            partial: "",
            streaming: false,
          }));
        }
      });
    } finally {
      setSending(false);
      setSlotA((p) => ({ ...p, streaming: false }));
      setSlotB((p) => ({ ...p, streaming: false }));
    }
  };

  const bothMLX = slotA.kind === "mlx" && slotB.kind === "mlx";
  const canSend = slotA.ready && slotB.ready && prompt.trim() && !sending;

  const sendDisabledReason = !slotA.ready && !slotB.ready
    ? "Load both models first"
    : !slotA.ready
    ? "Load Slot A first"
    : !slotB.ready
    ? "Load Slot B first"
    : !prompt.trim()
    ? "Enter a prompt"
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
        <h1 className="text-lg font-bold text-zinc-100">Side-by-Side Compare</h1>
        <span className="text-xs text-zinc-500">Run the same prompt against two models simultaneously</span>
      </div>

      {/* Model selectors */}
      <div className="grid grid-cols-2 border-b border-white/10">
        {([["a", slotA, setSlotA], ["b", slotB, setSlotB]] as const).map(([slot, state]) => (
          <div key={slot} className={cn(
            "px-4 py-3 space-y-2 min-w-0 overflow-hidden",
            slot === "a" ? "border-r border-white/10" : ""
          )}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide shrink-0">
                Model {slot.toUpperCase()}
              </span>
              {state.ready && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Ready
                </span>
              )}
              {state.loading && (
                <span className="flex items-center gap-1 text-xs text-indigo-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading…
                </span>
              )}
              {!state.ready && !state.loading && (
                <span className="text-xs text-zinc-600">Not loaded</span>
              )}
            </div>
            <select
              className="w-full text-sm bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              value={state.selectedId}
              onChange={(e) => {
                const setter = slot === "a" ? setSlotA : setSlotB;
                setter((p) => ({ ...p, selectedId: e.target.value, ready: p.modelId === e.target.value && p.ready }));
              }}
              disabled={state.loading}
            >
              <option value="">— select a model —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <button
              disabled={state.loading}
              onClick={() => { if (state.selectedId) loadSlot(slot); }}
              className={cn(
                "w-full py-2 text-sm rounded-md font-semibold transition-colors border",
                state.loading
                  ? "bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed"
                  : state.ready && state.modelId === state.selectedId
                  ? "bg-zinc-800 border-zinc-600 text-zinc-400 hover:bg-zinc-700 cursor-pointer"
                  : state.selectedId
                  ? "bg-indigo-600 border-indigo-500 text-white hover:bg-indigo-500 cursor-pointer"
                  : "bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed"
              )}
            >
              {state.loading
                ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</span>
                : state.ready && state.modelId === state.selectedId
                ? "✓ Loaded — click to reload"
                : state.selectedId
                ? "Load Model"
                : "Select a model above"}
            </button>
          </div>
        ))}
      </div>

      {/* Sequential mode warning */}
      {bothMLX && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Sequential mode — both models use oMLX, so responses run one after the other, not simultaneously.
        </div>
      )}

      {/* Chat panes */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/10">
        {([["a", slotA] as const, ["b", slotB] as const]).map(([slot, state]) => (
          <div key={slot} className="flex-1 flex flex-col min-h-0">
            {/* Per-pane metrics */}
            {(state.ttft !== null || state.tps !== null) && (
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-white/5 text-xs text-zinc-500">
                {state.ttft !== null && <span>TTFT <span className="text-amber-300 font-mono">{state.ttft.toFixed(0)}ms</span></span>}
                {state.tps !== null && <span>tok/s <span className="text-indigo-300 font-mono">{state.tps.toFixed(1)}</span></span>}
              </div>
            )}

            <div ref={slot === "a" ? aRef : bRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {state.messages.length === 0 && !state.streaming && (
                <div className="text-center text-zinc-600 text-sm py-12">
                  {state.ready ? "Send a prompt to start" : "Load a model above to begin"}
                </div>
              )}
              {state.messages.map((msg, i) => (
                <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-indigo-600/30 text-zinc-100 border border-indigo-500/30"
                      : "bg-zinc-800/60 text-zinc-200 border border-white/5"
                  )}>
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</pre>
                  </div>
                </div>
              ))}
              {state.partial && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-zinc-800/60 text-zinc-200 border border-white/5">
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{state.partial}<span className="animate-pulse">▌</span></pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="border-t border-white/10 px-4 py-3 space-y-2">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <label className="flex items-center gap-1.5">
            Temp
            <input type="number" min={0} max={2} step={0.1} value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
              className="w-14 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 text-center focus:outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Max tokens
            <input type="number" min={64} max={8192} step={64} value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)}
              className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300 text-center focus:outline-none focus:border-indigo-500"
            />
          </label>
          <input
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="System prompt (optional)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Type a prompt… (Enter to send)"
            rows={2}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
          <div className="flex flex-col items-end gap-1">
            {sendDisabledReason && (
              <span className="text-xs text-zinc-600">{sendDisabledReason}</span>
            )}
            <Button
              variant="primary"
              disabled={!canSend}
              onClick={send}
            >
              {sending ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
