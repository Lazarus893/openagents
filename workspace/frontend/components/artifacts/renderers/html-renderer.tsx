'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';

interface HtmlRendererProps {
  content: string;
}

/** HTML rendered in a sandboxed iframe with DOMPurified content. The
 *  sandbox attribute restricts what scripts can do (no top-navigation,
 *  no parent access). */
export function HtmlRenderer({ content }: HtmlRendererProps) {
  const [height, setHeight] = useState(400);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const safe = useMemo(() => {
    // Allow most HTML/CSS/JS in artifacts but strip dangerous global handlers.
    return DOMPurify.sanitize(content, {
      WHOLE_DOCUMENT: true,
      ADD_TAGS: ['style', 'script'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|data):|#|\/)/i,
    });
  }, [content]);

  // Auto-resize iframe to its content height
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const h = Math.min(doc.documentElement.scrollHeight + 24, 800);
          setHeight(Math.max(h, 200));
        }
      } catch {
        // cross-origin (unlikely with srcDoc but defensive)
      }
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [safe]);

  return (
    <div className="rounded-md border border-input bg-white overflow-hidden">
      <iframe
        ref={iframeRef}
        srcDoc={safe}
        sandbox="allow-scripts allow-same-origin"
        className="w-full block"
        style={{ height: `${height}px` }}
        title="Artifact preview"
      />
    </div>
  );
}
