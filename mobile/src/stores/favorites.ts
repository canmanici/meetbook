import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { secureStorage } from "@/lib/secure-store";

export interface FavoriteItem {
  bookId: string;
  addedAt: string;
  title: string;
  coverUrl?: string;
  ownerId: string;
}

interface FavoritesState {
  favorites: Record<string, FavoriteItem>;
  addFavorite: (item: FavoriteItem) => boolean;
  removeFavorite: (bookId: string) => boolean;
  isFavorited: (bookId: string) => boolean;
  count: () => number;
  clearAll: () => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: {},

      addFavorite: (item) => {
        const state = get();
        if (state.favorites[item.bookId]) return false;
        set({ favorites: { ...state.favorites, [item.bookId]: item } });
        return true;
      },

      removeFavorite: (bookId) => {
        const state = get();
        if (!state.favorites[bookId]) return false;
        const { [bookId]: _, ...rest } = state.favorites;
        set({ favorites: rest });
        return true;
      },

      isFavorited: (bookId) => {
        return bookId in get().favorites;
      },

      count: () => {
        return Object.keys(get().favorites).length;
      },

      clearAll: () => {
        set({ favorites: {} });
      },
    }),
    {
      name: "meetbook-favorites",
      storage: createJSONStorage(() => secureStorage),
    }
  )
);
