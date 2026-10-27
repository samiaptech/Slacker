import { memo, type ReactElement } from "react";
import Image from "next/image";
import { FileText } from "lucide-react";
import type { MessageReactionEmoji } from "@workspace/types";
import {
  MessageActions,
  MessageAttachmentList,
  MessageDeliveryIndicator,
  MessageReactions,
  type MessageAttachment,
  type MessageDeliveryState,
  type MessageDeleteScope
} from "@/features/conversation-history/public";
import type { ChannelMessageView } from "../types";

type ChannelMessageAttachment = NonNullable<ChannelMessageView["attachments"]>[number];

type ChannelMessageItemProps = Readonly<{
  message: ChannelMessageView;
  deliveryState?: MessageDeliveryState | undefined;
  pendingFiles?: readonly File[] | undefined;
  retryDisabled?: boolean;
  onRetry: () => void;
  startsNewDay: boolean;
  isDownloadBusy: boolean;
  downloadingAttachmentId: string | null;
  canDeleteForEveryone: boolean;
  isDeleting: boolean;
  isReactionPending: boolean;
  currentUserId: string;
  currentUserName: string;
  onDownloadAttachment: (attachment: ChannelMessageAttachment) => void;
  loadImagePreview: (attachment: MessageAttachment, signal: AbortSignal) => Promise<string>;
  onDelete: (scope: MessageDeleteScope) => void;
  onToggleReaction: (emoji: MessageReactionEmoji) => void;
}>;

const formatMessageTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const formatMessageDay = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(value));

const getInitials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";

const formatFileSize = (size: number): string => size < 1024 * 1024
  ? `${Math.max(1, Math.round(size / 1024))} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

const ChannelMessageItemView = ({
  message,
  deliveryState,
  pendingFiles = [],
  retryDisabled = false,
  onRetry,
  startsNewDay,
  isDownloadBusy,
  downloadingAttachmentId,
  onDownloadAttachment,
  loadImagePreview,
  canDeleteForEveryone,
  isDeleting,
  isReactionPending,
  currentUserId,
  currentUserName,
  onDelete,
  onToggleReaction
}: ChannelMessageItemProps): ReactElement => (
  <>
    {startsNewDay ? (
      <li aria-label={formatMessageDay(message.createdAt)} className="flex items-center gap-3 py-1 text-[11px] font-medium text-[#8b9690]">
        <span aria-hidden="true" className="h-px flex-1 bg-[#e7e9e4]" />
        <time dateTime={message.createdAt}>{formatMessageDay(message.createdAt)}</time>
        <span aria-hidden="true" className="h-px flex-1 bg-[#e7e9e4]" />
      </li>
    ) : null}
    <li className="group flex items-start gap-3" data-message-id={message.id}>
      <div aria-hidden="true" className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {message.sender.image
          ? <Image alt="" className="object-cover" height={36} src={message.sender.image} unoptimized width={36} />
          : getInitials(message.sender.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground">{message.sender.name}</span>
          <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          <MessageDeliveryIndicator onRetry={onRetry} retryDisabled={retryDisabled} state={deliveryState} />
          {!deliveryState ? <MessageActions canDeleteForEveryone={canDeleteForEveryone} disabled={isDeleting} onDelete={onDelete} /> : null}
        </div>
        {message.text ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="w-fit max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{message.text}</p>
            {!deliveryState ? <MessageReactions currentUserId={currentUserId} currentUserName={currentUserName} isPending={isReactionPending} onToggle={onToggleReaction} reactions={message.reactions} /> : null}
          </div>
        ) : !deliveryState ? <div className="mt-1"><MessageReactions currentUserId={currentUserId} currentUserName={currentUserName} isPending={isReactionPending} onToggle={onToggleReaction} reactions={message.reactions} /></div> : null}
        {pendingFiles.length > 0 ? (
          <ul aria-label="Pending attachments" className="mt-3 flex flex-wrap gap-2">
            {pendingFiles.map((file, index) => (
              <li className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs" key={`${file.name}-${file.lastModified}-${index}`}>
                <FileText aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="max-w-56 truncate">{file.name}</span>
                <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {message.attachments?.length ? (
          <MessageAttachmentList
            attachments={message.attachments}
            downloadingAttachmentId={downloadingAttachmentId}
            isDownloadBusy={isDownloadBusy}
            loadImagePreview={loadImagePreview}
            onDownload={onDownloadAttachment}
          />
        ) : null}
      </div>
    </li>
  </>
);

export const ChannelMessageItem = memo(ChannelMessageItemView);
