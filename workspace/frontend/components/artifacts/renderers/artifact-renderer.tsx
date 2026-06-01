'use client';

import type { ArtifactItem } from '@/lib/types';
import { MarkdownRenderer } from './markdown-renderer';
import { CodeRenderer } from './code-renderer';
import { HtmlRenderer } from './html-renderer';
import { SvgRenderer } from './svg-renderer';
import { MermaidRenderer } from './mermaid-renderer';
import { JsonRenderer } from './json-renderer';
import { ImageRenderer } from './image-renderer';
import { PdfRenderer } from './pdf-renderer';
import { AlertCircle } from 'lucide-react';

interface ArtifactRendererProps {
  artifact: ArtifactItem;
  /** Optional resolved blob URL for binary kinds (image / pdf). */
  blobUrl?: string;
}

/** Dispatches to the kind-specific renderer. Each renderer assumes
 *  `artifact.content` is the raw text for text kinds. For binary
 *  kinds (image / pdf) callers must resolve `blobUrl` from the
 *  storage_key separately. */
export function ArtifactRenderer({ artifact, blobUrl }: ArtifactRendererProps) {
  const content = artifact.content || '';
  const lang = (artifact.metadata?.language as string | undefined);

  switch (artifact.kind) {
    case 'markdown':
      return <MarkdownRenderer content={content} />;
    case 'code':
      return <CodeRenderer content={content} language={lang} />;
    case 'html':
      return <HtmlRenderer content={content} />;
    case 'svg':
      return <SvgRenderer content={content} />;
    case 'mermaid':
      return <MermaidRenderer content={content} />;
    case 'json':
      return <JsonRenderer content={content} />;
    case 'image': {
      const src = blobUrl || (content.startsWith('data:') || content.startsWith('http') ? content : '');
      if (!src) {
        return (
          <div className="text-center py-8 text-muted-foreground space-y-1">
            <AlertCircle className="size-6 mx-auto text-amber-500" />
            <p className="text-xs">Image content not available</p>
          </div>
        );
      }
      return <ImageRenderer src={src} alt={artifact.title} />;
    }
    case 'pdf': {
      const src = blobUrl || (content.startsWith('http') ? content : '');
      if (!src) {
        return (
          <div className="text-center py-8 text-muted-foreground space-y-1">
            <AlertCircle className="size-6 mx-auto text-amber-500" />
            <p className="text-xs">PDF source not available</p>
          </div>
        );
      }
      return <PdfRenderer src={src} />;
    }
    default:
      return (
        <pre className="my-2 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 overflow-x-auto text-[13px] font-mono">
          {content}
        </pre>
      );
  }
}
