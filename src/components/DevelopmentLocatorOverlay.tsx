"use client";

import { useEffect } from "react";

export default function DevelopmentLocatorOverlay() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "development" &&
      process.env.NEXT_PUBLIC_LOCATORJS === "1"
    ) {
      import("@locator/runtime").then((locator) => {
        locator.default();

        requestAnimationFrame(() => {
          const wrapper = document.getElementById("locatorjs-wrapper");
          if (wrapper?.shadowRoot) {
            const style = document.createElement("style");
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
