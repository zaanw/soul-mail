import type { SendMailOptions } from "nodemailer";
import { config } from "./config";
import { HttpError } from "./security";
function addressList(value: unknown): string[] {
  if (typeof value === "string")
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(addressList);
  if (
    value &&
    typeof value === "object" &&
    "address" in value &&
    typeof value.address === "string"
  )
    return [value.address];
  return [];
}
export function transport() {
  if (!config().smtp)
    throw new HttpError(
      503,
      "Внешняя почта не подключена. Настройте Resend API или SMTP.",
    );
  return {
    async sendMail(message: SendMailOptions): Promise<{ accepted: string[] }> {
      if (process.env.RESEND_API_KEY) {
        const to = message.envelope?.to || message.to;
        const recipients = addressList(to);
        const from =
          typeof message.from === "string"
            ? message.from
            : `${(!Array.isArray(message.from) && message.from?.name) || "soul"} <${!Array.isArray(message.from) && message.from?.address}>`;
        const result = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            ...(message.messageId
              ? { "Idempotency-Key": message.messageId.replace(/[<>]/g, "") }
              : {}),
          },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            from,
            to: recipients,
            subject: message.subject,
            text: message.text,
            attachments: message.attachments?.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content as Uint8Array).toString("base64"),
              content_type: a.contentType,
            })),
          }),
        });
        if (!result.ok)
          throw new HttpError(502, "Почтовый провайдер не принял письмо.");
        const receipt = (await result.json()) as { id?: string };
        if (!receipt.id)
          throw new HttpError(502, "Провайдер не подтвердил приём письма.");
        return { accepted: recipients };
      }
      const { default: nodemailer } = await import("nodemailer");
      const smtp = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        requireTLS: process.env.SMTP_SECURE !== "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
        connectionTimeout: 10000,
        socketTimeout: 20000,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      });
      const result = await smtp.sendMail(message);
      return {
        accepted: (result.accepted as (string | { address: string })[]).map(
          (a) => (typeof a === "string" ? a : a.address),
        ),
      };
    },
  };
}
export async function actionEmail(to: string, kind: string, token: string) {
  const url = new URL(kind === "reset" ? "/reset" : "/verify", config().appUrl);
  url.searchParams.set("token", token);
  await transport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_FROM,
    to,
    subject:
      kind === "reset"
        ? "soul · восстановление доступа"
        : "soul · подтверждение адреса",
    text: `${kind === "reset" ? "Изменить пароль" : "Подтвердить адрес"}: ${url}\nСсылка действует 30 минут. Если это были не вы, проигнорируйте письмо.`,
  });
}
