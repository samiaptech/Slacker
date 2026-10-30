import type { ReactElement } from "react";
import type { ChannelMessageResponse } from "@workspace/types";
import { MessageActions, MessageAttachmentList, MessageDeliveryIndicator, MessageInlineEditor, MessageReactions, type MessageAttachment, type MessageDeleteScope, type MessageDeliveryState } from "@/features/conversation-history/public";
import { ChannelMessageText } from "./channel-message-text";

type Props = Readonly<{
  message: ChannelMessageResponse;
  deliveryState?: MessageDeliveryState;
  pendingFiles?: readonly File[];
  memberNames: ReadonlyMap<string, string>;
  retryDisabled?: boolean;
  onRetry?: () => void;
  isRoot?: boolean;
  downloadingAttachmentId: string | null;
  isDownloadBusy: boolean;
  onDownload: (attachment: MessageAttachment) => void;
  loadImagePreview: (attachment: MessageAttachment, signal: AbortSignal) => Promise<string>;
  currentUserId: string;
  currentUserName: string;
  canDeleteForEveryone: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isReactionPending: boolean;
  editDraft: string;
  onEdit: () => void;
  onEditChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: (scope: MessageDeleteScope) => void;
  onToggleReaction: (emoji: import("@workspace/types").MessageReactionEmoji) => void;
}>;

const timeLabel = (value: string): string => new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export const ChannelThreadMessage = ({ message, deliveryState, pendingFiles = [], memberNames, retryDisabled = false, onRetry = () => {}, isRoot = false, downloadingAttachmentId, isDownloadBusy, onDownload, loadImagePreview, currentUserId, currentUserName, canDeleteForEveryone, isEditing, isSaving, isDeleting, isReactionPending, editDraft, onEdit, onEditChange, onCancelEdit, onSaveEdit, onDelete, onToggleReaction }: Props): ReactElement => (
  <article className={`rounded-lg ${isRoot ? "border border-[#e8eee7] bg-[#f6f8f4] p-2.5" : "px-1 py-0.5"}`} data-message-id={message.id}>
    <div className="flex flex-wrap items-center gap-x-2"><span className="text-sm font-semibold text-[#293a32]">{message.sender.name}</span><time className="text-[11px] text-muted-foreground" dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>{message.editedAt ? <span className="text-[10px] text-muted-foreground">Edited</span> : null}<MessageDeliveryIndicator onRetry={onRetry} retryDisabled={retryDisabled} state={deliveryState} />{!deliveryState ? <MessageActions canDeleteForEveryone={canDeleteForEveryone} canEdit={Boolean(message.text) && message.senderId === currentUserId} disabled={isDeleting || isEditing} onDelete={onDelete} onEdit={onEdit} /> : null}</div>
    {isEditing ? <MessageInlineEditor isSaving={isSaving} onCancel={onCancelEdit} onChange={onEditChange} onSave={onSaveEdit} originalText={message.text} value={editDraft} /> : message.text ? <div className="mt-1"><ChannelMessageText memberNames={memberNames} text={message.text} /></div> : null}
    {pendingFiles.length ? <ul aria-label="Pending attachments" className="mt-2 space-y-1">{pendingFiles.map((file, index) => <li className="truncate rounded-md bg-white px-2 py-1 text-xs text-muted-foreground" key={`${file.name}-${file.lastModified}-${index}`}>{file.name}</li>)}</ul> : null}
    {message.attachments?.length ? <MessageAttachmentList attachments={message.attachments} downloadingAttachmentId={downloadingAttachmentId} isDownloadBusy={isDownloadBusy} loadImagePreview={loadImagePreview} onDownload={onDownload} /> : null}
    {!isEditing && !deliveryState ? <div className="mt-1"><MessageReactions currentUserId={currentUserId} currentUserName={currentUserName} isPending={isReactionPending} onToggle={onToggleReaction} reactions={message.reactions} /></div> : null}
  </article>
);
