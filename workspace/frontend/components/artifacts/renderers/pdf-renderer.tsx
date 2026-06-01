'use client';

interface PdfRendererProps {
  src: string;
}

export function PdfRenderer({ src }: PdfRendererProps) {
  return (
    <div className="rounded-md border border-input overflow-hidden bg-white">
      <iframe
        src={src}
        className="w-full"
        style={{ height: '700px' }}
        title="PDF preview"
      />
    </div>
  );
}
