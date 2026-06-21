import React from 'react';

import { Badge, type BadgeVariant } from './badge';
import type { components } from '@/lib/api/schema';

type TrustView = components['schemas']['TrustView'];

const BADGE_VARIANT: Record<string, BadgeVariant> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
};

interface TrustBadgeProps {
  trust?: TrustView | null;
  /** Show the borrow count alongside the score. */
  showBorrowCount?: boolean;
  testID?: string;
}

/**
 * Compact trust indicator the book owner sees before approving a loan:
 * coloured badge + 0-100 score + (optionally) how many books the user borrowed before.
 */
export const TrustBadge: React.FC<TrustBadgeProps> = ({
  trust,
  showBorrowCount = false,
  testID = 'trust-badge',
}) => {
  if (!trust) return null;
  const variant = BADGE_VARIANT[trust.badge] ?? 'primary';
  const borrow =
    showBorrowCount && trust.loans_borrowed_count != null
      ? ` · ${trust.loans_borrowed_count} ödünç`
      : '';
  return (
    <Badge
      variant={variant}
      text={`Güven ${trust.score} · ${trust.label}${borrow}`}
      testID={testID}
    />
  );
};
