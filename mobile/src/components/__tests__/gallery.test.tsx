import React from 'react';
import { render } from '@testing-library/react-native';
import ComponentGallery from '@/app/__gallery';

describe('Component Gallery', () => {
  it('renders all UI components', () => {
    const { getByTestId } = render(<ComponentGallery />);

    // Check all major component sections are rendered
    expect(getByTestId('gallery-button')).toBeTruthy();
    expect(getByTestId('gallery-input')).toBeTruthy();
    expect(getByTestId('gallery-card')).toBeTruthy();
    expect(getByTestId('gallery-avatar')).toBeTruthy();
    expect(getByTestId('gallery-badge')).toBeTruthy();
    expect(getByTestId('gallery-sheet')).toBeTruthy();
    expect(getByTestId('gallery-emptystate')).toBeTruthy();
    expect(getByTestId('gallery-skeleton')).toBeTruthy();
    expect(getByTestId('gallery-toast')).toBeTruthy();
  });
});
