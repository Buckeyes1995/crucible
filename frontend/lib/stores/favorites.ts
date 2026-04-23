"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Favorites are now server-side — stored at ~/.config/crucible/favorites.json
// and surfaced via /api/favorites. We keep localStorage as a cache so the
// UI paints instantly on reload, then reconcile with the server in the
// background via sync(). Writes go to the server first; the cache
// updates after the round-trip returns.
type FavoritesState = {
  favorites: string[];
  favoritesOnly: boolean;
  hydrated: boolean;
  toggle: (id: string) => Promise<void>;
  isFavorite: (id: string) => boolean;
  setFavoritesOnly: (v: boolean) => void;
  sync: () => Promise<void>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      favoritesOnly: true,
      hydrated: false,

      toggle: async (id) => {
        // Optimistic update so the star flips immediately; revert on failure.
        const before = get().favorites;
        const optimistic = before.includes(id) ? before.filter(x => x !== id) : [...before, id];
        set({ favorites: optimistic });
        try {
          const { ids } = await api<{ ids: string[] }>("/api/favorites/toggle", {
            method: "POST",
            body: JSON.stringify({ id }),
          });
          set({ favorites: ids });
        } catch {
          set({ favorites: before });
        }
      },

      isFavorite: (id) => get().favorites.includes(id),
      setFavoritesOnly: (v) => set({ favoritesOnly: v }),

      sync: async () => {
        try {
          const { ids } = await api<{ ids: string[] }>("/api/favorites");
          // One-shot migration: if the server has no favorites yet but the
          // cache does, push the local list up. Keeps the user's existing
          // selection intact through the localStorage → server transition.
          const local = get().favorites;
          if (ids.length === 0 && local.length > 0) {
            const pushed = await api<{ ids: string[] }>("/api/favorites", {
              method: "PUT",
              body: JSON.stringify({ ids: local }),
            });
            set({ favorites: pushed.ids, hydrated: true });
            return;
          }
          set({ favorites: ids, hydrated: true });
        } catch {
          // Server down — keep the cache, mark hydrated anyway so we
          // don't spin forever.
          set({ hydrated: true });
        }
      },
    }),
    {
      name: "crucible-favorites",
      partialize: (s) => ({ favorites: s.favorites, favoritesOnly: s.favoritesOnly }) as Partial<FavoritesState>,
    },
  ),
);
