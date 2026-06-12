import { elevation, shadows } from '../tokens';

describe('Design Tokens', () => {
  describe('elevation', () => {
    it('should have card elevation', () => {
      expect(elevation.card).toBeDefined();
      expect(typeof elevation.card).toBe('number');
    });

    it('should have sheet elevation', () => {
      expect(elevation.sheet).toBeDefined();
      expect(typeof elevation.sheet).toBe('number');
    });
  });

  describe('shadows', () => {
    it('should have card shadow config', () => {
      expect(shadows.card).toBeDefined();
      expect(shadows.card).toHaveProperty('shadowColor');
      expect(shadows.card).toHaveProperty('shadowOffset');
      expect(shadows.card).toHaveProperty('shadowOpacity');
      expect(shadows.card).toHaveProperty('shadowRadius');
      expect(shadows.card).toHaveProperty('elevation');
    });

    it('should have sheet shadow config', () => {
      expect(shadows.sheet).toBeDefined();
      expect(shadows.sheet).toHaveProperty('shadowColor');
      expect(shadows.sheet).toHaveProperty('shadowOffset');
      expect(shadows.sheet).toHaveProperty('shadowOpacity');
      expect(shadows.sheet).toHaveProperty('shadowRadius');
      expect(shadows.sheet).toHaveProperty('elevation');
    });
  });
});
