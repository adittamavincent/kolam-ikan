'use client';

import { useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';

interface ResponseParserProps {
  streamId?: string;
  interactionMode?: string;
}

export function ResponseParser({ 
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  streamId: _streamId, 
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interactionMode: _interactionMode 
}: ResponseParserProps) {
  const [pastedXML, setPastedXML] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const parseResponse = async () => {
    try {
      setParseError(null);
      // 1. Sanitize
      const sanitized = DOMPurify.sanitize(pastedXML);

      // 2. Parse XML
      const parser = new DOMParser();
      const doc = parser.parseFromString(sanitized, 'text/xml');

      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        throw new Error('Invalid XML format');
      }

      // TODO: Implement actual logic to extract and apply changes
      // This is a placeholder for the parsing logic
      console.log('Parsed XML:', doc);

    } catch (err) {
      setParseError((err as Error).message);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Paste Response XML
        </label>
        <textarea
          value={pastedXML}
          onChange={(e) => setPastedXML(e.target.value)}
          className="w-full rounded border border-gray-300 p-3"
          rows={6}
          placeholder="<response>...</response>"
        />
      </div>

      {parseError && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-600">
          Error: {parseError}
        </div>
      )}

      <button
        onClick={parseResponse}
        className="rounded bg-primary-600 px-4 py-2 text-white hover:bg-primary-700"
      >
        Parse & Apply
      </button>
    </div>
  );
}
