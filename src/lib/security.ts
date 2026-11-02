import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { config } from "./config";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
export const cookieName = "soul_session";
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(hash(a)),
    y = Buffer.from(hash(b));
  return timingSafeEqual(x, y);
}
export function checkOrigin(req: Request) {
  if (req.headers.get("origin") !== config().appUrl.origin)
    throw new HttpError(
      403,
      "Недопустимый источник запроса. Обновите страницу.",
    );
}
export async function currentSession() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) throw new HttpError(401, "Войдите в аккаунт.");
  const s = await db.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  if (!s || s.expiresAt < new Date() || s.user.disabled)
    throw new HttpError(401, "Сессия завершена. Войдите снова.");
  if (config().verification && !s.user.verifiedAt)
    throw new HttpError(403, "Сначала подтвердите адрес восстановления.");
  return s;
}
export async function makeSession(userId: string, req: Request) {
  const token = secret();
  const expires = new Date(Date.now() + 30 * 86400000);
  await db.session.create({
    data: {
      userId,
      tokenHash: hash(token),
      expiresAt: expires,
      agent: (req.headers.get("user-agent") || "Unknown device").slice(0, 200),
    },
  });
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: config().appUrl.protocol === "https:",
    sameSite: "strict",
    path: "/",
    expires,
  });
}
export async function rate(key: string, max: number, windowMs: number) {
  const id = hash(key);
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" ("key","count","resetAt") VALUES (${id},1,${new Date(Date.now() + windowMs)}) ON CONFLICT ("key") DO UPDATE SET "count"=CASE WHEN "RateLimit"."resetAt" < NOW() THEN 1 ELSE "RateLimit"."count"+1 END, "resetAt"=CASE WHEN "RateLimit"."resetAt" < NOW() THEN ${new Date(Date.now() + windowMs)} ELSE "RateLimit"."resetAt" END RETURNING "count"`;
  if (rows[0].count > max)
    throw new HttpError(429, "Слишком много запросов. Попробуйте позже.");
}
export async function jsonBody(req: Request, max = 100000) {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Ожидается JSON.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Пустой запрос.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > max) {
      await reader.cancel();
      throw new HttpError(413, "Слишком большой запрос.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "Некорректный JSON.");
  }
}
