import { formatDistance } from '../format';

describe('formatDistance', () => {
  it('formats a normal distance with one decimal', () => {
    expect(formatDistance(2.4)).toBe('2.4 km');
  });

  it('formats a sub-km distance with one decimal', () => {
    expect(formatDistance(0.8)).toBe('0.8 km');
  });

  it('returns null for null/undefined input', () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(formatDistance(NaN)).toBeNull();
  });
});
