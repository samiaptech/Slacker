export type MessageEditFailure = Readonly<{ message: string; conflict: boolean }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getMessageEditFailure = async (response: Response): Promise<MessageEditFailure> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const code = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string"
    ? payload.error.code
    : null;
  const conflict = response.status === 409 || code === "message_edit_conflict";
  return Object.freeze({
    conflict,
    message: conflict
      ? "This message changed elsewhere. Your draft is safe; review the latest message and save again."
      : response.status === 400
        ? "Message text must contain non-space characters and stay within 4,000 characters."
        : response.status === 401
          ? "Your session expired. Sign in again to edit this message."
          : response.status === 403
            ? "You can only edit your own messages."
            : response.status === 404
              ? "This message is no longer available."
              : "The message could not be edited. Please try again."
  });
};
