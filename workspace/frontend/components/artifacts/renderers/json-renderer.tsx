'use client';

import { useMemo } from 'react';
import { JsonView, defaultStyles, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { useTheme } from 'next-themes';

interface JsonRendererProps {
  content: string;
}

export function JsonRenderer({ content }: JsonRendererProps) {
  const { resolvedTheme } = useTheme();
  const styles = resolvedTheme === 'dark' ? darkStyles : defaultStyles;

  const parsed = useMemo(() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }, [content]);

  if (parsed === null) {
    return (
      <pre className="my-2 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 overflow-x-auto text-[13px] font-mono whitespace-pre-wrap">
        {content}
      </pre>
    );
  }

  return (
    <div className="rounded-md border border-input bg-card p-3 text-[13px] font-mono overflow-auto max-h-[600px]">
      <JsonView data={parsed} style={styles} shouldExpandNode={(level) => level < 2} />
    </div>
  );
}
