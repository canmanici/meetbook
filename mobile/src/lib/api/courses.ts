/** Course search: which course codes have books, and the books for one course. */
import { absoluteMediaUrl, authedRequest } from '@/lib/api/client';

import type { components } from './schema';

export type CourseSummary = components['schemas']['CourseSummary'];
export type CourseBook = components['schemas']['BookSearchResult'];

export function listCourses(q: string): Promise<{ items: CourseSummary[] }> {
  return authedRequest('/books/courses', 'GET', undefined, { query: { q: q || undefined } });
}

export function searchCourseBooks(
  course: string,
  origin: { lat: number; lng: number } | null,
): Promise<{ items: CourseBook[] }> {
  return authedRequest('/books/search', 'GET', undefined, {
    query: {
      course,
      limit: 50,
      // With a position: the campus area first. Without: anywhere in Turkey.
      ...(origin ? { lat: origin.lat, lng: origin.lng, radius_km: 50 } : {}),
    },
  });
}

export function coverUrl(book: CourseBook): string | null {
  const photo = book.photos?.[0];
  return absoluteMediaUrl(photo?.thumbnail_url ?? photo?.url);
}
