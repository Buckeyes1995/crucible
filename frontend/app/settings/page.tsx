"use client";

import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/stores/settings";
import { useFavoritesStore } from "@/lib/stores/favorites";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, WEBHOOK_EVENTS } from "@/lib/api";
import type { CrucibleConfig, Webhook } from "@/lib/api";

export default function SettingsPage() {
  const { config, loading, saving, error, fetchSettings, saveSettings } = useSettingsStore();
  const { favoritesOnly, setFavoritesOnly, favorites } = useFavoritesStore();
  const [draft, setDraft] = useState<CrucibleConfig | null>(null);

  useEffect(() => {
    setDraft(null); // clear stale draft so it re-initialises from fresh fetch
    fetchSettings();
  }, [fetchSettings]);
  useEffect(() => { if (config && !draft) setDraft(config); }, [config, draft]);

  if (loading || !draft) {
    return (
      <div className="p-6">
        <div className="h-8 w-40 bg-zinc-800 rounded animate-pulse mb-6" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-zinc-900/60 rounded-xl animate-pulse border border-white/5" />
          ))}
        </div>
      </div>
    );
  }

  const set = (key: keyof CrucibleConfig, value: string | number) =>
    setDraft((d) => d ? { ...d, [key]: value } : d);

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Saved to ~/.config/crucible/config.json</p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{error}</div>
      )}

      <Card>
        <CardHeader><CardTitle>Model Directories</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="MLX models directory" value={draft.mlx_dir} onChange={(v) => set("mlx_dir", v)} />
          <Field label="GGUF models directory" value={draft.gguf_dir} onChange={(v) => set("gguf_dir", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>llama.cpp Backend</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="llama-server path" value={draft.llama_server} onChange={(v) => set("llama_server", v)} />
          <Field label="Port" value={String(draft.llama_port)} onChange={(v) => set("llama_port", parseInt(v) || 8080)} type="number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>MLX Backend</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Python path (must have mlx_lm installed)" value={draft.mlx_python} onChange={(v) => set("mlx_python", v)} />
          <Field label="Port" value={String(draft.mlx_port)} onChange={(v) => set("mlx_port", parseInt(v) || 8010)} type="number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Ollama</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Host URL" value={draft.ollama_host} onChange={(v) => set("ollama_host", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>LAN Serving</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Bind host (127.0.0.1 = localhost only, 0.0.0.0 = LAN)"
            value={draft.bind_host}
            onChange={(v) => set("bind_host", v)}
          />
          <Field
            label="API key (optional — required from non-localhost clients)"
            value={draft.api_key}
            onChange={(v) => set("api_key", v)}
          />
          <p className="text-xs text-zinc-500">
            Changing bind_host requires restarting Crucible with <code className="font-mono bg-zinc-800 px-1 rounded">--host {draft.bind_host}</code>.
            Run: <code className="font-mono bg-zinc-800 px-1 rounded">uvicorn main:app --host {draft.bind_host} --port 7777</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Model Browser</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle
            label="Show favorites only by default"
            description={`Hide non-favorited models on the Models page. You have ${favorites.length} favorite${favorites.length === 1 ? "" : "s"}.`}
            value={favoritesOnly}
            onChange={setFavoritesOnly}
          />
        </CardContent>
      </Card>

      <WebhooksSection />

      <div className="flex gap-3">
        <Button
          variant="primary"
          onClick={() => saveSettings(draft)}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(config)}>
          Reset
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs"
      />
    </div>
  );
}

const EVENT_COLORS: Record<string, string> = {
  "model.loaded": "bg-indigo-900/50 text-indigo-300 border-indigo-700",
  "model.unloaded": "bg-indigo-900/30 text-indigo-400 border-indigo-800",
  "benchmark.done": "bg-amber-900/50 text-amber-300 border-amber-700",
  "download.done": "bg-emerald-900/50 text-emerald-300 border-emerald-700",
};

function WebhooksSection() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.webhooks.list().then(setHooks).catch(() => {});
  }, []);

  async function handleCreate() {
    if (!newUrl || newEvents.length === 0) return;
    setSaving(true);
    try {
      const hook = await api.webhooks.create(newUrl, newEvents, newSecret || undefined);
      setHooks((h) => [...h, hook]);
      setNewUrl(""); setNewEvents([]); setNewSecret(""); setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(hook: Webhook) {
    const updated = await api.webhooks.update(hook.id, { enabled: !hook.enabled });
    setHooks((h) => h.map((x) => x.id === hook.id ? updated : x));
  }

  async function handleDelete(id: string) {
    await api.webhooks.delete(id);
    setHooks((h) => h.filter((x) => x.id !== id));
  }

  async function handleTest(id: string) {
    await api.webhooks.test(id);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Webhooks</CardTitle>
        <Button variant="ghost" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="space-y-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">URL</label>
              <Input
                placeholder="https://example.com/webhook"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Events</label>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <button
                    key={ev}
                    onClick={() => setNewEvents((es) => es.includes(ev) ? es.filter((e) => e !== ev) : [...es, ev])}
                    className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                      newEvents.includes(ev) ? EVENT_COLORS[ev] : "border-white/10 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {ev}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Secret (optional — sent as X-Crucible-Secret header)</label>
              <Input
                placeholder="my-secret-token"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <Button variant="primary" onClick={handleCreate} disabled={saving || !newUrl || newEvents.length === 0}>
              {saving ? "Saving…" : "Save webhook"}
            </Button>
          </div>
        )}

        {hooks.length === 0 && !showForm && (
          <p className="text-sm text-zinc-500">No webhooks configured.</p>
        )}

        {hooks.map((hook) => (
          <div key={hook.id} className="flex items-start gap-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-mono text-zinc-200 truncate">{hook.url}</p>
              <div className="flex flex-wrap gap-1">
                {hook.events.map((ev) => (
                  <span key={ev} className={`px-1.5 py-0.5 rounded border text-xs ${EVENT_COLORS[ev] ?? "border-white/10 text-zinc-400"}`}>
                    {ev}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleToggle(hook)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                  hook.enabled ? "bg-indigo-600" : "bg-zinc-700"
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${
                  hook.enabled ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
              <Button variant="ghost" onClick={() => handleTest(hook.id)} className="text-xs px-2 h-7">
                Test
              </Button>
              <Button variant="ghost" onClick={() => handleDelete(hook.id)} className="text-xs px-2 h-7 text-red-400 hover:text-red-300">
                Delete
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-zinc-200">{label}</div>
        {description && <div className="text-xs text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          value ? "bg-indigo-600" : "bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${
            value ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
