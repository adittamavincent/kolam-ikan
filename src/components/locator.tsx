'use client';

import { useEffect } from 'react';

export default function Locator() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      import('@locator/runtime').then((locator) => {
        locator.default();
      });
    }
  }, []);

  return null;
}
