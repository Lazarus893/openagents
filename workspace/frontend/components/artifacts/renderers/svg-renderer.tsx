'use client';

import { useMemo } from 'react';
import DOMPurify from 'isomorphic-dompurify';

interface SvgRendererProps {
  content: string;
}

/** SVG is dompurified before insertion. Even though SVG is "just XML", it
 *  can host <script> + event handlers, so we sanitize aggressively. */
export function SvgRenderer({ content }: SvgRendererProps) {
  const safe = useMemo(() => {
    return DOMPurify.sanitize(content, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
  }, [content]);

  return (
    <div className="flex justify-center py-2">
      <div
        className="max-w-full max-h-[600px] overflow-auto"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </div>
  );
}
