import type { MessageReactionEmoji, MessageReactionToggleResponse } from "@workspace/types";
import { messageReactionToggleResponseSchema } from "./message-reaction-schema";

type ReactionTarget =
  | Readonly<{ type: "channel"; id: string }>
  | Readonly<{ type: "direct-message"; id: string }>;

type RequestMessageReactionOptions = Readonly<{
  apiBaseUrl: string;
  workspaceId: string;
  target: ReactionTarget;
  messageId: string;
  emoji: MessageReactionEmoji;
}>;

const reactionPath = (target: ReactionTarget, messageId: string): string => {
  const parentPath = target.type === "channel" ? "channels" : "direct-messages";
  return `/${parentPath}/${encodeURIComponent(target.id)}/messages/${encodeURIComponent(messageId)}/reactions`;
};

export const requestMessageReaction = async ({
  apiBaseUrl,
  workspaceId,
  target,
  messageId,
  emoji
}: RequestMessageReactionOptions): Promise<MessageReactionToggleResponse> => {
  const response = await fetch(new URL(reactionPath(target, messageId), apiBaseUrl), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Id": workspaceId
    },
    body: JSON.stringify({ emoji })
  });
  if (!response.ok) throw new Error("The reaction could not be updated. Please try again.");
  const parsed = messageReactionToggleResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.messageId !== messageId) {
    throw new Error("The server returned an invalid reaction update.");
  }
  return parsed.data;
};
