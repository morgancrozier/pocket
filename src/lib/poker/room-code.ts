export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{8}$`);
const INVITE_PATH_PATTERN = /^\/table\/([^/]+)\/?$/i;
const VISUAL_SEPARATOR_PATTERN = /[\s\u2010-\u2015-]+/g;

function inviteCode(value: string): string | null {
  if (!value.includes(":")) return value;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const encodedCode = url.pathname.match(INVITE_PATH_PATTERN)?.[1];
    return encodedCode ? decodeURIComponent(encodedCode) : null;
  } catch {
    return null;
  }
}

export function normalizeRoomCodeInput(value: string): string | null {
  const candidate = inviteCode(value.trim());
  if (!candidate) return null;

  const normalized = candidate.replace(VISUAL_SEPARATOR_PATTERN, "").toUpperCase();
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}
