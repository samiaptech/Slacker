"use client";

import { useState, type ReactElement } from "react";
import { Plus, SmilePlus } from "lucide-react";
import type { MessageReactionEmoji, MessageReactionResponse } from "@workspace/types";
import { Button } from "@workspace/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@workspace/ui/primitives";
import {
  MESSAGE_REACTION_OPTIONS,
  QUICK_REACTION_OPTIONS
} from "./message-reaction-state";

type MessageReactionsProps = Readonly<{
  reactions: readonly MessageReactionResponse[];
  isPending: boolean;
  currentUserId: string;
  currentUserName: string;
  onToggle: (emoji: MessageReactionEmoji) => void;
}>;

type ReactionMembersPopoverProps = Readonly<{
  emoji: MessageReactionEmoji;
  count: number;
  reactedByMe: boolean;
  users: MessageReactionResponse["users"];
  usersTruncated: boolean;
  currentUserId: string;
  currentUserName: string;
  isPending: boolean;
  onToggle: (emoji: MessageReactionEmoji) => void;
}>;

const ReactionMembersPopover = ({
  emoji,
  count,
  reactedByMe,
  users,
  usersTruncated,
  currentUserId,
  currentUserName,
  isPending,
  onToggle
}: ReactionMembersPopoverProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const visibleUsers = reactedByMe && !users.some(({ id }) => id === currentUserId)
    ? [...users, { id: currentUserId, name: currentUserName, image: null }]
    : users;
  const removeOwnReaction = (): void => {
    setOpen(false);
    onToggle(emoji);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`See who reacted with ${emoji}, ${count} reactions`}
          className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${reactedByMe ? "border-primary/30 bg-primary/10 text-foreground hover:bg-primary/15" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
          disabled={isPending}
          type="button"
        >
          <span aria-hidden="true" className="text-sm leading-none">{emoji}</span>
          <span className="tabular-nums">{count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`Members who reacted with ${emoji}`} className="w-[min(18rem,calc(100vw-2rem))] p-0 shadow-xl" side="top" sideOffset={8}>
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">Reactions</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{count} member{count === 1 ? "" : "s"}</p>
        </div>
        <ul aria-label="Members and their reactions" className="max-h-56 overflow-y-auto p-1.5">
          {visibleUsers.map(({ id, name }) => (
            <li className="rounded-md" key={id}>
              {id === currentUserId && reactedByMe ? (
                <button
                  aria-label={`Remove your ${emoji} reaction`}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={isPending}
                  onClick={removeOwnReaction}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{name}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">Tap to remove</span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-lg leading-none">{emoji}</span>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{name}</span>
                  <span aria-label={`Reacted with ${emoji}`} className="shrink-0 text-lg leading-none">{emoji}</span>
                </div>
              )}
            </li>
          ))}
          {visibleUsers.length === 0 ? (
            <li className="px-2.5 py-3 text-sm text-muted-foreground">Member details are unavailable.</li>
          ) : null}
          {usersTruncated ? (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">And more members reacted.</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

const getReactionNames = (reaction: MessageReactionResponse): string => {
  const names = reaction.users.map(({ name }) => name).join(", ");
  return reaction.usersTruncated ? `${names} and others` : names || `${reaction.count} reactions`;
};

export const MessageReactions = ({ reactions, isPending, currentUserId, currentUserName, onToggle }: MessageReactionsProps): ReactElement => {
  const [isQuickReactionsOpen, setIsQuickReactionsOpen] = useState(false);

  const toggle = (emoji: MessageReactionEmoji): void => {
    setIsQuickReactionsOpen(false);
    onToggle(emoji);
  };

  return (
    <div aria-busy={isPending} aria-label="Message reactions" className="flex flex-wrap items-center gap-1" role="group">
      <Button
        aria-expanded={isQuickReactionsOpen}
        aria-label={isQuickReactionsOpen ? "Hide quick reactions" : "Show quick reactions"}
        className="size-8 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        disabled={isPending}
        onClick={() => setIsQuickReactionsOpen((open) => !open)}
        size="icon"
        title={isQuickReactionsOpen ? "Hide quick reactions" : "Show quick reactions"}
        type="button"
        variant="ghost"
      >
        <SmilePlus aria-hidden="true" className="size-4" />
      </Button>
      {isQuickReactionsOpen ? (
        <div aria-label="Quick reactions" className="flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto" role="group">
          {QUICK_REACTION_OPTIONS.map(({ emoji, label }) => {
            const reaction = reactions.find((item) => item.emoji === emoji);
            const isSelected = reaction?.reactedByMe ?? false;
            return (
              <button
                aria-label={reaction ? `${label}, ${reaction.count} reactions` : `React with ${label}`}
                aria-pressed={isSelected}
                className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "border-primary/30 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:bg-muted"}`}
                disabled={isPending}
                key={emoji}
                onClick={() => toggle(emoji)}
                title={reaction ? `${label}: ${getReactionNames(reaction)}` : label}
                type="button"
              >
                <span aria-hidden="true" className="leading-none">{emoji}</span>
                {reaction ? <span className="text-[11px] font-medium tabular-nums">{reaction.count}</span> : null}
              </button>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="More reactions"
                className="size-8 shrink-0 rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                disabled={isPending}
                size="icon"
                title="More reactions"
                type="button"
                variant="ghost"
              >
                <Plus aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" aria-label="Choose an emoji reaction" className="grid w-[min(18rem,calc(100vw-2rem))] grid-cols-6 gap-1 rounded-xl border border-border bg-popover p-2 shadow-lg">
              {MESSAGE_REACTION_OPTIONS.map(({ emoji, label }) => (
                <DropdownMenuItem
                  aria-label={`React with ${label}`}
                  className="flex size-10 cursor-pointer items-center justify-center rounded-lg p-0 text-xl transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground"
                  key={emoji}
                  onSelect={() => toggle(emoji)}
                  title={label}
                >
                  <span aria-hidden="true">{emoji}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      {reactions
        .filter(({ emoji }) => !isQuickReactionsOpen || !QUICK_REACTION_OPTIONS.some((quick) => quick.emoji === emoji))
        .map(({ emoji, count, reactedByMe, users, usersTruncated }) => (
          <ReactionMembersPopover
            count={count}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            emoji={emoji}
            isPending={isPending}
            key={emoji}
            onToggle={onToggle}
            reactedByMe={reactedByMe}
            users={users}
            usersTruncated={usersTruncated}
          />
        ))}
    </div>
  );
};
