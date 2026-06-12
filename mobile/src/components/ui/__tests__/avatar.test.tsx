import React from 'react';
import { render } from '@testing-library/react-native';
import { Avatar } from '../avatar';

describe('Avatar Component', () => {
  it('renders avatar with name initials', () => {
    const { getByText } = render(<Avatar name="John Doe" size="medium" />);
    expect(getByText('JD')).toBeTruthy();
  });

  it('renders avatar with image URL', () => {
    const { getByTestId } = render(
      <Avatar imageUrl="https://example.com/avatar.jpg" name="John Doe" size="medium" />
    );
    expect(getByTestId('avatar-image')).toBeTruthy();
  });

  it('shows verification badge when verified', () => {
    const { getByTestId } = render(
      <Avatar name="John Doe" size="medium" verified />
    );
    expect(getByTestId('verification-badge')).toBeTruthy();
  });
});
