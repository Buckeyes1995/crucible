"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import {
  Workflow, Plus, Trash2, X as XIcon, Play, Clock, CircleAlert, CheckCircle2, Power,
} from "lucide-react";

type ConditionType = "cron" | "memory_pressure" | "model_loaded" | "hf_update_available";
type ActionType = "notify" | "load_model" | "unload_model" | "run_benchmark" | "webhook";

type Trigger = {
  id: string;
  name: string;
  enabled: boolean;
  condition_type: ConditionType;
  condition_args: Record<string, unknown>;
  action_type: ActionType;
  action_args: Record<string, unknown>;
  last_fired_at?: string | null;
  last_error?: string | null;
  fire_count: number;
  created_at: string;
  updated_at: string;
};

export default function AutomationPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [openNew, setOpenNew] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/automation/triggers");
    if (r.ok) setTriggers(await r.json());
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 15000); return () => clearInterval(id); }, [refresh]);

  const del = async (t: Trigger) => {
    if (!confirm(`Delete trigger "${t.name}"?`)) return;
    await fetch(`/api/automation/triggers/${t.id}`, { method: "DELETE" });
    refresh();
  };

  const toggle = async (t: Trigger) => {
    await fetch(`/api/automation/triggers/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    refresh();
  };

  const testFire = async (t: Trigger) => {
    const r = await fetch(`/api/automation/triggers/${t.id}/fire-test`, { method: "POST" });
    if (r.ok) { const d = await r.json(); toast(`test fire: ${d.message}`, d.status === "ok" ? "success" : "error"); }
    refresh();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-white/[0.04]">
        <PageHeader
          icon={<Workflow className="w-5 h-5" />}
          title="Automation"
          description="When X, do Y — cron + condition matchers firing against Crucible actions"
        >
          <Button variant="primary" size="sm" onClick={() => setOpenNew(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New trigger
          </Button>
        </PageHeader>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {triggers.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-16">
            No triggers yet. Try: a cron that checks benchmarks every hour, or a memory-pressure guardrail that unloads the active model when RAM hits 90%.
          </p>
        ) : (
          <ul className="space-y-2">
            {triggers.map(t => (
              <li key={t.id} className="rounded-lg border border-white/10 bg-zinc-950 p-3">
                <div className="flex items-start gap-3">
                  <button onClick={() => toggle(t)} title={t.enabled ? "Disable" : "Enable"}>
                    <Power className={cn("w-4 h-4", t.enabled ? "text-emerald-400" : "text-zinc-600")} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-100">{t.name}</span>
                      <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-white/10 px-1.5 py-0.5 rounded">
                        {t.condition_type}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-600">→</span>
                      <span className="text-[10px] font-mono bg-indigo-900/30 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded">
                        {t.action_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono mt-1">
                      when: <span className="text-zinc-300">{JSON.stringify(t.condition_args)}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      do: <span className="text-zinc-300">{JSON.stringify(t.action_args)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-1 flex-wrap">
                      <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />fired {t.fire_count}x</span>
                      {t.last_fired_at && <span>· last {new Date(t.last_fired_at).toLocaleString()}</span>}
                      {t.last_error && <span className="text-red-400 flex items-center gap-1"><CircleAlert className="w-2.5 h-2.5" />{t.last_error}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => testFire(t)} title="Force-fire the action (skip condition)">
                      <Play className="w-3.5 h-3.5" />
                    </Button>
                    <button onClick={() => del(t)} className="text-zinc-500 hover:text-red-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openNew && <NewTriggerDialog onClose={() => setOpenNew(false)} onCreated={() => { setOpenNew(false); refresh(); }} />}
    </div>
  );
}

function NewTriggerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [conditionType, setConditionType] = useState<ConditionType>("cron");
  const [conditionArgs, setConditionArgs] = useState<string>(JSON.stringify({ expr: "0 */1 * * *" }, null, 2));
  const [actionType, setActionType] = useState<ActionType>("notify");
  const [actionArgs, setActionArgs] = useState<string>(JSON.stringify({ text: "Hourly ping" }, null, 2));

  // Update default args when switching condition/action types for friendlier UX.
  useEffect(() => {
    const defaults: Record<ConditionType, string> = {
      cron: JSON.stringify({ expr: "0 */1 * * *" }, null, 2),
      memory_pressure: JSON.stringify({ threshold: 0.85, direction: "above" }, null, 2),
      model_loaded: JSON.stringify({ model_id: "mlx:Qwen3-4B-Instruct-2507-MLX-4bit" }, null, 2),
      hf_update_available: JSON.stringify({}, null, 2),
    };
    setConditionArgs(defaults[conditionType]);
  }, [conditionType]);

  useEffect(() => {
    const defaults: Record<ActionType, string> = {
      notify: JSON.stringify({ text: "Trigger fired" }, null, 2),
      load_model: JSON.stringify({ model_id: "mlx:Qwen3-4B-Instruct-2507-MLX-4bit" }, null, 2),
      unload_model: JSON.stringify({}, null, 2),
      run_benchmark: JSON.stringify({ preset: "quick" }, null, 2),
      webhook: JSON.stringify({ url: "https://example.com/hook", method: "POST", body: { hello: "world" } }, null, 2),
    };
    setActionArgs(defaults[actionType]);
  }, [actionType]);

  const submit = async () => {
    let cond: Record<string, unknown> = {};
    let act: Record<string, unknown> = {};
    try { cond = JSON.parse(conditionArgs); } catch { return toast("Condition args must be valid JSON", "error"); }
    try { act = JSON.parse(actionArgs); } catch { return toast("Action args must be valid JSON", "error"); }
    const r = await fetch("/api/automation/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || "Trigger",
        enabled: true,
        condition_type: conditionType,
        condition_args: cond,
        action_type: actionType,
        action_args: act,
      }),
    });
    if (r.ok) { toast("Trigger saved", "success"); onCreated(); }
    else toast("Save failed", "error");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">New trigger</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100" autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">When (condition)</label>
              <select value={conditionType} onChange={e => setConditionType(e.target.value as ConditionType)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100">
                <option value="cron">cron</option>
                <option value="memory_pressure">memory_pressure</option>
                <option value="model_loaded">model_loaded</option>
                <option value="hf_update_available">hf_update_available</option>
              </select>
              <textarea value={conditionArgs} onChange={e => setConditionArgs(e.target.value)} rows={4}
                className="w-full mt-1 bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-[11px] text-zinc-100 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Do (action)</label>
              <select value={actionType} onChange={e => setActionType(e.target.value as ActionType)} className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-100">
                <option value="notify">notify</option>
                <option value="load_model">load_model</option>
                <option value="unload_model">unload_model</option>
                <option value="run_benchmark">run_benchmark</option>
                <option value="webhook">webhook</option>
              </select>
              <textarea value={actionArgs} onChange={e => setActionArgs(e.target.value)} rows={4}
                className="w-full mt-1 bg-zinc-900 border border-white/[0.08] rounded px-2 py-1 text-[11px] text-zinc-100 font-mono" />
            </div>
          </div>
          <p className="text-[10px] text-zinc-500">Cron expr: <code className="text-zinc-300">min hour day month dow</code> with <code>*</code>, <code>*/N</code>, or comma-lists. dow: sun=0.</p>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim()} className="gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}
