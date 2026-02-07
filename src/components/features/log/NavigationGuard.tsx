'use client';

import { useEffect } from 'react';

export function NavigationGuard() {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Intercept navigation - this part is tricky in Next.js App Router
  // We can't easily intercept all navigations. 
  // For now, we rely on beforeunload for browser navigation/close.
  // In-app navigation interception requires more complex setup or context.
  
  return null;
}
