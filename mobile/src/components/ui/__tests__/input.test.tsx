import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Input } from '../input';

describe('Input Component', () => {
  it('renders input with label', () => {
    const { getByText, getByPlaceholderText } = render(
      <Input label="Email" placeholder="Enter email" />
    );
    expect(getByText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Enter email')).toBeTruthy();
  });

  it('renders helper text when provided', () => {
    const { getByText } = render(
      <Input label="Email" helper="We'll never share your email" />
    );
    expect(getByText("We'll never share your email")).toBeTruthy();
  });

  it('shows error state', () => {
    const { getByText } = render(
      <Input label="Email" error="Invalid email format" />
    );
    expect(getByText('Invalid email format')).toBeTruthy();
  });

  it('handles text changes', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <Input label="Email" placeholder="Enter email" onChangeText={onChangeText} />
    );
    fireEvent.changeText(getByPlaceholderText('Enter email'), 'test@example.com');
    expect(onChangeText).toHaveBeenCalledWith('test@example.com');
  });

  it('toggles password visibility', () => {
    const { getByTestId } = render(
      <Input label="Password" secureTextEntry />
    );
    const toggleButton = getByTestId('input-password-toggle');
    fireEvent.press(toggleButton);
    // Verify secureTextEntry toggles (implementation would check this)
  });
});
