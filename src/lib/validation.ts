import { z } from "zod";
export const address = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine(
    (v) =>
      z.email().safeParse(v).success || /^[a-z0-9._+-]+@localhost$/.test(v),
    "Некорректный адрес email.",
  );
export const password = z
  .string()
  .min(12, "Пароль должен содержать минимум 12 символов.")
  .max(128);
export const registerSchema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9._-]{2,31}$/,
      "Имя: 3–32 символа, латиница, цифры, . _ -",
    ),
  name: z.string().trim().min(1).max(80),
  password,
  recoveryEmail: z.union([address, z.literal("")]).optional(),
});
export const composeSchema = z.object({
  id: z.string().optional(),
  to: z.array(address).max(30),
  cc: z.array(address).max(30).default([]),
  subject: z.string().max(200),
  body: z.string().max(50000),
  attachments: z.array(z.string()).max(5).default([]),
});
export const sendSchema = composeSchema
  .refine((v) => v.to.length > 0, "Добавьте получателя.")
  .refine((v) => v.subject.trim().length > 0, "Добавьте тему.");
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  signature: z.string().max(1000).optional(),
  notifications: z.boolean().optional(),
});
export const allowedTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
]);
export function validFile(data: Buffer, type: string) {
  if (type === "image/png")
    return data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (type === "image/webp")
    return (
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP"
    );
  if (type === "application/pdf")
    return data.toString("ascii", 0, 5) === "%PDF-";
  if (type === "text/plain")
    return !data.includes(0) && !data.toString("utf8").includes("\uFFFD");
  return false;
}
