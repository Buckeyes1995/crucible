"use client";

import { useEffect, useState } from "react";
import { api, type ModelEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderOpen, Plus, Trash2, Save } from "lucide-react";

const BASE = "/api";
type Group = { id: string; name: string; description: string; model_ids: string[] };

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editIds, setEditIds] = useState<string[]>([]);

  const load = () => {
    fetch(`${BASE}/groups`).then((r) => r.json()).then(setGroups);
    api.models.list().then((all) => setModels(all.filter((m) => m.node === "local" && !m.hidden)));
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    await fetch(`${BASE}/groups`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDesc }) });
    setNewName(""); setNewDesc(""); setShowCreate(false); load();
  };

  const del = async (id: string) => {
    await fetch(`${BASE}/groups/${id}`, { method: "DELETE" }); load();
  };

  const startEdit = (g: Group) => { setEditing(g.id); setEditIds([...g.model_ids]); };

  const saveEdit = async (id: string) => {
    await fetch(`${BASE}/groups/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_ids: editIds }) });
    setEditing(null); load();
  };

  const toggleModel = (id: string) => {
    setEditIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderOpen className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Model Groups</h1>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(!showCreate)} className="gap-1.5 text-xs">
          <Plus className="w-3.5 h-3.5" /> New Group
        </Button>
      </div>

      {showCreate && (
        <div className="space-y-3 p-4 rounded-xl border border-white/10 bg-zinc-900/50">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name" />
          <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" />
          <Button variant="primary" onClick={create} disabled={!newName.trim()}>Create</Button>
        </div>
      )}

      {groups.length === 0 && !showCreate && (
        <div className="text-center py-16 text-zinc-500">No groups yet. Create one to organize your models.</div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">{g.name}</h3>
              {g.description && <p className="text-xs text-zinc-500">{g.description}</p>}
            </div>
            <div className="flex gap-1.5">
              {editing === g.id ? (
                <Button variant="primary" className="text-xs gap-1" onClick={() => saveEdit(g.id)}>
                  <Save className="w-3 h-3" /> Save
                </Button>
              ) : (
                <Button variant="ghost" className="text-xs" onClick={() => startEdit(g)}>Edit models</Button>
              )}
              <Button variant="ghost" className="text-xs text-red-400 px-2" onClick={() => del(g.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {editing === g.id ? (
            <div className="flex gap-1.5 flex-wrap">
              {models.map((m) => (
                <button key={m.id} onClick={() => toggleModel(m.id)}
                  className={cn("px-2 py-1 rounded text-xs transition-colors",
                    editIds.includes(m.id) ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100")}>
                  {m.name.slice(0, 25)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {g.model_ids.length === 0 ? (
                <span className="text-xs text-zinc-600">No models in this group</span>
              ) : (
                g.model_ids.map((id) => {
                  const m = models.find((x) => x.id === id);
                  return (
                    <span key={id} className="px-2 py-0.5 rounded bg-zinc-800 text-xs text-zinc-300">
                      {m?.name.slice(0, 25) ?? id}
                    </span>
                  );
                })
              )}
            </div>
          )}
          <div className="text-xs text-zinc-600">{g.model_ids.length} models</div>
        </div>
      ))}
    </div>
  );
}
