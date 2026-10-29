import type { ReactElement, ReactNode } from "react";
import { renderMentionTokens } from "./channel-mention-text";

type ChannelMessageTextProps = Readonly<{
  text: string;
  memberNames: ReadonlyMap<string, string>;
}>;

export const ChannelMessageText = ({ text, memberNames }: ChannelMessageTextProps): ReactElement => {
  const parts: ReactNode[] = [];
  const rendered = renderMentionTokens(text, memberNames);
  let previousIndex = 0;
  rendered.tokens.forEach((token) => {
    if (token.start > previousIndex) parts.push(rendered.text.slice(previousIndex, token.start));
    parts.push(
      <span className="rounded bg-primary/10 px-1 font-medium text-primary" key={`${token.start}-${token.id}`}>
        {rendered.text.slice(token.start, token.end)}
      </span>
    );
    previousIndex = token.end;
  });
  if (previousIndex < rendered.text.length) parts.push(rendered.text.slice(previousIndex));
  return <p className="w-fit max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{parts}</p>;
};
