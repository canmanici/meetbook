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

/**
 * Radius scale — warm & rounded.
 * `input` stays 8 (asserted by skeleton tests + used for cover thumbnails).
 * Everything chunky/playful uses the larger keys below.
 */
export const radius = {
  input: 8,
  field: 16,
  button: 18,
  card: 22,
  tile: 26,
  sheet: 28,
  pill: 999,
} as const;

export const palette = {
  light: {
    primary: '#11806B',
    primarySoft: '#D6EFE7',
    background: '#FBF6EC',
    surface: '#FFFFFF',
    surfaceAlt: '#F4EEE1',
    text: '#2A2722',
    textMuted: '#8A8378',
    border: '#ECE4D6',
    accent: '#F2766B',
    success: '#2FA36B',
    warning: '#E8A13A',
    danger: '#E5645A',
    info: '#5B9BD5',
  },
  dark: {
    primary: '#4FC2AB',
    primarySoft: '#1C3A34',
    background: '#15140F',
    surface: '#211F1A',
    surfaceAlt: '#2B2922',
    text: '#F3EFE6',
    textMuted: '#A39E94',
    border: '#332F27',
    accent: '#FF9387',
    success: '#5BD89A',
    warning: '#F4BE63',
    danger: '#FF8175',
    info: '#7FB5E6',
  },
} as const;

/**
 * Pastel accent set — for playful category tiles, avatars, decorative chips.
 * Each entry has a soft fill (bg) and a saturated ink for text/icons on it.
 */
export const pastels = {
  light: {
    coral: { bg: '#FCE3DE', ink: '#C8503F' },
    butter: { bg: '#FBF0D2', ink: '#B0822A' },
    mint: { bg: '#D9F0E4', ink: '#2C8C63' },
    sky: { bg: '#DCEBF7', ink: '#3D7AB0' },
    lilac: { bg: '#E9E2F6', ink: '#6E55B0' },
    blush: { bg: '#FBE2EC', ink: '#BC4F7A' },
  },
  dark: {
    coral: { bg: '#3A2722', ink: '#FF9F92' },
    butter: { bg: '#352D1C', ink: '#F4C977' },
    mint: { bg: '#1E332A', ink: '#6CD9A2' },
    sky: { bg: '#1F2E3A', ink: '#82B7E6' },
    lilac: { bg: '#2A2539', ink: '#A892E0' },
    blush: { bg: '#382430', ink: '#F08CB2' },
  },
} as const;

export type PastelName = keyof typeof pastels.light;

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
    shadowColor: '#3A2C18',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  sheet: {
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  float: {
    shadowColor: '#2A1F10',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 6,
  },
} as const;

export type ThemeName = keyof typeof palette;
export type ThemeColors = (typeof palette)[ThemeName];
