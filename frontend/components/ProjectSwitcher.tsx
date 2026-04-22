"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, FolderOpen, Check, Trash2, X as XIcon, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { useProjectsStore, type ProjectFilter, type Project } from "@/lib/stores/projects";

// Palette for new projects — user picks one from this set.
const COLORS = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#06b6d4", "#a855f7", "#ef4444", "#84cc16"];

export function ProjectSwitcher() {
  const { projects, activeId, setActive, fetchProjects, deleteProject } = useProjectsStore();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // Click-outside + Esc to close the dropdown.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-project-switcher]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = activeId && activeId !== "__none__" ? projects.find(p => p.id === activeId) : null;
  const label = active ? active.name : activeId === "__none__" ? "Uncategorized" : "All projects";
  const accent = active?.color ?? (activeId === "__none__" ? "#71717a" : "#6366f1");

  const handleDelete = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}"? Chats + snippets will be un-assigned, not deleted.`)) return;
    try {
      await deleteProject(p.id, true);
      toast(`Deleted project ${p.name}`, "success");
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "error");
    }
  };

  return (
    <div className="relative px-3 py-2.5 border-b border-white/[0.04]" data-project-switcher>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5 hover:bg-zinc-900/60 transition-colors"
      >
        <span className="w-1 self-stretch rounded-full" style={{ backgroundColor: accent }} />
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Project</div>
          <div className="text-sm font-semibold text-zinc-100 truncate">{label}</div>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-30 rounded-lg border border-white/10 bg-zinc-950 shadow-2xl max-h-[70vh] overflow-y-auto">
          <ProjectRow
            label="All projects"
            active={activeId === null}
            onClick={() => { setActive(null); setOpen(false); }}
            color="#6366f1"
            count={projects.reduce((n, p) => n + (p.chat_count ?? 0), 0)}
          />
          <ProjectRow
            label="Uncategorized"
            active={activeId === "__none__"}
            onClick={() => { setActive("__none__"); setOpen(false); }}
            color="#71717a"
            count={null}
          />
          {projects.length > 0 && (
            <div className="border-t border-white/[0.06] my-1" />
          )}
          {projects.map(p => (
            <ProjectRow
              key={p.id}
              label={p.name}
              active={activeId === p.id}
              onClick={() => { setActive(p.id); setOpen(false); }}
              color={p.color ?? "#6366f1"}
              count={p.chat_count ?? 0}
              onDelete={() => handleDelete(p)}
            />
          ))}
          <div className="border-t border-white/[0.06] my-1" />
          <button
            onClick={() => { setDialogOpen(true); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-300 hover:bg-indigo-950/30"
          >
            <Plus className="w-3.5 h-3.5" /> New project…
          </button>
        </div>
      )}

      {dialogOpen && (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(p) => { setActive(p.id); setDialogOpen(false); }}
        />
      )}
    </div>
  );
}

function ProjectRow({
  label, active, onClick, color, count, onDelete,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: string;
  count: number | null;
  onDelete?: () => void;
}) {
  return (
    <div className={cn("group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-900/60 cursor-pointer", active && "bg-indigo-950/20")} onClick={onClick}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className={cn("text-sm truncate flex-1", active ? "text-zinc-100 font-medium" : "text-zinc-300")}>{label}</span>
      {count !== null && <span className="text-[10px] text-zinc-600 font-mono">{count}</span>}
      {active && <Check className="w-3 h-3 text-indigo-400" />}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete project"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const { createProject } = useProjectsStore();

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const p = await createProject({
        name: name.trim(),
        color,
        system_prompt: systemPrompt.trim() || null,
      });
      toast(`Created project ${p.name}`, "success");
      onCreated(p);
    } catch (e) {
      toast(`Create failed: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-indigo-300" /> New project
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder="e.g. Infra refactor"
              className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1.5">Color</label>
            <div className="flex gap-1.5">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "w-6 h-6 rounded-full transition-transform",
                    color === c && "ring-2 ring-offset-2 ring-offset-zinc-950 scale-110",
                  )}
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">
              System prompt <span className="text-zinc-600">(optional — applied to new chats in this project)</span>
            </label>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="Default system prompt for chats started in this project…"
              className="w-full bg-zinc-900 border border-white/[0.08] rounded px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-white/[0.08] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim() || saving} className="gap-1.5">
            {saving ? "Creating…" : (<><Folder className="w-3.5 h-3.5" /> Create</>)}
          </Button>
        </div>
      </div>
    </div>
  );
}
