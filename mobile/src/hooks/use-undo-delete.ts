import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';

interface ToastState {
  message: string;
  progress: number;
}

interface UndoDeleteConfig {
  undoWindowMs?: number;
}

interface PendingDelete<T> {
  item: T;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
}

export function useUndoDelete<T extends { id: string; title: string }>(
  config?: UndoDeleteConfig,
) {
  const undoWindowMs = config?.undoWindowMs ?? 5000;
  const pendingRef = useRef<Map<string, PendingDelete<T>>>(new Map());
  const [toast, setToast] = useState<ToastState | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCommitRef = useRef<((item: T) => Promise<void>) | null>(null);
  const onRollbackRef = useRef<((item: T) => void) | null>(null);

  const clearProgress = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const updateToast = useCallback(() => {
    const now = Date.now();
    let earliest = Infinity;
    pendingRef.current.forEach((pd) => {
      if (pd.startedAt < earliest) earliest = pd.startedAt;
    });
    if (earliest === Infinity) {
      setToast(null);
      return;
    }
    const elapsed = now - earliest;
    const pct = Math.min(100, Math.round((elapsed / undoWindowMs) * 100));
    const count = pendingRef.current.size;
    setToast({
      message: count === 1
        ? `"${Array.from(pendingRef.current.values())[0].item.title}" silindi`
        : `${count} kitap silindi`,
      progress: pct,
    });
  }, [undoWindowMs]);

  const startProgressPoll = useCallback(() => {
    clearProgress();
    progressIntervalRef.current = setInterval(updateToast, 100);
  }, [clearProgress, updateToast]);

  const setCallbacks = useCallback(
    (onCommit: (item: T) => Promise<void>, onRollback: (item: T) => void) => {
      onCommitRef.current = onCommit;
      onRollbackRef.current = onRollback;
    },
    [],
  );

  const deleteItem = useCallback(
    (item: T) => {
      if (pendingRef.current.has(item.id)) return;

      const timer = setTimeout(async () => {
        pendingRef.current.delete(item.id);
        if (pendingRef.current.size === 0) {
          clearProgress();
          setToast(null);
        } else {
          updateToast();
        }
        try {
          await onCommitRef.current?.(item);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } catch {
          onRollbackRef.current?.(item);
          setToast({ message: `"${item.title}" silinemedi`, progress: 100 });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }, undoWindowMs);

      pendingRef.current.set(item.id, { item, timer, startedAt: Date.now() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      startProgressPoll();
      updateToast();
    },
    [undoWindowMs, clearProgress, startProgressPoll, updateToast],
  );

  const undoItem = useCallback(
    (itemId: string) => {
      const pending = pendingRef.current.get(itemId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current.delete(itemId);
      onRollbackRef.current?.(pending.item);
      if (pendingRef.current.size === 0) {
        clearProgress();
        setToast(null);
      } else {
        updateToast();
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [clearProgress, updateToast],
  );

  const undoAll = useCallback(() => {
    pendingRef.current.forEach((pd) => {
      clearTimeout(pd.timer);
      onRollbackRef.current?.(pd.item);
    });
    pendingRef.current.clear();
    clearProgress();
    setToast(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [clearProgress]);

  const flushPending = useCallback(() => {
    pendingRef.current.forEach((pd) => {
      clearTimeout(pd.timer);
      onCommitRef.current?.(pd.item).catch(() => {});
    });
    pendingRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      flushPending();
      clearProgress();
    };
  }, [flushPending, clearProgress]);

  return {
    deleteItem,
    undoItem,
    undoAll,
    setCallbacks,
    toast,
  };
}
