"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import Image from "next/image";
import { Download, FileText, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui";

export type MessageAttachment = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
}>;

type MessageAttachmentListProps = Readonly<{
  attachments: readonly MessageAttachment[];
  downloadingAttachmentId: string | null;
  isDownloadBusy: boolean;
  onDownload: (attachment: MessageAttachment) => void;
  loadImagePreview: (attachment: MessageAttachment, signal: AbortSignal) => Promise<string>;
}>;

const formatFileSize = (size: number): string => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const ImageAttachment = ({
  attachment,
  loadPreview
}: Readonly<{
  attachment: MessageAttachment;
  loadPreview: MessageAttachmentListProps["loadImagePreview"];
}>): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(() => typeof window === "undefined" || !("IntersectionObserver" in window));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "180px" });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void loadPreview(attachment, controller.signal).then((url) => {
      if (controller.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setPreviewUrl(url);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, isVisible, loadPreview, retry]);

  return (
    <>
      <div className="w-fit max-w-full" ref={containerRef}>
        {previewUrl ? (
          <button
            aria-label={`Open image ${attachment.name} full screen`}
            className="block max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-muted/40 p-1 transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setIsOpen(true)}
            type="button"
          >
            <Image alt={attachment.name} className="max-h-[min(55vh,26rem)] max-w-full rounded-lg object-contain" height={720} src={previewUrl} unoptimized width={960} />
          </button>
        ) : (
          <div className="flex min-h-32 w-64 max-w-full items-center justify-center rounded-xl border border-border bg-muted/40 p-4">
            {!error ? <LoaderCircle aria-label="Loading image preview" className="size-5 animate-spin text-muted-foreground" /> : null}
            {error ? (
              <Button className="gap-2" onClick={() => { setError(false); setRetry((current) => current + 1); }} type="button" variant="outline">
                <ImageIcon aria-hidden="true" className="size-4" /> Retry image preview
              </Button>
            ) : null}
          </div>
        )}
        <p className="mt-1 truncate text-xs text-muted-foreground">{attachment.name} · {formatFileSize(attachment.size)}</p>
      </div>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogContent className="flex h-[92dvh] w-[96vw] max-w-[96vw] items-center justify-center border-0 bg-black/95 p-3 text-white shadow-2xl sm:rounded-xl">
          <DialogTitle className="sr-only">{attachment.name}</DialogTitle>
          <DialogDescription className="sr-only">Full-screen image preview. Press Escape to close.</DialogDescription>
          {previewUrl ? <Image alt={attachment.name} className="max-h-full max-w-full object-contain" height={1440} src={previewUrl} unoptimized width={1920} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

export const MessageAttachmentList = ({
  attachments,
  downloadingAttachmentId,
  isDownloadBusy,
  onDownload,
  loadImagePreview
}: MessageAttachmentListProps): ReactElement => (
  <ul aria-label="Message attachments" className="mt-3 flex flex-wrap items-start gap-3">
    {attachments.map((attachment) => (
      <li className="max-w-full" key={attachment.id}>
        {attachment.mimeType.startsWith("image/") ? (
          <ImageAttachment attachment={attachment} loadPreview={loadImagePreview} />
        ) : (
          <Button className="h-auto max-w-full justify-start gap-2 px-3 py-2 text-left" disabled={isDownloadBusy} onClick={() => onDownload(attachment)} type="button" variant="outline">
            {downloadingAttachmentId === attachment.id
              ? <Download aria-hidden="true" className="size-4 animate-pulse" />
              : <FileText aria-hidden="true" className="size-4 shrink-0" />}
            <span className="min-w-0"><span className="block max-w-56 truncate text-xs">{attachment.name}</span><span className="block text-[10px] text-muted-foreground">{formatFileSize(attachment.size)}</span></span>
            <Download aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        )}
      </li>
    ))}
  </ul>
);
