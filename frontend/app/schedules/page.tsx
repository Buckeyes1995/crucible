"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type ScheduleRule, type ModelEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Clock, Power } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const BLANK: Omit<ScheduleRule, "id"> = {
  model_id: "",
  days: [],
  hour: 9,
  minute: 0,
  enabled: true,
  label: "",
};

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<ScheduleRule[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<ScheduleRule, "id">>(BLANK);

  const load = useCallback(async () => {
    const [s, m] = await Promise.all([api.schedules.list(), api.models.list()]);
    setSchedules(s);
    setModels(m);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => {
    setDraft({ ...BLANK, model_id: models[0]?.id ?? "" });
    setEditing("new");
  };

  const save = async () => {
    if (!draft.model_id) return;
    if (editing === "new") {
      await api.schedules.create(draft);
    } else if (editing) {
      await api.schedules.update(editing, draft);
    }
    setEditing(null);
    load();
  };

  const toggle = async (rule: ScheduleRule) => {
    await api.schedules.update(rule.id, { ...rule, enabled: !rule.enabled });
    load();
  };

  const del = async (id: string) => {
    await api.schedules.delete(id);
    load();
  };

  const startEdit = (rule: ScheduleRule) => {
    setDraft({ model_id: rule.model_id, days: rule.days, hour: rule.hour, minute: rule.minute, enabled: rule.enabled, label: rule.label });
    setEditing(rule.id);
  };

  const modelName = (id: string) => models.find(m => m.id === id)?.name ?? id;

  const describeSchedule = (rule: ScheduleRule) => {
    const days = rule.days.length === 0 ? "Every day" : rule.days.map(d => DAYS[d]).join(", ");
    const time = `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
    return `${days} at ${time}`;
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Schedules</h1>
          <p className="text-sm text-zinc-500 mt-1">Automatically switch models at specified times</p>
        </div>
        <Button variant="primary" size="sm" onClick={startNew}>
          <Plus className="w-4 h-4" />
          New schedule
        </Button>
      </div>

      {/* Editor */}
      {editing && (
        <Card className="mb-6 border-indigo-500/30">
          <CardContent className="p-5 space-y-4">
            <div className="text-sm font-medium text-zinc-300">{editing === "new" ? "New Schedule" : "Edit Schedule"}</div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Label (optional)</label>
              <input
                type="text"
                value={draft.label}
                onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                placeholder="Morning coding session…"
                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Model</label>
              <select
                value={draft.model_id}
                onChange={e => setDraft(d => ({ ...d, model_id: e.target.value }))}
                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Days (empty = every day)</label>
              <div className="flex gap-1.5">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => setDraft(prev => ({
                      ...prev,
                      days: prev.days.includes(i)
                        ? prev.days.filter(x => x !== i)
                        : [...prev.days, i].sort()
                    }))}
                    className={cn(
                      "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                      draft.days.includes(i)
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                    )}
                  >{d}</button>
                ))}
              </div>
            </div>

            <div className="flex gap-4">
              <div className="space-y-1.5 flex-1">
                <label className="text-xs text-zinc-400">Hour (0-23)</label>
                <input
                  type="number"
                  min={0} max={23}
                  value={draft.hour}
                  onChange={e => setDraft(d => ({ ...d, hour: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <label className="text-xs text-zinc-400">Minute (0-59)</label>
                <input
                  type="number"
                  min={0} max={59}
                  value={draft.minute}
                  onChange={e => setDraft(d => ({ ...d, minute: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="primary" size="sm" onClick={save} disabled={!draft.model_id}>Save</Button>
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schedule list */}
      {schedules.length === 0 && !editing && (
        <div className="text-center text-zinc-600 py-20">
          No schedules yet — create one to auto-switch models on a timer
        </div>
      )}

      <div className="space-y-3">
        {schedules.map(rule => (
          <Card
            key={rule.id}
            className={cn(
              "cursor-pointer hover:border-white/20 transition-colors",
              !rule.enabled && "opacity-50"
            )}
            onClick={() => startEdit(rule)}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <Clock className="w-5 h-5 text-zinc-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-100">
                  {rule.label || modelName(rule.model_id)}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {describeSchedule(rule)}
                  {rule.label && <span className="ml-2 text-zinc-600">→ {modelName(rule.model_id)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => toggle(rule)}
                  className={cn(
                    "p-1.5 rounded transition-colors",
                    rule.enabled ? "text-green-400 hover:text-green-300" : "text-zinc-600 hover:text-zinc-400"
                  )}
                  title={rule.enabled ? "Disable" : "Enable"}
                >
                  <Power className="w-4 h-4" />
                </button>
                <button
                  onClick={() => del(rule.id)}
                  className="p-1.5 rounded text-zinc-600 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
