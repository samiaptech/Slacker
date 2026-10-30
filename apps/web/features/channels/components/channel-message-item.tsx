import { memo, type ReactElement } from "react";
import { FileText, MessageCircle } from "lucide-react";
import { Button } from "@workspace/ui";
import { ChannelMessageText } from "./channel-message-text";
import { UserAvatar } from "@/features/identity/public";
import type { MessageReactionEmoji } from "@workspace/types";
import {
  MessageActions,
  MessageAttachmentList,
  MessageDeliveryIndicator,
  MessageInlineEditor,
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
  canEdit: boolean;
  isDeleting: boolean;
  isEditing: boolean;
  isSavingEdit: boolean;
  isReactionPending: boolean;
  currentUserId: string;
  currentUserName: string;
  mentionNames: ReadonlyMap<string, string>;
  editDraft: string;
  onDownloadAttachment: (attachment: ChannelMessageAttachment) => void;
  loadImagePreview: (attachment: MessageAttachment, signal: AbortSignal) => Promise<string>;
  onDelete: (scope: MessageDeleteScope) => void;
  onEdit: () => void;
  onEditChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggleReaction: (emoji: MessageReactionEmoji) => void;
  onOpenThread: () => void;
}>;

const formatMessageTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const formatMessageDay = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(value));

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
  canEdit,
  isDeleting,
  isEditing,
  isSavingEdit,
  isReactionPending,
  currentUserId,
  currentUserName,
  mentionNames,
  editDraft,
  onDelete,
  onEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
  onToggleReaction,
  onOpenThread
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
      <UserAvatar className="mt-0.5 size-9 shrink-0 bg-primary/10 text-xs font-semibold text-primary" image={message.sender.image} name={message.sender.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground">{message.sender.name}</span>
          <time className="text-xs text-muted-foreground" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          {message.editedAt ? <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Edited</span> : null}
          <MessageDeliveryIndicator onRetry={onRetry} retryDisabled={retryDisabled} state={deliveryState} />
          {!deliveryState ? (
            <MessageActions
              canDeleteForEveryone={canDeleteForEveryone}
              canEdit={canEdit}
              disabled={isDeleting || isEditing}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ) : null}
        </div>
        {isEditing ? (
          <MessageInlineEditor
            isSaving={isSavingEdit}
            onCancel={onCancelEdit}
            onChange={onEditChange}
            onSave={onSaveEdit}
            originalText={message.text}
            value={editDraft}
          />
        ) : message.text ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ChannelMessageText memberNames={mentionNames} text={message.text} />
            {!deliveryState ? <MessageReactions currentUserId={currentUserId} currentUserName={currentUserName} isPending={isReactionPending} onToggle={onToggleReaction} reactions={message.reactions} /> : null}
            {!deliveryState ? <ThreadButton count={message.thread?.replyCount ?? 0} onClick={onOpenThread} /> : null}
          </div>
        ) : !deliveryState ? <div className="mt-1 flex items-center gap-2"><MessageReactions currentUserId={currentUserId} currentUserName={currentUserName} isPending={isReactionPending} onToggle={onToggleReaction} reactions={message.reactions} /><ThreadButton count={message.thread?.replyCount ?? 0} onClick={onOpenThread} /></div> : null}
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

const ThreadButton = ({ count, onClick }: Readonly<{ count: number; onClick: () => void }>): ReactElement => (
  <Button aria-label={count ? `${count} replies. Reply in thread` : "Reply in thread"} className="h-6 gap-1 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground" onClick={onClick} size="sm" type="button" variant="ghost">
    <MessageCircle aria-hidden="true" className="size-3.5" />
    {count ? <span>{count}</span> : null}
  </Button>
);
