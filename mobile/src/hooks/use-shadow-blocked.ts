import { useCallback, useEffect, useState } from 'react';

import { getShadowBlocked } from '@/lib/shadow-block';

export function useShadowBlocked() {
  const [shadowBlocked, setShadowBlocked] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    getShadowBlocked().then((list) => {
      if (active) setShadowBlocked(list);
    });
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const list = await getShadowBlocked();
    setShadowBlocked(list);
  }, []);

  const isBlocked = useCallback(
    (userId: string | null | undefined) => !!userId && shadowBlocked.includes(userId),
    [shadowBlocked],
  );

  return { shadowBlocked, reload, isBlocked };
}
