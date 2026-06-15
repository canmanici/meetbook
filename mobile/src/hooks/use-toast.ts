import { useCallback, useContext } from 'react';
import { ToastContext, type ToastOptions } from '@/components/ui/toast-provider';

/**
 * useToast — fire extreme toasts from anywhere in the app.
 *
 * @example
 * ```tsx
 * const toast = useToast();
 * toast.show('Takas isteği gönderildi!', { variant: 'success', duration: 4000 });
 * ```
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      context.show(message, options);
    },
    [context],
  );

  return { show };
}
