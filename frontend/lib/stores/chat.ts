"use client";
import { create } from "zustand";
import { api, readSSE, type ChatMessage } from "@/lib/api";
import { useModelsStore } from "@/lib/stores/models";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
};

type ChatStats = {
  ttft_ms: number | null;
  tps: number | null;
  output_tokens: number | null;
};

type ChatState = {
  messages: ChatMsg[];
  streaming: boolean;
  stats: ChatStats | null;
  error: string | null;
  sessionId: string | null;

  sendMessage: (text: string, temperature: number, maxTokens: number, systemPrompt?: string, ragSessionId?: string) => Promise<void>;
  clearMessages: () => void;
  resetStreaming: () => void;
};

// Fire-and-forget persistence helper. We POST to the chat-history router after
// each turn completes; failures are logged but don't block the UI — history is
// a nice-to-have, not a critical path.
async function persistTurn(
  sessionId: string | null,
  userText: string,
  assistantText: string,
  modelId: string | null,
): Promise<string | null> {
  try {
    let id = sessionId;
    if (!id) {
      const title = userText.trim().slice(0, 80) || "New Chat";
      const resp = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, model_id: modelId }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      id = data.id as string;
    }
    await fetch(`/api/chat/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: userText }),
    });
    await fetch(`/api/chat/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: assistantText }),
    });
    return id;
  } catch {
    return sessionId;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  stats: null,
  error: null,
  sessionId: null,

  sendMessage: async (text, temperature, maxTokens, systemPrompt, ragSessionId) => {
    const userMsg: ChatMsg = { role: "user", content: text };
    const msgs = [...get().messages, userMsg];
    set({ messages: msgs, streaming: true, error: null, stats: null });

    // Add placeholder assistant message
    const assistantIdx = msgs.length;
    set({ messages: [...msgs, { role: "assistant", content: "" }] });

    const apiMessages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...msgs.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      const resp = await api.chat({ messages: apiMessages, temperature, max_tokens: maxTokens, rag_session_id: ragSessionId });
      await readSSE(
        resp,
        (data) => {
          const event = data.event as string;
          if (event === "token") {
            const token = data.token as string;
            set((state) => {
              const updated = [...state.messages];
              updated[assistantIdx] = {
                role: "assistant",
                content: (updated[assistantIdx]?.content ?? "") + token,
              };
              return { messages: updated };
            });
          } else if (event === "done") {
            set({
              streaming: false,
              stats: {
                ttft_ms: (data.ttft_ms as number) ?? null,
                tps: (data.tps as number) ?? null,
                output_tokens: (data.output_tokens as number) ?? null,
              },
            });
            // Persist this turn (both user + assistant messages) to chat history.
            const state = get();
            const assistantText = state.messages[assistantIdx]?.content ?? "";
            if (assistantText) {
              const modelId = useModelsStore.getState().activeModelId ?? null;
              persistTurn(state.sessionId, text, assistantText, modelId).then((id) => {
                if (id && id !== get().sessionId) set({ sessionId: id });
              });
            }
          }
        },
        (err) => set({ error: err.message, streaming: false })
      );
    } catch (e) {
      set({ error: String(e), streaming: false });
    } finally {
      // Stream might end without a "done" event — always release the input lock
      if (get().streaming) set({ streaming: false });
    }
  },

  clearMessages: () => set({ messages: [], stats: null, error: null, sessionId: null }),

  resetStreaming: () => set({ streaming: false, error: null }),
}));
