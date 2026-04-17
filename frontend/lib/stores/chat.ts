"use client";
import { create } from "zustand";
import { api, readSSE, type ChatMessage } from "@/lib/api";

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

  sendMessage: (text: string, temperature: number, maxTokens: number, systemPrompt?: string, ragSessionId?: string) => Promise<void>;
  clearMessages: () => void;
};

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  stats: null,
  error: null,

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

  clearMessages: () => set({ messages: [], stats: null, error: null }),
}));
