'use client';

import { MarkdownContent } from '@/components/chat/markdown-content';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface CodeRendererProps {
  content: string;
  language?: string;
}

/** Renders a code blob through the existing markdown code-fence path so we
 *  inherit rehype-highlight / styling without writing a new highlighter. */
export function CodeRenderer({ content, language }: CodeRendererProps) {
  const [copied, setCopied] = useState(false);
  const lang = (language || '').toLowerCase();
  // Wrap in a fenced code block so rehype-highlight handles syntax coloring
  const md = `\`\`\`${lang}\n${content}\n\`\`\``;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/80 backdrop-blur border border-input opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        title="Copy"
      >
        {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      </button>
      {lang && (
        <div className="absolute top-2 left-3 z-10 text-[10px] uppercase tracking-wide text-muted-foreground/70 font-mono">
          {lang}
        </div>
      )}
      <MarkdownContent content={md} agentNames={[]} />
    </div>
  );
}
