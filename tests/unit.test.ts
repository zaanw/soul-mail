import { describe, it, expect } from "vitest";
import {
  registerSchema,
  sendSchema,
  composeSchema,
  validFile,
  password,
} from "../src/lib/validation";
import { normalizeAddress, isInternalAddress } from "../src/lib/config";
describe("account validation", () => {
  it("normalizes handles and recovery addresses", () => {
    const d = registerSchema.parse({
      handle: " Mira ",
      name: "Mira",
      password: "long enough password",
      recoveryEmail: "MIRA@example.com",
    });
    expect(d.handle).toBe("mira");
    expect(d.recoveryEmail).toBe("mira@example.com");
  });
  it.each(["ab", "admin@x", "../hello", "two words", "a".repeat(33)])(
    "rejects invalid handle %s",
    (handle) =>
      expect(
        registerSchema.safeParse({
          handle,
          name: "x",
          password: "long enough password",
        }).success,
      ).toBe(false),
  );
  it("rejects weak or oversized passwords", () => {
    expect(password.safeParse("short").success).toBe(false);
    expect(password.safeParse("x".repeat(129)).success).toBe(false);
  });
});
describe("mail validation", () => {
  it("allows empty drafts but requires recipient and subject for sending", () => {
    const d = { to: [], subject: "", body: "" };
    expect(composeSchema.safeParse(d).success).toBe(true);
    expect(sendSchema.safeParse(d).success).toBe(false);
  });
  it("rejects header injection in addresses and limits recipients", () => {
    expect(
      sendSchema.safeParse({
        to: ["victim@example.com\r\nBcc: other@example.com"],
        subject: "x",
        body: "x",
      }).success,
    ).toBe(false);
    expect(
      sendSchema.safeParse({
        to: Array(31).fill("a@example.com"),
        subject: "x",
        body: "",
      }).success,
    ).toBe(false);
  });
  it("normalizes and matches exact domains", () => {
    expect(normalizeAddress(" A@EXAMPLE.COM ")).toBe("a@example.com");
    expect(isInternalAddress("a@example.com.evil", "example.com")).toBe(false);
    expect(isInternalAddress("a@EXAMPLE.COM", "example.com")).toBe(true);
  });
  it("checks file signatures instead of trusting supplied MIME", () => {
    expect(
      validFile(Buffer.from("<script>alert(1)</script>"), "image/png"),
    ).toBe(false);
    expect(validFile(Buffer.from("%PDF-1.7\n"), "application/pdf")).toBe(true);
    expect(validFile(Buffer.from("hello\0"), "text/plain")).toBe(false);
    expect(validFile(Buffer.from("hello"), "text/plain")).toBe(true);
    expect(validFile(Buffer.from("<svg/>"), "image/svg+xml")).toBe(false);
  });
});
