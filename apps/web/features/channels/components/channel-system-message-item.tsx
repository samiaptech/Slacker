import type { ReactElement } from "react";
import type { ChannelHistoryEntryView } from "../types";

type ChannelSystemMessage = Extract<ChannelHistoryEntryView, { type: "system" }>;

type ChannelSystemMessageItemProps = Readonly<{
  message: ChannelSystemMessage;
  startsNewDay: boolean;
}>;

const formatMessageDay = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(value));

const formatMessageTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(value));

export const ChannelSystemMessageItem = ({
  message,
  startsNewDay
}: ChannelSystemMessageItemProps): ReactElement => (
  <>
    {startsNewDay ? (
      <li aria-label={formatMessageDay(message.createdAt)} className="flex items-center gap-3 py-1 text-[11px] font-medium text-[#8b9690]">
        <span aria-hidden="true" className="h-px flex-1 bg-[#e7e9e4]" />
        <time dateTime={message.createdAt}>{formatMessageDay(message.createdAt)}</time>
        <span aria-hidden="true" className="h-px flex-1 bg-[#e7e9e4]" />
      </li>
    ) : null}
    <li className="py-1 text-center text-xs text-muted-foreground" data-message-id={message.id}>
      <span className="rounded-full bg-muted/70 px-3 py-1.5">
        <span className="font-medium text-foreground/75">{message.actor.name}</span> left the channel
      </span>
      <time className="sr-only" dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
    </li>
  </>
);
