import { argon2idAsync } from "@noble/hashes/argon2.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
export class PasswordBusyError extends Error {}
let queue = Promise.resolve();
let pending = 0;
async function derive(password: string, salt: Uint8Array) {
  if (pending >= 4)
    throw new PasswordBusyError(
      "Сервис авторизации занят. Повторите запрос позже.",
    );
  pending++;
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await argon2idAsync(password, salt, options);
  } finally {
    pending--;
    release();
  }
}
const options = {
  m: 65536,
  t: 3,
  p: 1,
  dkLen: 32,
  maxmem: 70 * 1024 * 1024,
  asyncTick: 10,
};
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  return `$argon2id$v=19$m=65536,t=3,p=1$${salt.toString("base64url").replace(/-/g, "+").replace(/_/g, "/")}$${Buffer.from(digest).toString("base64").replace(/=+$/, "")}`;
}
export async function verifyPassword(encoded: string, password: string) {
  const match =
    /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9+/]{22,43})\$([A-Za-z0-9+/]{43})$/.exec(
      encoded,
    );
  if (!match) return false;
  const salt = Buffer.from(match[1], "base64");
  if (salt.length < 16 || salt.length > 32) return false;
  const digest = await derive(password, salt);
  return timingSafeEqual(Buffer.from(digest), Buffer.from(match[2], "base64"));
}
