/**
 * Design tokens — single source of truth for spacing, type, radius, and color.
 * See docs/DESIGN_SYSTEM.md. Never hardcode these values in screens.
 */

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const fontSize = {
  caption: 12,
  bodySm: 14,
  body: 16,
  title: 20,
  heading: 24,
  display: 32,
} as const;

export const radius = { input: 8, sheet: 16, pill: 999 } as const;

export const palette = {
  light: {
    primary: '#0F6E5D',
    background: '#F7F5F0',
    surface: '#FFFFFF',
    text: '#1C1B18',
    textMuted: '#6B6760',
    accent: '#D97706',
    success: '#15803D',
    warning: '#B45309',
    danger: '#B91C1C',
    info: '#1D4ED8',
  },
  dark: {
    primary: '#3CA08D',
    background: '#161513',
    surface: '#22211E',
    text: '#F0EEE8',
    textMuted: '#A39E94',
    accent: '#F59E0B',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    info: '#60A5FA',
  },
} as const;

/**
 * Elevation tokens — vertical spacing for layered surfaces.
 * - card: Use for cards, list items, and raised surfaces (subtle elevation)
 * - sheet: Use for bottom sheets, modals, and overlays (prominent elevation)
 */
export const elevation = {
  card: 2,
  sheet: 4,
} as const;

/**
 * Shadow tokens — depth cues for elevated surfaces.
 * - card: Subtle shadow for cards and list items
 * - sheet: Prominent shadow for bottom sheets and modals
 *
 * Note: shadowColor is always black ('#000') regardless of theme.
 * Shadows in physical environments are black/dark by nature (light blocked),
 * so this works consistently across both light and dark themes.
 */
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

export type ThemeName = keyof typeof palette;
