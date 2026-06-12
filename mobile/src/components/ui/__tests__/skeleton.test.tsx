import React from 'react';
import { render } from '@testing-library/react-native';
import { Skeleton } from '../skeleton';

describe('Skeleton Component', () => {
  describe('list-item variant (default)', () => {
    it('renders correctly with default props', () => {
      const { getByTestId } = render(<Skeleton />);

      expect(getByTestId('skeleton-list')).toBeTruthy();
    });

    it('renders all list-item elements', () => {
      const { getByTestId } = render(<Skeleton variant="list-item" />);

      expect(getByTestId('skeleton-list')).toBeTruthy();
      expect(getByTestId('skeleton-cover')).toBeTruthy();
      expect(getByTestId('skeleton-title')).toBeTruthy();
      expect(getByTestId('skeleton-author')).toBeTruthy();
      expect(getByTestId('skeleton-badge')).toBeTruthy();
      expect(getByTestId('skeleton-distance')).toBeTruthy();
    });

    it('uses correct dimensions for list item', () => {
      const { getByTestId } = render(<Skeleton variant="list-item" />);

      const cover = getByTestId('skeleton-cover');
      expect(cover.props.style.width).toBe(50);
      expect(cover.props.style.height).toBe(70);
    });

    it('applies custom container style', () => {
      const { getByTestId } = render(
        <Skeleton variant="list-item" style={{ marginTop: 10 }} />
      );

      const container = getByTestId('skeleton-list');
      expect(container.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ marginTop: 10 })
        ])
      );
    });
  });

  describe('card variant', () => {
    it('renders correctly with card variant', () => {
      const { getByTestId } = render(<Skeleton variant="card" />);

      expect(getByTestId('skeleton-card')).toBeTruthy();
    });

    it('renders all card elements', () => {
      const { getByTestId } = render(<Skeleton variant="card" />);

      expect(getByTestId('skeleton-card')).toBeTruthy();
      expect(getByTestId('skeleton-cover')).toBeTruthy();
      expect(getByTestId('skeleton-title')).toBeTruthy();
      expect(getByTestId('skeleton-author')).toBeTruthy();
      expect(getByTestId('skeleton-badge')).toBeTruthy();
      expect(getByTestId('skeleton-distance')).toBeTruthy();
    });

    it('uses correct dimensions for card', () => {
      const { getByTestId } = render(<Skeleton variant="card" />);

      const cover = getByTestId('skeleton-cover');
      expect(cover.props.style.width).toBe(60);
      expect(cover.props.style.height).toBe(80);
    });

    it('applies custom container style', () => {
      const { getByTestId } = render(
        <Skeleton variant="card" style={{ marginTop: 10 }} />
      );

      const container = getByTestId('skeleton-card');
      expect(container.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ marginTop: 10 })
        ])
      );
    });
  });

  describe('design system compliance', () => {
    it('uses correct spacing tokens', () => {
      const { getByTestId } = render(<Skeleton variant="list-item" />);
      const cover = getByTestId('skeleton-cover');

      // marginRight should use spacing.md (12)
      expect(cover.props.style.marginRight).toBe(12);
    });

    it('uses correct radius tokens', () => {
      const { getByTestId } = render(<Skeleton variant="list-item" />);
      const cover = getByTestId('skeleton-cover');

      // borderRadius should use radius.input (8)
      expect(cover.props.style.borderRadius).toBe(8);
    });

    it('uses shimmer effect opacity', () => {
      const { getByTestId } = render(<Skeleton variant="list-item" />);
      const cover = getByTestId('skeleton-cover');

      // Opacity should be 0.15 for shimmer effect
      expect(cover.props.style.opacity).toBe(0.15);
    });
  });
});
