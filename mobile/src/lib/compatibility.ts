import type { BookCategory } from '@/constants/books';

/**
 * Reading-compatibility calculator.
 *
 * Compares two users' book categories using the Jaccard index:
 *   score = |A ∩ B| / |A ∪ B| * 100
 *
 * The score is an integer in [0, 100]. When both users have no categories
 * the union is empty and the score is defined as 0 (no signal to compare).
 */

/** Threshold above which two users are considered "book twins". */
export const BOOK_TWIN_THRESHOLD = 85;

/** A book-like object that carries a category field. */
export interface CategorizedBook {
  category?: string | null;
}

/**
 * Reduces a list of books to the set of distinct categories they span.
 * Unknown/null categories are ignored so they never inflate the union.
 */
export function extractCategories(books: ReadonlyArray<CategorizedBook>): Set<BookCategory> {
  const set = new Set<BookCategory>();
  for (const book of books) {
    if (book.category) set.add(book.category as BookCategory);
  }
  return set;
}

/**
 * Jaccard compatibility score for two category sets, as an integer 0..100.
 * Returns 0 when both sets are empty (nothing to compare).
 */
export function computeCompatibilityScore(
  a: Iterable<string>,
  b: Iterable<string>,
): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set<string>([...setA, ...setB]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const cat of setA) {
    if (setB.has(cat)) intersection += 1;
  }
  return Math.round((intersection / union.size) * 100);
}

export interface CompatibilityResult {
  /** Integer score 0..100. */
  score: number;
  /** Categories present in both users' libraries. */
  sharedCategories: BookCategory[];
  /** True when score exceeds the book-twin threshold. */
  isTwin: boolean;
  /** True when there is enough signal to trust the score (non-empty union). */
  hasSignal: boolean;
}

/**
 * Full compatibility breakdown for two category sets.
 */
export function computeCompatibility(
  a: Iterable<string>,
  b: Iterable<string>,
): CompatibilityResult {
  const setA = new Set(a);
  const setB = new Set(b);
  const sharedCategories: BookCategory[] = [];
  for (const cat of setA) {
    if (setB.has(cat)) sharedCategories.push(cat as BookCategory);
  }
  const union = new Set<string>([...setA, ...setB]);
  const hasSignal = union.size > 0;
  const score = hasSignal
    ? Math.round((sharedCategories.length / union.size) * 100)
    : 0;
  return {
    score,
    sharedCategories,
    isTwin: score > BOOK_TWIN_THRESHOLD,
    hasSignal,
  };
}
