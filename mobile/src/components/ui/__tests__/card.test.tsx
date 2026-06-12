import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card, BookCard } from '../card';

describe('Card Component', () => {
  it('renders basic card with children', () => {
    const { getByText } = render(
      <Card>
        <Text>Card content</Text>
      </Card>
    );
    expect(getByText('Card content')).toBeTruthy();
  });

  it('renders BookCard with required props', () => {
    const { getByText, getByTestId } = render(
      <BookCard
        title="The Great Gatsby"
        author="F. Scott Fitzgerald"
        condition="good"
        distance="3 km"
        coverImageUrl="https://example.com/cover.jpg"
      />
    );
    expect(getByText('The Great Gatsby')).toBeTruthy();
    expect(getByText('F. Scott Fitzgerald')).toBeTruthy();
    expect(getByText('~3 km')).toBeTruthy();
    expect(getByTestId('condition-badge')).toBeTruthy();
  });

  it('displays condition badge', () => {
    const { getByTestId, getByText } = render(
      <BookCard
        title="Test Book"
        author="Test Author"
        condition="like-new"
        distance="5 km"
        coverImageUrl="https://example.com/cover.jpg"
      />
    );
    expect(getByTestId('condition-badge')).toBeTruthy();
    expect(getByText('Yeni gibi')).toBeTruthy();
  });

  it('handles press event', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <BookCard
        title="Test Book"
        author="Test Author"
        condition="good"
        distance="2 km"
        coverImageUrl="https://example.com/cover.jpg"
        onPress={onPress}
        testID="book-card"
      />
    );

    const card = getByTestId('book-card');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders without cover image', () => {
    const { getByText, queryByTestId } = render(
      <BookCard
        title="Test Book"
        author="Test Author"
        condition="fair"
        distance="1 km"
      />
    );
    expect(getByText('Test Book')).toBeTruthy();
    expect(queryByTestId('book-cover')).toBeNull();
  });

  it('displays correct condition labels', () => {
    const conditions = [
      { condition: 'new' as const, label: 'Yeni' },
      { condition: 'like-new' as const, label: 'Yeni gibi' },
      { condition: 'good' as const, label: 'İyi' },
      { condition: 'fair' as const, label: 'İdare eder' },
      { condition: 'poor' as const, label: 'Kötü' },
    ];

    conditions.forEach(({ condition, label }) => {
      const { getByText } = render(
        <BookCard
          title="Test"
          author="Test"
          condition={condition}
          distance="1 km"
        />
      );
      expect(getByText(label)).toBeTruthy();
    });
  });
});
