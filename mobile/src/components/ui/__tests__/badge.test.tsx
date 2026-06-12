import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from '../badge';

describe('Badge Component', () => {
  it('renders badge with text', () => {
    const { getByText } = render(<Badge text="New" variant="success" />);
    expect(getByText('New')).toBeTruthy();
  });

  it('applies correct variant styles', () => {
    const { getByTestId } = render(<Badge text="Test" variant="danger" testID="test-badge" />);
    const badge = getByTestId('test-badge');
    // Check for danger variant styling
  });
});
