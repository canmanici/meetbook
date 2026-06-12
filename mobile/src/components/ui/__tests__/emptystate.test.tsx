import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { EmptyState } from '../emptystate';

describe('EmptyState Component', () => {
  it('renders correctly with required props', () => {
    const { getByTestId, getByText } = render(
      <EmptyState message="No books found" />
    );

    expect(getByTestId('empty-state')).toBeTruthy();
    expect(getByTestId('empty-state-message')).toBeTruthy();
    expect(getByText('No books found')).toBeTruthy();
  });

  it('renders default illustration when none provided', () => {
    const { getByTestId } = render(
      <EmptyState message="No results" />
    );

    expect(getByTestId('default-illustration')).toBeTruthy();
  });

  it('renders custom illustration when provided', () => {
    const CustomIllustration = () => <View testID="custom-illustration" />;
    const { getByTestId, queryByTestId } = render(
      <EmptyState
        message="No results"
        illustration={<CustomIllustration />}
      />
    );

    expect(getByTestId('custom-illustration')).toBeTruthy();
    expect(queryByTestId('default-illustration')).toBeNull();
  });

  it('renders description when provided', () => {
    const { getByTestId, getByText } = render(
      <EmptyState
        message="No books found"
        description="Try adjusting your filters"
      />
    );

    expect(getByTestId('empty-state-description')).toBeTruthy();
    expect(getByText('Try adjusting your filters')).toBeTruthy();
  });

  it('does not render description when not provided', () => {
    const { queryByTestId } = render(
      <EmptyState message="No books found" />
    );

    expect(queryByTestId('empty-state-description')).toBeNull();
  });

  it('renders action button when label and callback provided', () => {
    const mockOnAction = jest.fn();
    const { getByTestId, getByText } = render(
      <EmptyState
        message="No books found"
        actionLabel="Clear filters"
        onAction={mockOnAction}
      />
    );

    expect(getByTestId('empty-state-action')).toBeTruthy();
    expect(getByText('Clear filters')).toBeTruthy();
  });

  it('does not render action button when only label provided', () => {
    const { queryByTestId } = render(
      <EmptyState
        message="No books found"
        actionLabel="Clear filters"
      />
    );

    expect(queryByTestId('empty-state-action')).toBeNull();
  });

  it('does not render action button when only callback provided', () => {
    const mockOnAction = jest.fn();
    const { queryByTestId } = render(
      <EmptyState
        message="No books found"
        onAction={mockOnAction}
      />
    );

    expect(queryByTestId('empty-state-action')).toBeNull();
  });

  it('calls onAction when action button is pressed', () => {
    const mockOnAction = jest.fn();
    const { getByTestId } = render(
      <EmptyState
        message="No books found"
        actionLabel="Clear filters"
        onAction={mockOnAction}
      />
    );

    fireEvent.press(getByTestId('empty-state-action'));
    expect(mockOnAction).toHaveBeenCalledTimes(1);
  });

  it('applies custom container style', () => {
    const { getByTestId } = render(
      <EmptyState
        message="No books found"
        style={{ backgroundColor: '#f0f0f0' }}
      />
    );

    const container = getByTestId('empty-state');
    expect(container.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: '#f0f0f0' })
      ])
    );
  });

  it('renders all elements together', () => {
    const mockOnAction = jest.fn();
    const { getByTestId, getByText } = render(
      <EmptyState
        message="No books found"
        description="Try adjusting your filters"
        actionLabel="Clear filters"
        onAction={mockOnAction}
      />
    );

    expect(getByTestId('empty-state')).toBeTruthy();
    expect(getByTestId('default-illustration')).toBeTruthy();
    expect(getByTestId('empty-state-message')).toBeTruthy();
    expect(getByTestId('empty-state-description')).toBeTruthy();
    expect(getByTestId('empty-state-action')).toBeTruthy();
    expect(getByText('No books found')).toBeTruthy();
    expect(getByText('Try adjusting your filters')).toBeTruthy();
    expect(getByText('Clear filters')).toBeTruthy();
  });
});
