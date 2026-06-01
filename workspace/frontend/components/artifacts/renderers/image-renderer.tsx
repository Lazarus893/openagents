'use client';

import { useState } from 'react';
import { X, Maximize2 } from 'lucide-react';

interface ImageRendererProps {
  /** Inline data: URL or absolute http(s) URL. */
  src: string;
  alt?: string;
}

export function ImageRenderer({ src, alt = 'artifact image' }: ImageRendererProps) {
  const [zoom, setZoom] = useState(false);

  return (
    <>
      <div className="flex justify-center py-2">
        <button
          onClick={() => setZoom(true)}
          className="relative group inline-block max-w-full"
          title="Click to zoom"
        >
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-[600px] object-contain rounded-md border border-input shadow-sm"
          />
          <div className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity">
            <Maximize2 className="size-3.5 text-muted-foreground" />
          </div>
        </button>
      </div>
      {zoom && (
        <div
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-zoom-out"
        >
          <button
            onClick={() => setZoom(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="size-5 text-white" />
          </button>
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
