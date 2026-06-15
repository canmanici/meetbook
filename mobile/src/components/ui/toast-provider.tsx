import React, { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { AnimatedToast, type AnimatedToastHandle } from './animated-toast';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  variant?: ToastVariant;
  duration?: number;
  /** Override the default icon name */
  iconName?: string;
  /** Callback when toast is dismissed */
  onDismiss?: () => void;
}

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
  iconName?: string;
  onDismiss?: () => void;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastRef = useRef<AnimatedToastHandle>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setToast(null);
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = ++nextId;
      const variant = options?.variant ?? 'info';
      const duration = options?.duration ?? 3500;

      // If there's a current toast, immediately replace it
      if (toastRef.current) {
        toastRef.current.dismiss();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setToast({ id, message, variant, duration, iconName: options?.iconName, onDismiss: options?.onDismiss });

      // Auto-dismiss
      timeoutRef.current = setTimeout(() => {
        hide();
        options?.onDismiss?.();
      }, duration);
    },
    [hide],
  );

  const contextValue = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toast && (
        <AnimatedToast
          key={toast.id}
          ref={toastRef}
          message={toast.message}
          variant={toast.variant}
          duration={toast.duration}
          iconName={toast.iconName}
          onDismiss={() => {
            hide();
            toast.onDismiss?.();
          }}
        />
      )}
    </ToastContext.Provider>
  );
}
