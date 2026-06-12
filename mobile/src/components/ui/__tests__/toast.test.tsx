import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Toast, InlineError } from '../toast';

describe('Toast Component', () => {
  it('renders toast message', () => {
    const { getByText } = render(<Toast message="Success!" visible />);
    expect(getByText('Success!')).toBeTruthy();
  });

  it('renders toast with success variant', () => {
    const { getByText, getByTestId } = render(
      <Toast message="Operation successful" visible variant="success" testID="toast-success" />
    );
    expect(getByText('Operation successful')).toBeTruthy();
    expect(getByTestId('toast-success')).toBeTruthy();
  });

  it('renders toast with error variant', () => {
    const { getByText } = render(
      <Toast message="Operation failed" visible variant="error" />
    );
    expect(getByText('Operation failed')).toBeTruthy();
  });

  it('renders toast with info variant (default)', () => {
    const { getByText } = render(
      <Toast message="Information message" visible variant="info" />
    );
    expect(getByText('Information message')).toBeTruthy();
  });

  it('does not render toast when visible is false', () => {
    const { queryByText } = render(<Toast message="Should not appear" visible={false} />);
    expect(queryByText('Should not appear')).toBeNull();
  });

  it('renders inline error with human-friendly message', () => {
    const { getByText } = render(
      <InlineError message="Couldn't reach the server — pull to retry" />
    );
    expect(getByText("Couldn't reach the server — pull to retry")).toBeTruthy();
  });

  it('renders inline error with icon', () => {
    const { getByTestId } = render(
      <InlineError message="Error occurred" testID="inline-error-test" />
    );
    expect(getByTestId('inline-error-test')).toBeTruthy();
  });

  it('applies custom style to toast', () => {
    const { getByTestId } = render(
      <Toast message="Styled toast" visible testID="styled-toast" style={{ marginTop: 20 }} />
    );
    expect(getByTestId('styled-toast')).toBeTruthy();
  });

  it('applies custom style to inline error', () => {
    const { getByTestId } = render(
      <InlineError message="Styled error" testID="styled-error" style={{ marginBottom: 10 }} />
    );
    expect(getByTestId('styled-error')).toBeTruthy();
  });
});
