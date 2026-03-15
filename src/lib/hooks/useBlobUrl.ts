import { useState, useEffect } from "react";

export function useBlobUrl(file: File | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      const timer = setTimeout(() => setUrl(undefined), 0);
      return () => clearTimeout(timer);
    }

    const objectUrl = URL.createObjectURL(file);
    const timer = setTimeout(() => setUrl(objectUrl), 0);

    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return url;
}
