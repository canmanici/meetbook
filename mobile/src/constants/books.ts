import type { components } from '@/lib/api/schema';

export type BookCategory = components['schemas']['BookCategory'];
export type BookCondition = components['schemas']['BookCondition'];

export const BOOK_CATEGORIES: BookCategory[] = [
  'fiction',
  'non_fiction',
  'textbook',
  'children',
  'comics',
  'poetry',
  'other',
];

export const BOOK_CATEGORY_LABELS: Record<BookCategory, string> = {
  fiction: 'Roman',
  non_fiction: 'Kurgu Dışı',
  textbook: 'Ders Kitabı',
  children: 'Çocuk',
  comics: 'Çizgi Roman',
  poetry: 'Şiir',
  other: 'Diğer',
};

export const BOOK_CONDITIONS: BookCondition[] = ['new', 'like_new', 'good', 'worn'];

export const BOOK_CONDITION_LABELS: Record<BookCondition, string> = {
  new: 'Yeni',
  like_new: 'Yeni Gibi',
  good: 'İyi',
  worn: 'Kullanılmış',
};

export const BOOK_LANGUAGES: { code: string; label: string }[] = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'İngilizce' },
];

export const BOOK_LANGUAGE_LABELS: Record<string, string> = {
  tr: 'Türkçe',
  en: 'İngilizce',
};
