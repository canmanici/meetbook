import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../button';

describe('Button Component', () => {
  it('renders primary variant correctly', () => {
    const { getByText } = render(<Button variant="primary">Press me</Button>);
    expect(getByText('Press me')).toBeTruthy();
  });

  it('renders secondary variant correctly', () => {
    const { getByText } = render(<Button variant="secondary">Press me</Button>);
    expect(getByText('Press me')).toBeTruthy();
  });

  it('renders ghost variant correctly', () => {
    const { getByText } = render(<Button variant="ghost">Press me</Button>);
    expect(getByText('Press me')).toBeTruthy();
  });

  it('renders danger variant correctly', () => {
    const { getByText } = render(<Button variant="danger">Delete</Button>);
    expect(getByText('Delete')).toBeTruthy();
  });

  it('shows loading state', () => {
    const { getByTestId } = render(<Button loading>Loading</Button>);
    expect(getByTestId('button-loading')).toBeTruthy();
  });

  it('disables button when disabled prop is true', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button disabled onPress={onPress}>Press me</Button>
    );
    fireEvent.press(getByText('Press me'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button onPress={onPress}>Press me</Button>
    );
    fireEvent.press(getByText('Press me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
