export type MessageDeliveryState = "sending" | "failed";

export type MessageWithDelivery<TMessage> = TMessage & Readonly<{
  deliveryState?: MessageDeliveryState;
  pendingFiles?: readonly File[];
}>;

type PendingMessage = Readonly<{
  id: string;
  senderId: string;
  text: string;
  deliveryState?: MessageDeliveryState;
  pendingFiles?: readonly File[];
}>;

type PersistedMessage = Readonly<{
  senderId: string;
  text: string;
  attachments?: readonly Readonly<{ name: string; size: number }>[];
}>;

export const updatePendingMessage = <TMessage extends PendingMessage>(
  messages: readonly TMessage[],
  messageId: string,
  deliveryState: MessageDeliveryState
): readonly TMessage[] => messages.map((message) =>
  message.id === messageId ? { ...message, deliveryState } : message
);

export const removePendingMessage = <TMessage extends PendingMessage>(
  messages: readonly TMessage[],
  messageId: string
): readonly TMessage[] => messages.filter((message) => message.id !== messageId);

export const findMatchingPendingMessageId = <TMessage extends PendingMessage>(
  messages: readonly TMessage[],
  persisted: PersistedMessage
): string | null => {
  const matching = messages.filter((message) => {
    if (!message.deliveryState || message.senderId !== persisted.senderId || message.text !== persisted.text) return false;
    const pendingFiles = message.pendingFiles ?? [];
    const attachments = persisted.attachments ?? [];
    return pendingFiles.length === attachments.length
      && pendingFiles.every((file, index) => file.name === attachments[index]?.name && file.size === attachments[index]?.size);
  });
  return matching.find((message) => message.deliveryState === "sending")?.id
    ?? matching[0]?.id
    ?? null;
};
