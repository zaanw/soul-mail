import { db } from "./db";
import { config, isInternalAddress } from "./config";
import { HttpError } from "./security";
import { transport } from "./smtp";
import { composeSchema, sendSchema } from "./validation";
import type { User, Prisma } from "@prisma/client";
import type { z } from "zod";
type Compose = z.infer<typeof composeSchema>;
export const messageInclude = {
  message: {
    include: {
      attachments: { select: { id: true, name: true, type: true, size: true } },
      deliveries: { select: { recipient: true, status: true, code: true } },
    },
  },
} as const;
export function publicEntry<
  T extends { folder: string; message: { deliveries: unknown[] } },
>(entry: T) {
  return {
    ...entry,
    message: {
      ...entry.message,
      deliveries: entry.folder === "sent" ? entry.message.deliveries : [],
    },
  };
}
export async function senderAddress(user: User) {
  const domain = await db.domain.findFirst({
    where: { userId: user.id, verifiedAt: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  return domain ? `${user.handle}@${domain.name}` : user.email;
}
export async function localUser(email: string) {
  const direct = await db.user.findUnique({ where: { email } });
  if (direct) return direct;
  const [handle, name] = email.split("@");
  const domain = await db.domain.findUnique({
    where: { name },
    include: { user: true },
  });
  return domain?.verifiedAt && domain.user.handle === handle
    ? domain.user
    : null;
}
async function validateAttachments(
  userId: string,
  ids: string[],
  messageId: string | undefined,
  tx: Prisma.TransactionClient,
) {
  const files = await tx.attachment.findMany({
    where: { id: { in: ids }, userId },
  });
  if (
    files.length !== new Set(ids).size ||
    files.some((f) => f.messageId && f.messageId !== messageId)
  )
    throw new HttpError(400, "Вложение недоступно.");
  if (files.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024)
    throw new HttpError(400, "Общий размер вложений — до 10 МБ.");
  return files;
}
export async function saveDraft(user: User, input: Compose) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
    const old = input.id
      ? await tx.entry.findFirst({
          where: { id: input.id, userId: user.id, folder: "drafts" },
        })
      : null;
    if (input.id && !old) throw new HttpError(404, "Черновик не найден.");
    await validateAttachments(user.id, input.attachments, old?.messageId, tx);
    const data = {
      sender: user.email,
      senderName: user.name,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body: input.body,
    };
    if (old) {
      await tx.attachment.updateMany({
        where: { messageId: old.messageId, userId: user.id },
        data: { messageId: null },
      });
      await tx.message.update({ where: { id: old.messageId }, data });
      await tx.attachment.updateMany({
        where: { id: { in: input.attachments }, userId: user.id },
        data: { messageId: old.messageId },
      });
      return tx.entry.findUniqueOrThrow({
        where: { id: old.id },
        include: messageInclude,
      });
    }
    const message = await tx.message.create({
      data: {
        ...data,
        entries: { create: { userId: user.id, folder: "drafts", read: true } },
      },
    });
    await tx.attachment.updateMany({
      where: { id: { in: input.attachments }, userId: user.id },
      data: { messageId: message.id },
    });
    return tx.entry.findFirstOrThrow({
      where: { messageId: message.id, userId: user.id },
      include: messageInclude,
    });
  });
}
export async function sendMessage(user: User, raw: unknown) {
  const input = sendSchema.parse(raw);
  const recipients = [...new Set([...input.to, ...input.cc])];
  const targets = await Promise.all(
    recipients.map(async (email) => ({ email, user: await localUser(email) })),
  );
  for (const t of targets) {
    if (t.user?.disabled)
      throw new HttpError(400, `Получатель ${t.email} недоступен.`);
    if (!t.user && isInternalAddress(t.email, config().domain))
      throw new HttpError(400, `Адрес ${t.email} не существует.`);
  }
  const external = targets.filter((t) => !t.user);
  if (external.length && !config().smtp)
    throw new HttpError(
      503,
      "Внешняя почта не подключена. Письмо не отправлено. Можно писать пользователям soul.",
    );
  const sender = await senderAddress(user);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
    // Lock a draft before promotion, preventing duplicate sends from concurrent requests.
    const old = input.id
      ? await tx.entry.findFirst({
          where: { id: input.id, userId: user.id, folder: "drafts" },
        })
      : null;
    if (input.id && !old)
      throw new HttpError(409, "Черновик уже отправлен или удалён.");
    if (old) {
      const changed = await tx.entry.updateMany({
        where: { id: old.id, folder: "drafts" },
        data: { folder: "sent" },
      });
      if (!changed.count) throw new HttpError(409, "Письмо уже отправляется.");
    }
    const files = await validateAttachments(
      user.id,
      input.attachments,
      old?.messageId,
      tx,
    );
    const data = {
      sender,
      senderName: user.name,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      body: input.body,
    };
    const message = old
      ? await tx.message.update({ where: { id: old.messageId }, data })
      : await tx.message.create({
          data: {
            ...data,
            entries: {
              create: { userId: user.id, folder: "sent", read: true },
            },
          },
        });
    if (old)
      await tx.attachment.updateMany({
        where: { messageId: message.id },
        data: { messageId: null },
      });
    await tx.attachment.updateMany({
      where: { id: { in: input.attachments }, userId: user.id },
      data: { messageId: message.id },
    });
    for (const t of targets) {
      if (t.user)
        await tx.entry.upsert({
          where: {
            userId_messageId_folder: {
              userId: t.user.id,
              messageId: message.id,
              folder: "inbox",
            },
          },
          create: { userId: t.user.id, messageId: message.id, folder: "inbox" },
          update: {},
        });
      await tx.delivery.create({
        data: {
          messageId: message.id,
          recipient: t.email,
          status: t.user ? "delivered" : "pending",
        },
      });
    }
    return { message, files };
  });
  if (external.length) {
    try {
      const response = await transport().sendMail({
        from: { name: user.name, address: sender },
        to: input.to,
        cc: input.cc,
        envelope: { from: sender, to: external.map((t) => t.email) },
        subject: input.subject,
        text: input.body,
        attachments: result.files.map((f) => ({
          filename: f.name,
          content: Buffer.from(f.data),
          contentType: f.type,
        })),
        messageId: `<${result.message.id}@${config().domain}>`,
      });
      for (const t of external) {
        const accepted = (response.accepted as string[]).some(
          (a) => a.toLowerCase() === t.email,
        );
        await db.delivery.updateMany({
          where: { messageId: result.message.id, recipient: t.email },
          data: {
            status: accepted ? "accepted" : "failed",
            code: accepted ? null : "EXTERNAL_REJECTED",
          },
        });
      }
    } catch {
      await db.delivery.updateMany({
        where: { messageId: result.message.id, status: "pending" },
        data: { status: "failed", code: "EXTERNAL_MAIL_ERROR" },
      });
      console.error("mail.delivery.failed", {
        messageId: result.message.id,
        code: "EXTERNAL_MAIL_ERROR",
      });
    }
  }
  const deliveries = await db.delivery.findMany({
    where: { messageId: result.message.id },
    select: { recipient: true, status: true, code: true },
  });
  console.info("mail.delivery.result", {
    messageId: result.message.id,
    statuses: deliveries.map((d) => d.status),
  });
  return { id: result.message.id, deliveries };
}
