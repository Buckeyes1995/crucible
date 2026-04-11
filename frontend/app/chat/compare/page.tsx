"use client";

import { useEffect, useRef, useState } from "react";
import { api, readSSE, type ModelEntry, type ChatMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Send, Square, X } from "lucide-react";

type Slot = "a" | "b";

type SlotState = {
  modelId: string | null;
  modelName: string;
  messages: { role: string; content: string }[];
  streaming: boolean;
  partial: string;
  ttft: number | null;
  tps: number | null;
  loading: boolean;
};

const emptySlot = (): SlotState => ({
  modelId: null,
  modelName: "",
  messages: [],
  streaming: false,
  partial: "",
  ttft: null,
  tps: null,
  loading: false,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.models.list().then(setModels).catch(() => {});
    // Seed slot A from active model
    api.status().then((s) => {
      if (s.active_model_id) {
        const m = undefined; // will be set after models load
        setSlotA((p) => ({ ...p, modelId: s.active_model_id, modelName: s.active_model_id ?? "" }));
      }
      if (s.compare_model_id) {
        setSlotB((p) => ({ ...p, modelId: s.compare_model_id, modelName: s.compare_model_id ?? "" }));
      }
    }).catch(() => {});
  }, []);

  // Sync model names once models load
  useEffect(() => {
    if (!models.length) return;
    setSlotA((p) => p.modelId ? { ...p, modelName: models.find(m => m.id === p.modelId)?.name ?? p.modelId } : p);
    setSlotB((p) => p.modelId ? { ...p, modelName: models.find(m => m.id === p.modelId)?.name ?? p.modelId } : p);
  }, [models]);

  // Auto-scroll panes
  useEffect(() => { aRef.current?.scrollTo(0, aRef.current.scrollHeight); }, [slotA.messages, slotA.partial]);
  useEffect(() => { bRef.current?.scrollTo(0, bRef.current.scrollHeight); }, [slotB.messages, slotB.partial]);

  const loadModel = async (slot: Slot, modelId: string) => {
    const setter = slot === "a" ? setSlotA : setSlotB;
    setter((p) => ({ ...p, loading: true, modelId, modelName: models.find(m => m.id === modelId)?.name ?? modelId }));
    try {
      const endpoint = slot === "a" ? api.models.load : api.models.loadCompare;
      const resp = await endpoint(modelId);
      await readSSE(resp, (evt) => {
        if (evt.event === "done" || evt.event === "error") {
          setter((p) => ({ ...p, loading: false }));
        }
      });
    } catch {
      setter((p) => ({ ...p, loading: false }));
    }
  };

  const stopCompare = async () => {
    await api.models.stopCompare().catch(() => {});
    setSlotB(emptySlot());
  };

  const send = async () => {
    if (!prompt.trim() || sending) return;
    if (!slotA.modelId || !slotB.modelId) return;

    const userMsg: ChatMessage = { role: "user", content: prompt.trim() };
    const history = slotA.messages;
    const msgs: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...history,
      userMsg,
    ];

    setSlotA((p) => ({ ...p, messages: [...p.messages, userMsg], partial: "", streaming: true, ttft: null, tps: null }));
    setSlotB((p) => ({ ...p, messages: [...p.messages, userMsg], partial: "", streaming: true, ttft: null, tps: null }));
    setPrompt("");
    setSending(true);

    try {
      const resp = await api.chatCompare({ messages: msgs, temperature, max_tokens: maxTokens });
      const doneSlots = new Set<Slot>();

      await readSSE(resp, (evt) => {
        const slot = evt.slot as Slot | undefined;
        if (!slot) return;
        const setter = slot === "a" ? setSlotA : setSlotB;

        if (evt.event === "token") {
          setter((p) => ({ ...p, partial: p.partial + (evt.token as string) }));
        } else if (evt.event === "done") {
          setter((p) => ({
            ...p,
            messages: [...p.messages, { role: "assistant", content: p.partial }],
            partial: "",
            streaming: false,
            ttft: (evt.ttft_ms as number) ?? null,
            tps: (evt.tps as number) ?? null,
          }));
          doneSlots.add(slot);
        } else if (evt.event === "error") {
          setter((p) => ({
            ...p,
            messages: [...p.messages, { role: "assistant", content: `Error: ${evt.message}` }],
            partial: "",
            streaming: false,
          }));
          doneSlots.add(slot);
        }
      });
    } finally {
      setSending(false);
      setSlotA((p) => ({ ...p, streaming: false }));
      setSlotB((p) => ({ ...p, streaming: false }));
    }
  };

  const canSend = slotA.modelId && slotB.modelId && prompt.trim() && !sending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
        <h1 className="text-lg font-bold text-zinc-100">Side-by-Side Chat</h1>
        <span className="text-xs text-zinc-500">Compare two models on the same prompt</span>
      </div>

      {/* Model selectors */}
      <div className="grid grid-cols-2 border-b border-white/10">
        {([["a", slotA, setSlotA], ["b", slotB, setSlotB]] as const).map(([slot, state, setter]) => (
          <div key={slot} className={cn(
            "flex items-center gap-3 px-4 py-2.5",
            slot === "a" ? "border-r border-white/10" : ""
          )}>
            <span className="text-xs font-bold text-zinc-500 uppercase shrink-0">Slot {slot.toUpperCase()}</span>
            <select
              className="flex-1 text-sm bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-zinc-200 focus:outline-none focus:border-indigo-500"
              value={state.modelId ?? ""}
              onChange={(e) => { if (e.target.value) loadModel(slot, e.target.value); }}
              disabled={state.loading}
            >
              <option value="">Select model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {state.loading && <span className="text-xs text-indigo-400 shrink-0">Loading…</span>}
            {state.modelId && !state.loading && (
              <span className="text-xs text-green-400 shrink-0 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Ready
              </span>
            )}
            {slot === "b" && state.modelId && (
              <button onClick={stopCompare} className="text-zinc-600 hover:text-red-400 transition-colors shrink-0" title="Unload slot B">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Chat panes */}
      <div className="flex flex-1 min-h-0 divide-x divide-white/10">
        {([["a", slotA] as const, ["b", slotB] as const]).map(([slot, state]) => (
          <div key={slot} className="flex-1 flex flex-col min-h-0">
            {/* Pane header */}
            {(state.ttft !== null || state.tps !== null) && (
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-white/5 text-xs text-zinc-500">
                {state.ttft !== null && <span>TTFT <span className="text-amber-300 font-mono">{state.ttft.toFixed(0)}ms</span></span>}
                {state.tps !== null && <span>tok/s <span className="text-indigo-300 font-mono">{state.tps.toFixed(1)}</span></span>}
              </div>
            )}

            {/* Messages */}
            <div ref={slot === "a" ? aRef : bRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {state.messages.length === 0 && !state.streaming && (
                <div className="text-center text-zinc-600 text-sm py-12">
                  {state.modelId ? "Send a prompt to start" : "Select a model above"}
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
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={canSend || (!slotA.modelId || !slotB.modelId) ? "Type a prompt… (Enter to send)" : "Load both models to start"}
            rows={2}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
          <Button
            variant="primary"
            disabled={!canSend}
            onClick={send}
            className="self-end"
          >
            {sending ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
