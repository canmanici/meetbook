import { courseCodePrefix, normalizeCourseCode } from '../course-code';

describe('normalizeCourseCode (mirrors the backend)', () => {
  it.each([
    ['mat 101', 'MAT101'],
    ['MAT-101', 'MAT101'],
    ['Fiz101e', 'FIZ101E'],
    ['bil.1011', 'BIL1011'],
    ['şbl 101', 'SBL101'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeCourseCode(raw)).toBe(expected);
  });

  it('returns "" for empty and null for non-codes', () => {
    expect(normalizeCourseCode('  ')).toBe('');
    expect(normalizeCourseCode('101')).toBeNull();
    expect(normalizeCourseCode('MATH')).toBeNull();
    expect(normalizeCourseCode('MAT1010101010101')).toBeNull();
  });

  it('builds a safe autocomplete prefix', () => {
    expect(courseCodePrefix('mat%_1')).toBe('MAT1');
  });
});
