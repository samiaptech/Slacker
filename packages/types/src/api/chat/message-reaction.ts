export const MESSAGE_REACTION_EMOJI = [
  "👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥", "💯", "😮",
  "😢", "🚀", "👏", "🤔", "😍", "🥳", "🙌", "💡", "👎", "🤝",
  "💪", "🫡", "☕", "🐛", "✨"
] as const;

export type MessageReactionEmoji = typeof MESSAGE_REACTION_EMOJI[number];

export type MessageReactionUserResponse = Readonly<{
  id: string;
  name: string;
  image: string | null;
}>;

export type MessageReactionResponse = Readonly<{
  emoji: MessageReactionEmoji;
  count: number;
  users: readonly MessageReactionUserResponse[];
  usersTruncated: boolean;
  reactedByMe: boolean;
}>;

export type MessageReactionToggleResponse = Readonly<{
  messageId: string;
  reactions: readonly MessageReactionResponse[];
}>;
