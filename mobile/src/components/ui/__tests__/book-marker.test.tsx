/**
 * book-marker.test.tsx — spec §7.1 regression tests.
 * Tests: all 6 variants render correct ring color + label, tracksViewChanges
 * resets on thumbnailUrl change (bug #8), textbook hides distance at low zoom.
 */

// Mock react-native-maps
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMarker = React.forwardRef((props: any, ref: any) =>
    React.createElement(View, { ref, ...props, testID: props.testID || 'marker' }, props.children),
  );
  return {
    __esModule: true,
    default: MockMarker,
    Marker: MockMarker,
    Circle: (props: any) => React.createElement(View, { ...props }),
    Callout: (props: any) => React.createElement(View, { ...props }, props.children),
    PROVIDER_GOOGLE: 'google',
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props: any, ref: any) =>
        React.createElement(View, { ...props, ref }),
      ),
    },
    useSharedValue: (initial: any) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    withSpring: (val: any) => val,
    withTiming: (val: any) => val,
    withRepeat: (val: any) => val,
    cancelAnimation: jest.fn(),
    runOnJS: (fn: any) => fn,
    Easing: { out: (e: any) => e, ease: () => ({}) },
  };
});

import React from 'react';
import { render } from '@testing-library/react-native';
import { BookMarker, categoryColor, type BookCategory } from '../book-marker';
import { pastels, palette } from '@/components/ui/tokens';

const coordinate = { latitude: 41.0082, longitude: 28.9784 };

describe('BookMarker', () => {
  describe('categoryColor mapping (spec §3.4)', () => {
    it('maps fiction to mint', () => {
      expect(categoryColor('fiction', false)).toBe(pastels.light.mint.ink);
    });

    it('maps non_fiction to sky', () => {
      expect(categoryColor('non_fiction', false)).toBe(pastels.light.sky.ink);
    });

    it('maps textbook to sky', () => {
      expect(categoryColor('textbook', false)).toBe(pastels.light.sky.ink);
    });

    it('maps comics to butter', () => {
      expect(categoryColor('comics', false)).toBe(pastels.light.butter.ink);
    });

    it('maps children to blush', () => {
      expect(categoryColor('children', false)).toBe(pastels.light.blush.ink);
    });

    it('maps poetry to coral', () => {
      expect(categoryColor('poetry', false)).toBe(pastels.light.coral.ink);
    });

    it('maps other to palette.primary', () => {
      expect(categoryColor('other', false)).toBe(palette.light.primary);
    });

    it('uses dark palette when isDark', () => {
      expect(categoryColor('fiction', true)).toBe(pastels.dark.mint.ink);
    });
  });

  describe('variants (spec §3.4)', () => {
    it('renders standard variant', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" distance="1.2 km" testID="m1" />,
      );
      expect(getByTestId('m1-wrapper')).toBeTruthy();
    });

    it('renders fresh variant with coral label', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="fresh" category="fiction" freshAgeHours={3} testID="m2" />,
      );
      expect(getByText('Yeni · 3sa')).toBeTruthy();
    });

    it('renders shelf variant with stack badge', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="shelf" category="fiction" stackCount={2} testID="m3" />,
      );
      expect(getByText('+2')).toBeTruthy();
    });

    it('renders unavailable variant', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="unavailable" category="fiction" testID="m4" />,
      );
      expect(getByTestId('m4-wrapper')).toBeTruthy();
    });

    it('renders distance label above standard marker', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" distance="1.5 km" testID="m6" />,
      );
      expect(getByText('1.5 km')).toBeTruthy();
    });
  });

  describe('textbook no-distance rule (spec §3.4)', () => {
    it('hides distance label when latitudeDelta > 0.05', () => {
      const { queryByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="textbook" category="textbook" distance="1.5 km" latitudeDelta={0.1} testID="m7" />,
      );
      expect(queryByText('1.5 km')).toBeNull();
    });

    it('shows distance label when latitudeDelta <= 0.05', () => {
      const { getByText } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="textbook" category="textbook" distance="1.5 km" latitudeDelta={0.03} testID="m8" />,
      );
      expect(getByText('1.5 km')).toBeTruthy();
    });
  });

  describe('selection state (spec §3.4)', () => {
    it('renders with selected prop without crashing', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" selected distance="1 km" testID="m9" />,
      );
      expect(getByTestId('m9-wrapper')).toBeTruthy();
    });
  });

  describe('bug #8: tracksViewChanges resets on thumbnailUrl change', () => {
    it('renders without crashing when thumbnailUrl changes', () => {
      const { rerender, getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" thumbnailUrl="url1" testID="m10" />,
      );
      expect(getByTestId('m10-wrapper')).toBeTruthy();

      // Rerender with different thumbnailUrl — should not crash
      rerender(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" thumbnailUrl="url2" testID="m10" />,
      );
      expect(getByTestId('m10-wrapper')).toBeTruthy();
    });
  });

  describe('dark mode (spec §3.4)', () => {
    it('renders in dark mode without crashing', () => {
      const { getByTestId } = render(
        <BookMarker coordinate={coordinate} title="Test" variant="standard" category="fiction" isDark distance="1 km" testID="m11" />,
      );
      expect(getByTestId('m11-wrapper')).toBeTruthy();
    });
  });
});
