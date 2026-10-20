import { Buffer } from "node:buffer";

export const CHANNEL_PAGE_SIZE_DEFAULT = 25;
export const CHANNEL_PAGE_SIZE_MAX = 50;

export type ChannelListScope = "joined" | "discoverable";
export type ChannelListCursor = Readonly<{ scope: ChannelListScope; name: string }>;
export type ChannelListQuery = Readonly<{
  scope: ChannelListScope;
  pageSize: number;
  cursor: ChannelListCursor | null;
}>;

export type ChannelCursorDecodeResult =
  | Readonly<{ ok: true; cursor: ChannelListCursor }>
  | Readonly<{ ok: false }>;

export const encodeChannelListCursor = (cursor: ChannelListCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

export const decodeChannelListCursor = (
  value: string,
  expectedScope: ChannelListScope
): ChannelCursorDecodeResult => {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) return Object.freeze({ ok: false });
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return Object.freeze({ ok: false });
    if (
      Object.keys(parsed).length !== 2
      || !("scope" in parsed)
      || !("name" in parsed)
      || parsed.scope !== expectedScope
      || typeof parsed.name !== "string"
      || !/^[a-z0-9_-]{1,80}$/.test(parsed.name)
    ) {
      return Object.freeze({ ok: false });
    }
    return Object.freeze({
      ok: true,
      cursor: Object.freeze({ scope: expectedScope, name: parsed.name })
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return Object.freeze({ ok: false });
    throw error;
  }
};
