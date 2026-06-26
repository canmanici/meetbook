import React from 'react';
import { render } from '@testing-library/react-native';

// Mock expo-image before importing the component
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Image: (props: any) => React.createElement(View, { ...props, testID: props.testID || 'expo-image' }),
  };
});

import { BookCover } from '../book-cover';
import { palette } from '../tokens';

describe('BookCover', () => {
  it('renders expo-image when url is provided', () => {
    const { getByTestId } = render(<BookCover url="https://example.com/cover.jpg" />);
    expect(getByTestId('book-cover-image')).toBeTruthy();
  });

  it('renders fallback icon when url is null', () => {
    const { getByTestId, queryByTestId } = render(<BookCover url={null} />);
    expect(getByTestId('book-cover-fallback')).toBeTruthy();
    expect(queryByTestId('book-cover-image')).toBeNull();
  });

  it('renders fallback icon when url is undefined', () => {
    const { getByTestId } = render(<BookCover url={undefined} />);
    expect(getByTestId('book-cover-fallback')).toBeTruthy();
  });
});
