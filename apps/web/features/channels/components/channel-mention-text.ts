export type MentionTokenRange = Readonly<{ start: number; end: number; id: string }>;
export type RenderedMentionText = Readonly<{ text: string; tokens: readonly MentionTokenRange[] }>;

export const renderMentionTokens = (
  storedText: string,
  memberNames: ReadonlyMap<string, string>
): RenderedMentionText => {
  const tokens: MentionTokenRange[] = [];
  let text = "";
  let previousIndex = 0;
  const pattern = /@\[([^\]\s]{1,128})\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(storedText)) !== null) {
    const id = match[1];
    if (!id) continue;
    text += storedText.slice(previousIndex, match.index);
    const start = text.length;
    text += `@${memberNames.get(id) ?? "Former member"}`;
    tokens.push({ start, end: text.length, id });
    previousIndex = match.index + match[0].length;
  }
  text += storedText.slice(previousIndex);
  return { text, tokens };
};

export const serializeMentionTokens = (text: string, tokens: readonly MentionTokenRange[]): string => {
  let storedText = "";
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor || token.end > text.length) continue;
    storedText += `${text.slice(cursor, token.start)}@[${token.id}]`;
    cursor = token.end;
  }
  return storedText + text.slice(cursor);
};

export const retainUneditedMentionTokens = (
  previousText: string,
  nextText: string,
  tokens: readonly MentionTokenRange[]
): readonly MentionTokenRange[] => {
  let prefix = 0;
  while (prefix < previousText.length && prefix < nextText.length
    && previousText[prefix] === nextText[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < previousText.length - prefix && suffix < nextText.length - prefix
    && previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]) suffix += 1;
  const oldSuffixStart = previousText.length - suffix;
  const shift = nextText.length - previousText.length;
  return tokens.flatMap((token) => {
    if (token.end <= prefix) return [token];
    if (token.start >= oldSuffixStart) return [{ ...token, start: token.start + shift, end: token.end + shift }];
    return [];
  });
};
