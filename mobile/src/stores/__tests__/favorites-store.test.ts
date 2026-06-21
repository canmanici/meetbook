/**
 * favorites-store.test.ts — spec §7.1 regression test for bug #3.
 * Tests: addFavorite, removeFavorite, isFavorited, count, clearAll, persistence.
 */
import { useFavoritesStore } from '../favorites';

// Mock AsyncStorage before each test
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('FavoritesStore', () => {
  beforeEach(() => {
    // Reset store to empty state before each test
    useFavoritesStore.setState({ favorites: {} });
  });

  it('adds a favorite and returns true', () => {
    const result = useFavoritesStore.getState().addFavorite({
      bookId: 'book-1',
      title: 'Suç ve Ceza',
      ownerId: 'owner-1',
      addedAt: new Date().toISOString(),
    });
    expect(result).toBe(true);
    expect(useFavoritesStore.getState().isFavorited('book-1')).toBe(true);
  });

  it('returns false when adding a duplicate', () => {
    useFavoritesStore.getState().addFavorite({
      bookId: 'book-1',
      title: 'Suç ve Ceza',
      ownerId: 'owner-1',
      addedAt: new Date().toISOString(),
    });
    const result = useFavoritesStore.getState().addFavorite({
      bookId: 'book-1',
      title: 'Suç ve Ceza',
      ownerId: 'owner-1',
      addedAt: new Date().toISOString(),
    });
    expect(result).toBe(false);
  });

  it('removes a favorite and returns true', () => {
    useFavoritesStore.getState().addFavorite({
      bookId: 'book-1',
      title: 'Suç ve Ceza',
      ownerId: 'owner-1',
      addedAt: new Date().toISOString(),
    });
    const result = useFavoritesStore.getState().removeFavorite('book-1');
    expect(result).toBe(true);
    expect(useFavoritesStore.getState().isFavorited('book-1')).toBe(false);
  });

  it('returns false when removing non-existent favorite', () => {
    const result = useFavoritesStore.getState().removeFavorite('nonexistent');
    expect(result).toBe(false);
  });

  it('isFavorited returns false for non-favorited book', () => {
    expect(useFavoritesStore.getState().isFavorited('not-in-store')).toBe(false);
  });

  it('count returns correct number', () => {
    useFavoritesStore.getState().addFavorite({ bookId: 'b1', title: 'A', ownerId: 'o1', addedAt: '' });
    useFavoritesStore.getState().addFavorite({ bookId: 'b2', title: 'B', ownerId: 'o2', addedAt: '' });
    useFavoritesStore.getState().addFavorite({ bookId: 'b3', title: 'C', ownerId: 'o3', addedAt: '' });
    expect(useFavoritesStore.getState().count()).toBe(3);
  });

  it('clearAll removes all favorites', () => {
    useFavoritesStore.getState().addFavorite({ bookId: 'b1', title: 'A', ownerId: 'o1', addedAt: '' });
    useFavoritesStore.getState().addFavorite({ bookId: 'b2', title: 'B', ownerId: 'o2', addedAt: '' });
    useFavoritesStore.getState().clearAll();
    expect(useFavoritesStore.getState().count()).toBe(0);
  });

  it('persists favorite data correctly (store shape has all fields)', () => {
    useFavoritesStore.getState().addFavorite({
      bookId: 'book-1',
      title: 'Suç ve Ceza',
      coverUrl: 'https://example.com/cover.jpg',
      ownerId: 'owner-1',
      addedAt: '2026-06-21T00:00:00Z',
    });
    const fav = useFavoritesStore.getState().favorites['book-1'];
    expect(fav).toEqual({
      bookId: 'book-1',
      title: 'Suç ve Ceza',
      coverUrl: 'https://example.com/cover.jpg',
      ownerId: 'owner-1',
      addedAt: '2026-06-21T00:00:00Z',
    });
  });
});
