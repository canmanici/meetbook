import React from 'react';
import QRCode from 'react-native-qrcode-svg';

export const QR_SIZE = 200;

interface QRProps {
  value: string;
  size?: number;
}

/**
 * Renders a QR code SVG component.
 * Wraps react-native-qrcode-svg for consistent sizing and styling.
 * The QR is always black-on-white regardless of theme for scanner readability.
 */
export function QRCodeView({ value, size = QR_SIZE }: QRProps) {
  return (
    <QRCode
      value={value}
      size={size}
      color="#2A2722"
      backgroundColor="#FFFFFF"
      quietZone={8}
    />
  );
}

/**
 * Builds the universal link for a book QR share.
 */
export function bookDeepLink(bookId: string): string {
  return `https://meetbook.app/book/${bookId}`;
}
