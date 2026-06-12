import React from 'react';
import { render } from '@testing-library/react-native';
import { BlurredAreaPin } from '../mappin';

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
