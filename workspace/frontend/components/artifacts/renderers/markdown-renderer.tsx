'use client';

import { MarkdownContent } from '@/components/chat/markdown-content';

interface MarkdownRendererProps {
  content: string;
}

/** Markdown rendered via the same pipeline used in chat (react-markdown +
 *  remark-gfm + rehype-highlight). Reused as-is for zero new deps. */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="px-1 py-2 text-[14px]">
      <MarkdownContent content={content || ''} agentNames={[]} />
    </div>
  );
}
