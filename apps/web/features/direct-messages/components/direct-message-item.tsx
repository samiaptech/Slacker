import { memo, type ReactElement } from "react";
import Image from "next/image";
import { Download, FileText } from "lucide-react";
import { Button } from "@workspace/ui";
import type { DirectMessageView } from "../types";

type DirectMessageAttachment = NonNullable<DirectMessageView["attachments"]>[number];

type DirectMessageItemProps = Readonly<{
  message: DirectMessageView;
  startsNewDay: boolean;
  isDownloadBusy: boolean;
  downloadingAttachmentId: string | null;
  onDownloadAttachment: (attachment: DirectMessageAttachment) => void;
}>;

const formatMessageTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(value));

const formatMessageDay = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(value));

const getInitials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";

const formatFileSize = (size: number): string => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const DirectMessageItemView = ({
  message,
  startsNewDay,
  isDownloadBusy,
  downloadingAttachmentId,
  onDownloadAttachment
}: DirectMessageItemProps): ReactElement => (
  <>
    {startsNewDay ? (
      <li aria-label={formatMessageDay(message.createdAt)} className="flex items-center gap-3 py-1 text-[11px] font-medium text-[#8b9690]">
        <span aria-hidden="true" className="h-px flex-1 bg-[#e7e9e4]" />
        <time dateTime={message.createdAt}>{formatMessageDay(message.createdAt)}</time>
        <span aria-hidden="true" className="h-px flex-1 bg-[#e7e9e4]" />
      </li>
    ) : null}
    <li className="flex items-start gap-3" data-message-id={message.id}>
      <span aria-hidden="true" className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {message.sender.image
          ? <Image alt="" className="object-cover" height={36} src={message.sender.image} unoptimized width={36} />
          : getInitials(message.sender.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground">{message.sender.name}</span>
          <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{message.text}</p>
        {message.attachments?.length ? (
          <ul aria-label="Message attachments" className="mt-3 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => (
              <li key={attachment.id}>
                <Button className="h-auto max-w-full justify-start gap-2 px-3 py-2 text-left" disabled={isDownloadBusy} onClick={() => onDownloadAttachment(attachment)} type="button" variant="outline">
                  {downloadingAttachmentId === attachment.id
                    ? <Download aria-hidden="true" className="size-4 animate-pulse" />
                    : <FileText aria-hidden="true" className="size-4 shrink-0" />}
                  <span className="min-w-0"><span className="block max-w-56 truncate text-xs">{attachment.name}</span><span className="block text-[10px] text-muted-foreground">{formatFileSize(attachment.size)}</span></span>
                  <Download aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  </>
);

export const DirectMessageItem = memo(DirectMessageItemView);
