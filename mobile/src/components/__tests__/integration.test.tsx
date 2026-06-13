import React from 'react';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import {
  Button,
  Input,
  Card,
  BookCard,
  Avatar,
  Badge,
  Sheet,
  EmptyState,
  Skeleton,
  Toast,
  InlineError,
} from '../ui';

describe('Design System Integration', () => {
  it('exports all components from barrel export', () => {
    expect(Button).toBeDefined();
    expect(Input).toBeDefined();
    expect(Card).toBeDefined();
    expect(BookCard).toBeDefined();
    expect(Avatar).toBeDefined();
    expect(Badge).toBeDefined();
    expect(Sheet).toBeDefined();
    expect(EmptyState).toBeDefined();
    expect(Skeleton).toBeDefined();
    expect(Toast).toBeDefined();
    expect(InlineError).toBeDefined();
  });

  it('all components use design tokens and render together', () => {
    const { getByText, getAllByText } = render(
      <View>
        <Button>Test</Button>
        <Input label="Test" />
        <Card>
          <Avatar name="Test" />
        </Card>
        <BookCard title="Test" author="Test" condition="good" category="Test" distanceKm={1} />
        <Avatar name="Test" />
        <Badge text="Test" />
        <EmptyState message="Test" />
        <Skeleton variant="list-item" />
        <Skeleton variant="card" />
        <Toast message="Test" visible variant="success" />
        <InlineError message="Test" />
      </View>
    );

    expect(getAllByText('Test').length).toBeGreaterThan(0);
    expect(getByText('1.0 km')).toBeTruthy();
  });

  it('Sheet renders its content when visible', () => {
    const { getByText, getByTestId } = render(
      <Sheet visible onClose={() => {}} title="Sheet Title">
        <Button>Inside Sheet</Button>
      </Sheet>
    );

    expect(getByTestId('sheet-container')).toBeTruthy();
    expect(getByText('Sheet Title')).toBeTruthy();
    expect(getByText('Inside Sheet')).toBeTruthy();
  });
});
