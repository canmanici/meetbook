import React from 'react';
import { render } from '@testing-library/react-native';
import { BlurredAreaPin, ExactPin } from '../mappin';

describe('BlurredAreaPin', () => {
  it('renders a soft circle', () => {
    const { getByTestId } = render(<BlurredAreaPin />);
    expect(getByTestId('blurred-area-pin')).toBeTruthy();
  });

  it('renders with a count badge when count is provided', () => {
    const { getByText, getByTestId } = render(<BlurredAreaPin count={3} />);
    expect(getByTestId('blurred-area-pin')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('does not render count badge when count is not provided', () => {
    const { queryByText } = render(<BlurredAreaPin />);
    expect(queryByText('3')).toBeNull();
  });
});

describe('ExactPin', () => {
  it('renders a teardrop marker by default', () => {
    const { getByTestId } = render(<ExactPin />);
    expect(getByTestId('exact-pin')).toBeTruthy();
  });

  it('renders with pending variant', () => {
    const { getByTestId } = render(<ExactPin variant="pending" testID="exact-pending" />);
    expect(getByTestId('exact-pending')).toBeTruthy();
  });

  it('renders inner white dot', () => {
    const { getByTestId } = render(<ExactPin />);
    expect(getByTestId('exact-pin-inner')).toBeTruthy();
  });
});
