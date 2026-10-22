import { useState, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Hash, MessageCircle, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from "@workspace/ui";
import { notifyMessageSearchTarget, saveMessageSearchTarget, SearchMessageResults, useMessageSearch } from "@/features/message-search/public";
import type { MessageSearchResponseView } from "@/features/message-search/public";
import type { WorkspaceMembersView } from "@/features/identity/public";
import type { DirectConversationView } from "@/features/direct-messages/public";
import type { ChannelResponseView } from "../types";

type WorkspaceSearchDialogProps = Readonly<{
  open: boolean;
  apiBaseUrl: string;
  workspaceId: string;
  channels: readonly ChannelResponseView[];
  conversations: readonly DirectConversationView[];
  members: WorkspaceMembersView["members"];
  onOpenChange: (open: boolean) => void;
}>;

export const WorkspaceSearchDialog = ({
  open,
  apiBaseUrl,
  workspaceId,
  channels,
  conversations,
  members,
  onOpenChange
}: WorkspaceSearchDialogProps): ReactElement => {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const messageSearch = useMessageSearch({
    apiBaseUrl,
    workspaceId,
    open,
    query
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingChannels = normalizedQuery
    ? channels.filter((channel) => channel.name.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 6)
    : [];
  const matchingConversations = normalizedQuery
    ? conversations.filter((conversation) => conversation.otherParticipant.name.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 6)
    : [];
  const matchingMembers = normalizedQuery
    ? members.filter((member) => `${member.name ?? ""} ${member.email ?? ""} ${member.title ?? ""}`.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 6)
    : [];
  const hasResults = matchingChannels.length + matchingConversations.length + matchingMembers.length > 0;
  const selectMessage = (result: MessageSearchResponseView["results"][number]): void => {
    saveMessageSearchTarget({
      type: result.conversation.type,
      conversationId: result.conversation.id,
      messageId: result.id
    });
    onOpenChange(false);
    const path = result.conversation.type === "channel"
      ? `/channels/${encodeURIComponent(result.conversation.id)}`
      : `/messages/${encodeURIComponent(result.conversation.id)}`;
    const target = new URLSearchParams({ message: result.id });
    router.push(`${path}?${target.toString()}` as Route);
    window.setTimeout(notifyMessageSearchTarget, 100);
  };

  return (
    <Dialog onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        setQuery("");
        messageSearch.reset();
      }
      onOpenChange(nextOpen);
    }} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Search workspace</DialogTitle>
          <DialogDescription>Find messages, channels, conversations, or teammates in this workspace.</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search messages, channels, conversations, and teammates"
          autoFocus
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            messageSearch.reset();
          }}
          placeholder="Search messages or people…"
          value={query}
        />
        <div aria-live="polite" className="max-h-[55vh] min-h-24 space-y-4 overflow-y-auto">
          {!normalizedQuery ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Search your accessible messages and workspace people without changing the sidebar.</p>
          ) : (
            <>
              {matchingChannels.length > 0 ? (
                <section aria-label="Matching channels">
                  <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</h3>
                  {matchingChannels.map((channel) => (
                    <Link className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-accent" href={`/channels/${encodeURIComponent(channel.id)}` as Route} key={channel.id} onClick={() => onOpenChange(false)}>
                      <Hash aria-hidden="true" className="size-4 text-muted-foreground" />
                      <span className="truncate">{channel.name}</span>
                    </Link>
                  ))}
                </section>
              ) : null}
              {matchingConversations.length > 0 ? (
                <section aria-label="Matching conversations">
                  <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Direct messages</h3>
                  {matchingConversations.map((conversation) => (
                    <Link className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-accent" href={`/messages/${encodeURIComponent(conversation.id)}` as Route} key={conversation.id} onClick={() => onOpenChange(false)}>
                      <MessageCircle aria-hidden="true" className="size-4 text-muted-foreground" />
                      <span className="truncate">{conversation.otherParticipant.name}</span>
                    </Link>
                  ))}
                </section>
              ) : null}
              {matchingMembers.length > 0 ? (
                <section aria-label="Matching teammates">
                  <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">People</h3>
                  {matchingMembers.map((member) => (
                    <Link className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-accent" href={`/members/${encodeURIComponent(member.id)}` as Route} key={member.id} onClick={() => onOpenChange(false)}>
                      <Users aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{member.name ?? member.email ?? "Workspace member"}</span>
                    </Link>
                  ))}
                </section>
              ) : null}
              {Array.from(query.trim()).length < 2 ? (
                <p className="px-2 text-xs text-muted-foreground">Enter at least 2 characters to search messages.</p>
              ) : null}
              {Array.from(query.trim()).length >= 2 ? (
                <SearchMessageResults
                  error={messageSearch.error}
                  hasMore={messageSearch.response?.hasMore ?? false}
                  isLoading={messageSearch.isLoading}
                  onLoadMore={messageSearch.loadMore}
                  onRetry={messageSearch.retry}
                  onSelect={selectMessage}
                  results={messageSearch.results}
                  truncated={messageSearch.response?.truncated ?? false}
                />
              ) : null}
              {!messageSearch.isLoading && !messageSearch.error && !hasResults && messageSearch.results.length === 0
                && Array.from(query.trim()).length >= 2 ? (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">No matching messages, channels, conversations, or teammates.</p>
                ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
