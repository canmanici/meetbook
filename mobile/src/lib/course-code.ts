/**
 * Course codes, normalized the same way as the backend
 * (app/core/content_policy.normalize_course_code): 'mat-101' → 'MAT101'.
 */
const TR_FOLD: Record<string, string> = {
  ı: 'I', İ: 'I', ş: 'S', Ş: 'S', ç: 'C', Ç: 'C', ö: 'O', Ö: 'O', ü: 'U', Ü: 'U', ğ: 'G', Ğ: 'G',
};

function fold(raw: string): string {
  return raw.replace(/[ıİşŞçÇöÖüÜğĞ]/g, (c) => TR_FOLD[c] ?? c).toUpperCase();
}

/** Normalized code, '' for empty input, or null if it isn't a course code. */
export function normalizeCourseCode(raw: string): string | null {
  const code = fold(raw).replace(/[\s\-_./]/g, '');
  if (!code) return '';
  return /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{3,12}$/.test(code) ? code : null;
}

/** Prefix for course autocomplete: letters and digits only. */
export function courseCodePrefix(raw: string): string {
  return fold(raw).replace(/[^A-Z0-9]/g, '');
}
