import React from 'react';
import { render } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { Sheet } from '../sheet';

describe('Sheet Component', () => {
  it('renders sheet when visible', () => {
    const { getByTestId } = render(
      <Sheet visible onClose={jest.fn()}>
        <Text>Sheet content</Text>
      </Sheet>
    );
    expect(getByTestId('sheet-container')).toBeTruthy();
  });

  it('calls onClose when close button pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <Sheet visible onClose={onClose}>
        <Text>Content</Text>
      </Sheet>
    );

    const closeButton = getByTestId('close-button');
    // Simulate press using the element's props
    if (closeButton && 'props' in closeButton) {
      const onPress = closeButton.props.onPress;
      if (onPress) {
        onPress();
      }
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render sheet when not visible', () => {
    const { queryByTestId } = render(
      <Sheet visible={false} onClose={jest.fn()}>
        <Text>Sheet content</Text>
      </Sheet>
    );
    expect(queryByTestId('sheet-container')).toBeNull();
  });

  it('renders title when provided', () => {
    const { getByText } = render(
      <Sheet visible onClose={jest.fn()} title="Test Title">
        <Text>Content</Text>
      </Sheet>
    );
    expect(getByText('Test Title')).toBeTruthy();
  });

  it('renders children content', () => {
    const { getByText } = render(
      <Sheet visible onClose={jest.fn()}>
        <Text>Custom content</Text>
      </Sheet>
    );
    expect(getByText('Custom content')).toBeTruthy();
  });
});
