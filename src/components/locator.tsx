'use client';

import { useEffect } from 'react';

export default function Locator() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      import('@locator/runtime').then((locator) => {
        locator.default();

        requestAnimationFrame(() => {
          const wrapper = document.getElementById('locatorjs-wrapper');
          if (wrapper?.shadowRoot) {
            const style = document.createElement('style');
            style.textContent =
              '[style*="pointer-events:auto"],[style*="pointer-events: auto"]{pointer-events:none!important}';
            wrapper.shadowRoot.prepend(style);
          }
        });
      });
    }
  }, []);

  return null;
}
