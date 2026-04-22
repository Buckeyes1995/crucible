"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Project = {
  id: string;
  name: string;
  color?: string | null;
  default_model_id?: string | null;
  system_prompt?: string | null;
  created_at?: string;
  updated_at?: string;
  chat_count?: number;
};

// `null` = "All projects" (no filter). `"__none__"` = Uncategorized only.
// `"<id>"` = scope to that project.
export type ProjectFilter = null | "__none__" | string;

type ProjectsState = {
  projects: Project[];
  loading: boolean;
  activeId: ProjectFilter;
  setActive: (id: ProjectFilter) => void;
  fetchProjects: () => Promise<void>;
  createProject: (p: { name: string; color?: string | null; system_prompt?: string | null; default_model_id?: string | null }) => Promise<Project>;
  updateProject: (id: string, p: Partial<Project>) => Promise<Project | null>;
  deleteProject: (id: string, detach?: boolean) => Promise<void>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],
      loading: false,
      activeId: null,
      setActive: (id) => set({ activeId: id }),
      fetchProjects: async () => {
        set({ loading: true });
        try {
          const projects = await api<Project[]>("/api/projects");
          set({ projects, loading: false });
        } catch {
          set({ loading: false });
        }
      },
      createProject: async (p) => {
        const created = await api<Project>("/api/projects", {
          method: "POST",
          body: JSON.stringify(p),
        });
        set({ projects: [created, ...get().projects] });
        return created;
      },
      updateProject: async (id, patch) => {
        try {
          const updated = await api<Project>(`/api/projects/${id}`, {
            method: "PUT",
            body: JSON.stringify(patch),
          });
          set({ projects: get().projects.map(x => x.id === id ? { ...x, ...updated } : x) });
          return updated;
        } catch {
          return null;
        }
      },
      deleteProject: async (id, detach = true) => {
        await fetch(`/api/projects/${id}?detach=${detach ? "true" : "false"}`, { method: "DELETE" });
        const active = get().activeId === id ? null : get().activeId;
        set({
          projects: get().projects.filter(x => x.id !== id),
          activeId: active,
        });
      },
    }),
    {
      name: "crucible-projects",
      // Only persist the active filter — projects list re-fetches on boot.
      partialize: (s) => ({ activeId: s.activeId }) as Partial<ProjectsState>,
    },
  ),
);

// Helper — convert ProjectFilter to the query-string value the backend expects.
export function projectQuery(id: ProjectFilter): string {
  if (id === null) return "";
  return `project=${encodeURIComponent(id)}`;
}
