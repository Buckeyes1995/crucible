"use client";
import { create } from "zustand";
import { api, readSSE, type ChatMessage } from "@/lib/api";
import { useModelsStore } from "@/lib/stores/models";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  bookmarked?: boolean;
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
  /** Load a previously-persisted conversation so the user can continue it. New
   *  turns sent after this will append to the same DB session. */
  resumeSession: (id: string) => Promise<void>;
  /** Truncate messages to `keepUntilIndex` (exclusive) and re-run the conversation
   *  from there. `keepUntilIndex` should point at the assistant message you want
   *  to regenerate — it'll be removed, then the preceding user turn is re-sent. */
  regenerateFrom: (keepUntilIndex: number, temperature: number, maxTokens: number, systemPrompt?: string, ragSessionId?: string) => Promise<void>;
  toggleBookmark: (index: number) => void;
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

  toggleBookmark: (index: number) => set((state) => {
    const updated = [...state.messages];
    if (!updated[index]) return state;
    updated[index] = { ...updated[index], bookmarked: !updated[index].bookmarked };
    return { messages: updated };
  }),

  regenerateFrom: async (keepUntilIndex: number, temperature: number, maxTokens: number,
                          systemPrompt?: string, ragSessionId?: string) => {
    // Drop the target assistant turn + everything after; re-send the preceding user turn.
    // Caller passes the index of the assistant message to regenerate.
    const msgs = get().messages.slice(0, keepUntilIndex);
    // Walk backwards to find the user turn that produced this assistant.
    let userIdx = msgs.length - 1;
    while (userIdx >= 0 && msgs[userIdx].role !== "user") userIdx--;
    if (userIdx < 0) return;  // nothing to regenerate from
    const userText = msgs[userIdx].content;
    const before = msgs.slice(0, userIdx);
    set({ messages: before, stats: null, error: null });
    await get().sendMessage(userText, temperature, maxTokens, systemPrompt, ragSessionId);
  },

  resumeSession: async (id: string) => {
    try {
      const resp = await fetch(`/api/chat/sessions/${id}`);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      const msgs: ChatMsg[] = (data.messages ?? [])
        .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
        .map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content }));
      set({ messages: msgs, sessionId: id, stats: null, error: null, streaming: false });
    } catch (e) {
      set({ error: `Failed to load session: ${(e as Error).message}` });
    }
  },
}));
