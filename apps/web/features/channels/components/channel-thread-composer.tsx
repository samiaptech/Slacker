"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { AtSign, FileText, Paperclip, Send } from "lucide-react";
import { Button, Textarea } from "@workspace/ui";
import type { ChannelMentionMemberResponse } from "@workspace/types";
import { ChannelMentionSuggestions } from "./channel-mention-suggestions";
import { useChannelMentions } from "./use-channel-mentions";

const ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.md";
const SIZE_LIMIT = 10 * 1024 * 1024;
type Props = Readonly<{
  canSend: boolean;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  apiBaseUrl: string;
  workspaceId: string;
  channelId: string;
  onMembersChange: (members: readonly ChannelMentionMemberResponse[]) => void;
  onSend: (text: string, files: readonly File[]) => Promise<boolean>;
}>;
const sizeLabel = (size: number): string => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const ignoreTyping = (): void => {};

export const ChannelThreadComposer = ({ canSend, isLoading, isSending, error, apiBaseUrl, workspaceId, channelId, onMembersChange, onSend }: Props): ReactElement => {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useChannelMentions({ apiBaseUrl, workspaceId, channelId, value: draft, onValueChange: setDraft, onTyping: ignoreTyping, textareaRef });
  useEffect(() => onMembersChange(mentions.members), [mentions.members, onMembersChange]);
  const chooseFiles = (incoming: FileList | null): void => {
    const selected = Array.from(incoming ?? []);
    if (!selected.length) return;
    if (files.length + selected.length > 5) return setFileError("Choose up to 5 files per reply.");
    const invalid = selected.find((file) => file.size > SIZE_LIMIT || !ACCEPT.split(",").some((ext) => file.name.toLowerCase().endsWith(ext)));
    if (invalid) return setFileError(invalid.size > SIZE_LIMIT ? `${invalid.name} is larger than 10 MB.` : `${invalid.name} is not a supported file type.`);
    setFileError(null);
    setFiles((current) => [...current, ...selected]);
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if ((!draft.trim() && files.length === 0) || isSending || isLoading) return;
    void onSend(draft.trim(), files).then((sent) => {
      if (sent) { setDraft(""); setFiles([]); }
    });
  };

  return <form className="shrink-0 border-t border-[#ecebe5] bg-white p-2" onSubmit={submit}>
    {canSend ? <><input accept={ACCEPT} className="hidden" id="thread-reply-files" multiple onChange={(event) => { chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} type="file" />
      {files.length ? <ul aria-label="Files to attach" className="mb-2 flex flex-wrap gap-2">{files.map((file, index) => <li className="flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px]" key={`${file.name}-${file.lastModified}-${index}`}><FileText aria-hidden="true" className="size-3.5 shrink-0" /><span className="max-w-36 truncate">{file.name}</span><span>{sizeLabel(file.size)}</span><button aria-label={`Remove ${file.name}`} className="ml-1 text-muted-foreground" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">×</button></li>)}</ul> : null}
      {error || fileError ? <p className="mb-2 text-xs text-destructive" role="alert">{error ?? fileError}</p> : null}
      <label className="sr-only" htmlFor="thread-reply-draft">Reply to thread</label><div className="flex items-end gap-1.5 rounded-xl border border-input bg-background p-1.5"><Button aria-label="Attach files, up to five files" className="size-8" disabled={isSending || isLoading} onClick={() => document.getElementById("thread-reply-files")?.click()} size="icon" type="button" variant="ghost"><Paperclip aria-hidden="true" className="size-4" /></Button><Button aria-label="Mention a channel member" className="size-8" disabled={isSending || isLoading} onClick={mentions.open} onMouseDown={(event) => event.preventDefault()} size="icon" title="Mention a member" type="button" variant="ghost"><AtSign aria-hidden="true" className="size-4" /></Button><div className="relative min-w-0 flex-1">{mentions.range ? <ChannelMentionSuggestions activeIndex={mentions.activeIndex} members={mentions.suggestions} onRetry={mentions.reload} onSelect={mentions.selectMember} status={mentions.status} /> : null}<Textarea aria-activedescendant={mentions.range && mentions.suggestions.length > 0 ? `channel-mention-option-${mentions.activeIndex}` : undefined} aria-autocomplete="list" aria-controls={mentions.range ? "channel-mention-options" : undefined} aria-expanded={Boolean(mentions.range)} className="max-h-32 min-h-9 resize-none border-0 px-1 py-1 shadow-none focus-visible:ring-0" disabled={isSending || isLoading} id="thread-reply-draft" maxLength={4_000} onBlur={mentions.close} onChange={(event) => { if (Array.from(event.currentTarget.value).length <= 4_000) mentions.onChange(event); }} onClick={mentions.updateCaret} onKeyDown={(event) => mentions.onKeyDown(event, (keyEvent) => { if (keyEvent.key === "Enter" && !keyEvent.shiftKey && !keyEvent.nativeEvent.isComposing) { keyEvent.preventDefault(); keyEvent.currentTarget.form?.requestSubmit(); } })} onKeyUp={mentions.updateCaret} placeholder="Reply in thread…" ref={textareaRef} rows={1} value={mentions.displayValue} /></div><Button aria-label="Send reply" className="size-8 shrink-0" disabled={(!draft.trim() && files.length === 0) || isSending || isLoading} size="icon" type="submit"><Send aria-hidden="true" className="size-4" /></Button></div>
    </> : <p className="text-center text-xs text-muted-foreground">This channel is read-only.</p>}
  </form>;
};
