import type { ReactElement } from "react";
import Image from "next/image";
import type { ChannelMentionMemberResponse } from "@workspace/types";

type ChannelMentionSuggestionsProps = Readonly<{
  activeIndex: number;
  members: readonly ChannelMentionMemberResponse[];
  onRetry: () => void;
  onSelect: (member: ChannelMentionMemberResponse) => void;
  status: "loading" | "ready" | "error";
}>;

const initials = (name: string): string => name.trim().split(/\s+/).slice(0, 2)
  .map((part) => part[0] ?? "").join("").toLocaleUpperCase() || "?";

export const ChannelMentionSuggestions = ({
  activeIndex, members, onRetry, onSelect, status
}: ChannelMentionSuggestionsProps): ReactElement => (
  <div aria-label="Channel members" className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl" id="channel-mention-options" role="listbox">
    {status === "loading" ? <p className="px-3 py-2 text-sm text-muted-foreground" role="status">Loading channel members…</p> : null}
    {status === "error" ? (
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Members could not load.</span>
        <button className="font-medium text-primary hover:underline" onMouseDown={(event) => event.preventDefault()} onClick={onRetry} type="button">Retry</button>
      </div>
    ) : null}
    {status === "ready" && members.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No matching members</p> : null}
    {status === "ready" ? members.map((member, index) => (
      <button
        aria-selected={index === activeIndex}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
        id={`channel-mention-option-${index}`}
        key={member.id}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onSelect(member)}
        role="option"
        type="button"
      >
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {member.image ? <Image alt="" className="size-full object-cover" height={32} src={member.image} unoptimized width={32} /> : initials(member.name)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
        <span className="text-xs text-muted-foreground">Mention</span>
      </button>
    )) : null}
  </div>
);
