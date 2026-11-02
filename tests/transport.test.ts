import { afterEach, it, expect, vi } from "vitest";
import { transport } from "../src/lib/smtp";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function provider() {
  vi.stubEnv("RESEND_API_KEY", "mock-provider-key");
  vi.stubEnv("MAIL_FROM", "soul@example.com");
}
it("submits only external envelope recipients and base64 attachments to HTTPS mail API", async () => {
  provider();
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "provider-receipt" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  const r = await transport().sendMail({
    from: { name: "Mira", address: "mira@example.com" },
    to: ["internal@localhost", "outside@example.net"],
    envelope: { from: "mira@example.com", to: ["outside@example.net"] },
    subject: "Hi",
    text: "Body",
    messageId: "<stable@example.com>",
    attachments: [
      {
        filename: "note.txt",
        content: Buffer.from("hello"),
        contentType: "text/plain",
      },
    ],
  });
  expect(r.accepted).toEqual(["outside@example.net"]);
  const body = JSON.parse(fetch.mock.calls[0][1]?.body as string);
  expect(body.to).toEqual(["outside@example.net"]);
  expect(body.attachments[0].content).toBe(
    Buffer.from("hello").toString("base64"),
  );
});
it("does not report acceptance on provider errors", async () => {
  provider();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 403 })),
  );
  await expect(
    transport().sendMail({
      from: "soul@example.com",
      to: "a@example.net",
      text: "x",
    }),
  ).rejects.toThrow("не принял");
});
it("requires a real receipt before reporting provider acceptance", async () => {
  provider();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  await expect(
    transport().sendMail({
      from: "soul@example.com",
      to: "a@example.net",
      text: "x",
    }),
  ).rejects.toThrow("не подтвердил");
});
