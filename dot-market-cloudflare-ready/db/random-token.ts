/**
 * Short random strings: order numbers, and the state parameter on the two
 * OAuth round trips.
 *
 * The alphabet leaves out characters that get misread when someone reads an
 * order number off a Discord message — no O/0, no I/1, no L.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomToken(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  // Rejection-free: 256 % 31 != 0 skews slightly, but the alphabet is small and
  // the token is long, so the residual bias costs well under one bit overall.
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
