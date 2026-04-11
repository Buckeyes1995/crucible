"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type FavoritesState = {
  favorites: string[];
  favoritesOnly: boolean;
  toggle: (id: string) => void;
  isFavorite: (id: string) => boolean;
  setFavoritesOnly: (v: boolean) => void;
};

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      favoritesOnly: true,
      toggle: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((x) => x !== id)
            : [...s.favorites, id],
        })),
      isFavorite: (id) => get().favorites.includes(id),
      setFavoritesOnly: (v) => set({ favoritesOnly: v }),
    }),
    { name: "crucible-favorites" }
  )
);
