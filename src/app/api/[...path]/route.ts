import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  hashPassword,
  verifyPassword,
  PasswordBusyError,
} from "@/lib/password";
import { withDatabase } from "@/lib/db";
import { serverMetrics } from "@/lib/runtime";
import { domainTxt } from "@/lib/dns";
import { db } from "@/lib/db";
import { config, folders } from "@/lib/config";
import {
  checkOrigin,
  currentSession,
  makeSession,
  cookieName,
  hash,
  secret,
  rate,
  jsonBody,
  HttpError,
  sameSecret,
} from "@/lib/security";
import {
  registerSchema,
  password,
  address,
  profileSchema,
  composeSchema,
  allowedTypes,
  validFile,
} from "@/lib/validation";
import { actionEmail } from "@/lib/smtp";
import {
  messageInclude,
  publicEntry,
  saveDraft,
  sendMessage,
  senderAddress,
  localUser,
} from "@/lib/mail";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const safeUser = (u: {
  id: string;
  email: string;
  name: string;
  handle: string;
  role: string;
  theme: string;
  signature: string;
  notifications: boolean;
  recoveryEmail: string | null;
  verifiedAt: Date | null;
  avatar: Uint8Array | null;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  handle: u.handle,
  role: u.role,
  theme: u.theme,
  signature: u.signature,
  notifications: u.notifications,
  recoveryEmail: u.recoveryEmail,
  verified: !!u.verifiedAt,
  hasAvatar: !!u.avatar,
});
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function issueToken(userId: string, kind: string, email: string) {
  const token = secret();
  await db.actionToken.deleteMany({ where: { userId, kind } });
  await db.actionToken.create({
    data: {
      userId,
      kind,
      hash: hash(token),
      expiresAt: new Date(Date.now() + 30 * 60000),
    },
  });
  try {
    await actionEmail(email, kind, token);
  } catch {
    await db.actionToken.deleteMany({ where: { hash: hash(token) } });
    throw new HttpError(
      503,
      "Провайдер не принял служебное письмо. Попробуйте позже.",
    );
  }
}
async function handler(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const method = req.method;
    const url = new URL(req.url);
    if (!["GET", "HEAD"].includes(method) && route !== "mail/inbound")
      checkOrigin(req);
    if (route === "health" && method === "GET") {
      await db.$queryRaw`SELECT 1`;
      return response({ status: "ok" });
    }
    if (route === "capabilities" && method === "GET")
      return response({
        domain: config().domain,
        externalMail: config().smtp,
        recovery: config().smtp,
        verificationRequired: config().verification,
      });
    if (route === "auth/register" && method === "POST") {
      await rate("registration-global", 30, 3600000);
      const data = registerSchema.parse(await jsonBody(req));
      if (config().verification && (!config().smtp || !data.recoveryEmail))
        throw new HttpError(
          503,
          "Регистрация требует подтверждения адреса. Канал доставки не настроен или адрес не указан.",
        );
      const email = `${data.handle}@${config().domain}`;
      const admins = (process.env.ADMIN_EMAILS || "")
        .toLowerCase()
        .split(",")
        .map((s) => s.trim());
      const u = await db.user.create({
        data: {
          handle: data.handle,
          email,
          name: data.name,
          passwordHash: await hashPassword(data.password),
          recoveryEmail: data.recoveryEmail || null,
          role: admins.includes(email) ? "ADMIN" : "USER",
        },
      });
      if (config().verification) {
        await issueToken(u.id, "verify", u.recoveryEmail!);
        return response({ needsVerification: true }, 201);
      }
      await makeSession(u.id, req);
      return response({ user: safeUser(u) }, 201);
    }
    if (route === "auth/login" && method === "POST") {
      const d = z
        .object({
          email: z.string().trim().toLowerCase().max(254),
          password: z.string().max(128),
        })
        .parse(await jsonBody(req));
      await rate(`login:${d.email}`, 10, 900000);
      await rate("login-global", 500, 900000);
      const u = await db.user.findUnique({
        where: {
          email: d.email.includes("@")
            ? d.email
            : `${d.email}@${config().domain}`,
        },
      });
      // Hash work also runs for unknown accounts to reduce timing differences.
      const ok = u
        ? await verifyPassword(u.passwordHash, d.password)
        : (await hashPassword(d.password), false);
      if (!u || !ok || u.disabled)
        throw new HttpError(401, "Неверный адрес или пароль.");
      if (config().verification && !u.verifiedAt)
        throw new HttpError(403, "Подтвердите адрес восстановления.");
      await makeSession(u.id, req);
      return response({ user: safeUser(u) });
    }

    if (route === "auth/resend" && method === "POST") {
      if (!config().smtp) throw new HttpError(503, "SMTP не подключён.");
      const d = z
        .object({
          email: z.string().trim().toLowerCase().max(254),
          password: z.string().max(128),
        })
        .parse(await jsonBody(req));
      await rate(`resend:${d.email}`, 3, 3600000);
      await rate("resend-global", 30, 3600000);
      const u = await db.user.findUnique({
        where: {
          email: d.email.includes("@")
            ? d.email
            : `${d.email}@${config().domain}`,
        },
      });
      if (
        u &&
        !u.disabled &&
        u.recoveryEmail &&
        !u.verifiedAt &&
        (await verifyPassword(u.passwordHash, d.password))
      )
        await issueToken(u.id, "verify", u.recoveryEmail);
      return response({
        message:
          "Если данные верны и адрес требует подтверждения, письмо передано провайдеру.",
      });
    }
    if (route === "auth/recover" && method === "POST") {
      if (!config().smtp)
        throw new HttpError(
          503,
          "Восстановление недоступно: SMTP не подключён.",
        );
      const d = z.object({ email: address }).parse(await jsonBody(req));
      await rate(`recover:${d.email}`, 3, 3600000);
      await rate("recover-global", 30, 3600000);
      const u = await db.user.findUnique({ where: { recoveryEmail: d.email } });
      if (u?.verifiedAt && !u.disabled)
        await issueToken(u.id, "reset", d.email);
      return response({
        message:
          "Если адрес подтверждён и связан с аккаунтом, ссылка передана почтовому провайдеру.",
      });
    }
    if (
      (route === "auth/verify" && method === "POST") ||
      (route === "auth/reset" && method === "POST")
    ) {
      const kind = route.endsWith("reset") ? "reset" : "verify";
      const d = z
        .object({ token: z.string().length(64), password: password.optional() })
        .parse(await jsonBody(req));
      await rate("tokens-global", 100, 900000);
      const token = await db.actionToken.findUnique({
        where: { hash: hash(d.token) },
      });
      if (!token || token.kind !== kind || token.expiresAt < new Date())
        throw new HttpError(400, "Ссылка недействительна или истекла.");
      if (kind === "reset" && !d.password)
        throw new HttpError(400, "Введите новый пароль.");
      const passwordHash =
        kind === "reset" ? await hashPassword(d.password!) : undefined;
      await db.$transaction(async (tx) => {
        await tx.actionToken.delete({ where: { id: token.id } });
        await tx.user.update({
          where: { id: token.userId },
          data:
            kind === "reset" ? { passwordHash } : { verifiedAt: new Date() },
        });
        if (kind === "reset")
          await tx.session.deleteMany({ where: { userId: token.userId } });
      });
      return response({ ok: true });
    }
    if (route === "mail/inbound" && method === "POST") {
      if (
        !process.env.INBOUND_TOKEN ||
        !sameSecret(
          req.headers.get("authorization") || "",
          `Bearer ${process.env.INBOUND_TOKEN}`,
        )
      )
        throw new HttpError(401, "Недопустимый ключ входящей почты.");
      await rate("inbound-global", 500, 3600000);
      const d = z
        .object({
          eventId: z.string().min(1).max(200),
          from: address,
          name: z.string().max(80).default(""),
          to: z.array(address).min(1).max(30),
          subject: z.string().max(200),
          text: z.string().max(50000),
        })
        .parse(await jsonBody(req));
      const users = await Promise.all(d.to.map(localUser));
      if (!users.some((u) => u && !u.disabled))
        throw new HttpError(422, "Нет доступных получателей.");
      const result = await db.$transaction(async (tx) => {
        const seen = await tx.inboundEvent.createMany({
          data: { id: d.eventId },
          skipDuplicates: true,
        });
        if (!seen.count) return { duplicate: true };
        const m = await tx.message.create({
          data: {
            sender: d.from,
            senderName: d.name || d.from,
            to: d.to,
            cc: [],
            subject: d.subject,
            body: d.text,
          },
        });
        await tx.entry.createMany({
          data: [
            ...new Set(users.filter((u) => u && !u.disabled).map((u) => u!.id)),
          ].map((userId) => ({ userId, messageId: m.id, folder: "inbox" })),
        });
        return { id: m.id };
      });
      return response(result);
    }
    const session = await currentSession();
    const user = session.user;
    if (route === "auth/logout" && method === "POST") {
      await db.session.delete({ where: { id: session.id } });
      (await cookies()).delete(cookieName);
      return response({ ok: true });
    }
    if (route === "me" && method === "GET")
      return response({
        user: { ...safeUser(user), sendAddress: await senderAddress(user) },
        externalMail: config().smtp,
      });
    await rate(`user:${user.id}`, 300, 60000);
    if (route === "me" && method === "PATCH") {
      const d = profileSchema.parse(await jsonBody(req));
      return response({
        user: safeUser(
          await db.user.update({ where: { id: user.id }, data: d }),
        ),
      });
    }
    if (route === "me/password" && method === "POST") {
      await rate(`password:${user.id}`, 5, 900000);
      const d = z
        .object({ current: z.string().max(128), password })
        .parse(await jsonBody(req));
      if (!(await verifyPassword(user.passwordHash, d.current)))
        throw new HttpError(400, "Текущий пароль неверен.");
      await db.$transaction([
        db.user.update({
          where: { id: user.id },
          data: {
            passwordHash: await hashPassword(d.password),
          },
        }),
        db.session.deleteMany({
          where: { userId: user.id, id: { not: session.id } },
        }),
      ]);
      return response({ ok: true });
    }
    if (route === "me/verification" && method === "POST") {
      if (!user.recoveryEmail)
        throw new HttpError(
          400,
          "Адрес восстановления не указан при регистрации.",
        );
      await rate(`verify:${user.id}`, 3, 3600000);
      await issueToken(user.id, "verify", user.recoveryEmail);
      return response({ ok: true });
    }
    if (route === "sessions" && method === "GET")
      return response({
        sessions: await db.session.findMany({
          where: { userId: user.id, expiresAt: { gt: new Date() } },
          select: { id: true, agent: true, createdAt: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        }),
        current: session.id,
      });
    if (route === "sessions" && method === "DELETE") {
      await db.session.deleteMany({ where: { userId: user.id } });
      (await cookies()).delete(cookieName);
      return response({ ok: true });
    }
    if (path[0] === "sessions" && path.length === 2 && method === "DELETE") {
      await db.session.deleteMany({ where: { id: path[1], userId: user.id } });
      return response({ ok: true });
    }
    if (route === "messages" && method === "GET") {
      const folder = url.searchParams.get("folder") || "inbox";
      if (![...folders, "starred"].includes(folder as (typeof folders)[number]))
        throw new HttpError(400, "Неизвестная папка.");
      const q = (url.searchParams.get("q") || "").slice(0, 200);
      const unread = url.searchParams.get("unread") === "true";
      const asc = url.searchParams.get("sort") === "oldest";
      const entries = await db.entry.findMany({
        where: {
          userId: user.id,
          ...(folder === "starred"
            ? { starred: true, folder: { notIn: ["trash", "spam"] } }
            : { folder }),
          ...(unread ? { read: false } : {}),
          ...(q
            ? {
                message: {
                  OR: [
                    { subject: { contains: q, mode: "insensitive" } },
                    { body: { contains: q, mode: "insensitive" } },
                    { sender: { contains: q, mode: "insensitive" } },
                    { senderName: { contains: q, mode: "insensitive" } },
                  ],
                },
              }
            : {}),
        },
        include: messageInclude,
        orderBy: { message: { createdAt: asc ? "asc" : "desc" } },
        take: 100,
      });
      const counts = await db.entry.groupBy({
        by: ["folder"],
        where: { userId: user.id },
        _count: true,
      });
      return response({ entries: entries.map(publicEntry), counts });
    }
    if (path[0] === "messages" && path.length === 2) {
      const e = await db.entry.findFirst({
        where: { id: path[1], userId: user.id },
        include: messageInclude,
      });
      if (!e) throw new HttpError(404, "Письмо не найдено.");
      if (method === "GET") return response({ entry: publicEntry(e) });
      if (method === "PATCH") {
        const d = z
          .object({
            folder: z.enum(folders).optional(),
            read: z.boolean().optional(),
            starred: z.boolean().optional(),
          })
          .parse(await jsonBody(req));
        if (d.folder === "drafts" || e.folder === "drafts")
          throw new HttpError(
            400,
            "Черновик можно сохранить, отправить или удалить.",
          );
        return response({
          entry: publicEntry(
            await db.entry.update({
              where: { id: e.id },
              data: d,
              include: messageInclude,
            }),
          ),
        });
      }
      if (method === "DELETE") {
        if (!["trash", "drafts"].includes(e.folder))
          throw new HttpError(400, "Сначала переместите письмо в корзину.");
        await db.entry.delete({ where: { id: e.id } });
        if (!(await db.entry.count({ where: { messageId: e.messageId } })))
          await db.message.delete({ where: { id: e.messageId } });
        return response({ ok: true });
      }
    }
    if (route === "drafts" && method === "POST")
      return response({
        entry: await saveDraft(user, composeSchema.parse(await jsonBody(req))),
      });
    if (route === "send" && method === "POST") {
      await rate(`send:${user.id}`, 30, 3600000);
      return response(await sendMessage(user, await jsonBody(req)));
    }
    if (
      (route === "attachments" || route === "me/avatar") &&
      method === "POST"
    ) {
      await rate(`upload:${user.id}`, 20, 3600000);
      const type = req.headers.get("content-type")?.split(";")[0] || "";
      const max = route === "me/avatar" ? 1024 * 1024 : 5 * 1024 * 1024;
      if (
        !allowedTypes.has(type) ||
        (route === "me/avatar" && !type.startsWith("image/"))
      )
        throw new HttpError(400, "Разрешены PNG, JPEG, WebP, PDF и TXT.");
      if (Number(req.headers.get("content-length") || 0) > max)
        throw new HttpError(413, "Файл слишком большой.");
      const reader = req.body?.getReader();
      if (!reader) throw new HttpError(400, "Пустой файл.");
      let length = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > max) {
          await reader.cancel();
          throw new HttpError(413, "Файл слишком большой.");
        }
        chunks.push(value);
      }
      const data = Buffer.concat(chunks);
      if (!data.length || !validFile(data, type))
        throw new HttpError(400, "Содержимое файла не соответствует его типу.");
      if (route === "me/avatar") {
        await db.user.update({
          where: { id: user.id },
          data: { avatar: data, avatarType: type },
        });
        return response({ ok: true });
      }

      const name = decodeURIComponent(
        req.headers.get("x-file-name") || "attachment",
      )
        .replace(/[\r\n/\\\x00-\x1f]/g, "_")
        .slice(0, 150);
      const file = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
        const used = await tx.attachment.aggregate({
          where: { userId: user.id },
          _sum: { size: true },
        });
        if ((used._sum.size || 0) + length > 100 * 1024 * 1024)
          throw new HttpError(413, "Лимит вложений аккаунта — 100 МБ.");
        return tx.attachment.create({
          data: { userId: user.id, name, type, size: length, data },
          select: { id: true, name: true, type: true, size: true },
        });
      });
      return response({ file }, 201);
    }
    if (route === "me/avatar" && method === "GET") {
      if (!user.avatar) throw new HttpError(404, "Аватар не загружен.");
      return new Response(new Uint8Array(user.avatar), {
        headers: {
          "Content-Type": user.avatarType!,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path[0] === "attachments" && path.length === 2 && method === "GET") {
      const file = await db.attachment.findFirst({
        where: {
          id: path[1],
          OR: [
            { userId: user.id },
            { message: { entries: { some: { userId: user.id } } } },
          ],
        },
      });
      if (!file) throw new HttpError(404, "Вложение не найдено.");
      return new Response(new Uint8Array(file.data), {
        headers: {
          "Content-Type": file.type,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (route === "domains" && method === "GET")
      return response({
        domains: await db.domain.findMany({ where: { userId: user.id } }),
        dns: {
          mx: process.env.MAIL_MX_HOST || null,
          spf: process.env.MAIL_SPF || null,
          dkimSelector: process.env.MAIL_DKIM_SELECTOR || null,
          dkim: process.env.MAIL_DKIM_VALUE || null,
          dmarc: process.env.MAIL_DMARC || null,
        },
      });
    if (route === "domains" && method === "POST") {
      const d = z
        .object({
          name: z
            .string()
            .trim()
            .toLowerCase()
            .max(253)
            .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/),
        })
        .parse(await jsonBody(req));
      if (d.name === config().domain)
        throw new HttpError(400, "Это основной домен сервиса.");
      if ((await db.domain.count({ where: { userId: user.id } })) >= 3)
        throw new HttpError(400, "Можно подключить до трёх доменов.");
      return response(
        {
          domain: await db.domain.create({
            data: { name: d.name, userId: user.id, token: secret() },
          }),
        },
        201,
      );
    }
    if (path[0] === "domains" && path.length >= 2) {
      const domain = await db.domain.findFirst({
        where: { id: path[1], userId: user.id },
      });
      if (!domain) throw new HttpError(404, "Домен не найден.");
      if (path[2] === "verify" && method === "POST") {
        await rate(`dns:${user.id}`, 10, 3600000);
        let records: string[][] = [];
        try {
          records = await domainTxt(`_soul.${domain.name}`);
        } catch {
          throw new HttpError(
            400,
            "TXT-запись пока не найдена. Проверьте DNS и повторите позже.",
          );
        }
        if (
          !records.some(
            (r) => r.join("") === `soul-verification=${domain.token}`,
          )
        )
          throw new HttpError(400, "TXT-запись не совпадает.");
        return response({
          domain: await db.domain.update({
            where: { id: domain.id },
            data: { verifiedAt: new Date() },
          }),
        });
      }
      if (method === "DELETE") {
        await db.domain.delete({ where: { id: domain.id } });
        return response({ ok: true });
      }
    }
    if (route === "reports" && method === "POST") {
      const d = z
        .object({
          category: z.enum(["spam", "abuse", "delivery", "other"]),
          detail: z.string().trim().min(10).max(2000),
        })
        .parse(await jsonBody(req));
      await rate(`report:${user.id}`, 5, 3600000);
      return response(
        { report: await db.report.create({ data: { userId: user.id, ...d } }) },
        201,
      );
    }
    if (path[0] === "admin") {
      if (user.role !== "ADMIN")
        throw new HttpError(403, "Требуются права администратора.");
      if (route === "admin" && method === "GET") {
        await db.$queryRaw`SELECT 1`;
        return response({
          users: await db.user.findMany({
            select: {
              id: true,
              email: true,
              name: true,
              disabled: true,
              role: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
          userCount: await db.user.count(),
          messageCount: await db.message.count(),
          failures: await db.delivery.findMany({
            where: { status: { in: ["failed", "pending"] } },
            select: { id: true, status: true, code: true, updatedAt: true },
            take: 50,
            orderBy: { updatedAt: "desc" },
          }),
          reports: await db.report.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          server: serverMetrics(),
        });
      }
      if (path[1] === "users" && path[2] && method === "PATCH") {
        const d = z
          .object({ disabled: z.boolean() })
          .parse(await jsonBody(req));
        if (path[2] === user.id)
          throw new HttpError(400, "Нельзя отключить свой аккаунт.");
        await db.$transaction([
          db.user.update({ where: { id: path[2] }, data: d }),
          ...(d.disabled
            ? [db.session.deleteMany({ where: { userId: path[2] } })]
            : []),
        ]);
        return response({ ok: true });
      }
      if (path[1] === "reports" && path[2] && method === "PATCH") {
        await db.report.update({
          where: { id: path[2] },
          data: { status: "RESOLVED" },
        });
        return response({ ok: true });
      }
    }
    throw new HttpError(404, "Маршрут не найден.");
  } catch (error) {
    if (error instanceof PasswordBusyError)
      return response({ error: error.message }, 429);
    if (error instanceof HttpError)
      return response({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return response(
        { error: error.issues[0]?.message || "Проверьте введённые данные." },
        400,
      );
    if ((error as { code?: string }).code === "P2002")
      return response({ error: "Этот адрес или домен уже используется." }, 409);
    if ((error as { code?: string }).code === "P2025")
      return response({ error: "Запись уже изменена или удалена." }, 409);
    console.error("api.error", {
      kind: error instanceof Error ? error.name : "Unknown",
    });
    return response(
      { error: "Сервис временно недоступен. Повторите позже." },
      500,
    );
  }
}
async function route(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    return await withDatabase(() => handler(req, context));
  } catch {
    return response(
      { error: "База данных недоступна. Проверьте серверную конфигурацию." },
      503,
    );
  }
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
