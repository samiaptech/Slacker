import {
  MESSAGE_REACTION_EMOJI,
  type MessageReactionEmoji,
  type MessageReactionResponse,
  type MessageReactionUserResponse
} from "@workspace/types";

const REACTION_LABELS: Readonly<Record<MessageReactionEmoji, string>> = Object.freeze({
  "👍": "thumbs up",
  "❤️": "heart",
  "😂": "laugh",
  "🎉": "celebrate",
  "👀": "eyes",
  "✅": "check",
  "🙏": "thanks",
  "🔥": "fire",
  "💯": "hundred",
  "😮": "surprised",
  "😢": "sad",
  "🚀": "rocket",
  "👏": "clap",
  "🤔": "thinking",
  "😍": "love it",
  "🥳": "party",
  "🙌": "raised hands",
  "💡": "idea",
  "👎": "thumbs down",
  "🤝": "deal",
  "💪": "strong",
  "🫡": "salute",
  "☕": "coffee",
  "🐛": "bug",
  "✨": "sparkles"
});

export const MESSAGE_REACTION_OPTIONS = Object.freeze(MESSAGE_REACTION_EMOJI.map((emoji) =>
  Object.freeze({ emoji, label: REACTION_LABELS[emoji] })
));

export const QUICK_REACTION_OPTIONS = MESSAGE_REACTION_OPTIONS.slice(0, 5);

export type { MessageReactionEmoji };

export const toggleMessageReaction = (
  selected: readonly MessageReactionEmoji[],
  emoji: MessageReactionEmoji
): readonly MessageReactionEmoji[] => selected[0] === emoji ? [] : [emoji];

const REACTION_USER_LIMIT = 10;

const removeReactionUser = (
  reaction: MessageReactionResponse,
  userId: string
): MessageReactionResponse => {
  const users = reaction.users.filter(({ id }) => id !== userId);
  const count = Math.max(0, reaction.count - 1);
  return { ...reaction, count, users, usersTruncated: count > users.length, reactedByMe: false };
};

export const optimisticallyToggleMessageReaction = (
  reactions: readonly MessageReactionResponse[],
  emoji: MessageReactionEmoji,
  user: MessageReactionUserResponse
): readonly MessageReactionResponse[] => {
  const activeReaction = reactions.find(({ reactedByMe }) => reactedByMe);
  const isRemoving = activeReaction?.emoji === emoji;
  const next = reactions.flatMap((reaction) => {
    if (activeReaction && reaction.emoji === activeReaction.emoji && activeReaction.emoji !== emoji) {
      const updated = removeReactionUser(reaction, user.id);
      return updated.count > 0 ? [updated] : [];
    }
    if (reaction.emoji !== emoji) return [reaction];
    if (isRemoving) {
      const updated = removeReactionUser(reaction, user.id);
      return updated.count > 0 ? [updated] : [];
    }
    const users = [user, ...reaction.users.filter(({ id }) => id !== user.id)].slice(0, REACTION_USER_LIMIT);
    const count = reaction.count + 1;
    return [{ ...reaction, count, users, usersTruncated: count > users.length, reactedByMe: true }];
  });
  if (isRemoving || reactions.some((reaction) => reaction.emoji === emoji)) return next;
  return [...next, { emoji, count: 1, users: [user], usersTruncated: false, reactedByMe: true }];
};
