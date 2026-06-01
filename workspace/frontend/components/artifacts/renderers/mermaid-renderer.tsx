'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface MermaidRendererProps {
  content: string;
}

/** Mermaid is loaded dynamically so the artifacts surface only pays the
 *  ~700kb cost when actually opened. */
export function MermaidRenderer({ content }: MermaidRendererProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const mermaidMod = await import('mermaid');
        const mermaid = mermaidMod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, content);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [content]);

  return (
    <div className="rounded-md border border-input bg-white dark:bg-zinc-900 p-4 min-h-[120px] flex items-center justify-center overflow-auto">
      {loading && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="text-center space-y-2 text-muted-foreground">
          <AlertCircle className="size-6 mx-auto text-amber-500" />
          <p className="text-xs">{error}</p>
          <pre className="text-[10px] text-left bg-muted p-2 rounded max-w-md overflow-auto">{content}</pre>
        </div>
      )}
      <div ref={ref} className="max-w-full" />
    </div>
  );
}
