import { expect, it } from "vitest";
import gateway from "../cloudflare/pages/public/_worker.js";
it("preserves authenticated mutations and private response cookies across the Pages service binding", async () => {
  const request = new Request("https://soul.pages.dev/api/send", {
    method: "POST",
    headers: {
      Origin: "https://soul.pages.dev",
      Cookie: "soul_session=fixture",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subject: "Gateway test" }),
  });
  const response = await gateway.fetch(request, {
    SOUL_MAIL: {
      async fetch(forwarded: Request) {
        expect(forwarded.url).toBe("https://soul.pages.dev/api/send");
        expect(forwarded.method).toBe("POST");
        expect(forwarded.headers.get("origin")).toBe("https://soul.pages.dev");
        expect(forwarded.headers.get("cookie")).toBe("soul_session=fixture");
        expect(await forwarded.json()).toEqual({ subject: "Gateway test" });
        return new Response("private response", {
          status: 201,
          headers: {
            "Set-Cookie":
              "soul_session=next-fixture; HttpOnly; Secure; SameSite=Strict; Path=/",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("set-cookie")).toContain(
    "HttpOnly; Secure; SameSite=Strict",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe("private response");
});
it("reports unavailable backend without serving a false success or caching the failure", async () => {
  const missing = await gateway.fetch(
    new Request("https://soul.pages.dev/api/health"),
    {},
  );
  expect(missing.status).toBe(503);
  expect(missing.headers.get("cache-control")).toBe("no-store");
  const failed = await gateway.fetch(
    new Request("https://soul.pages.dev/api/health"),
    {
      SOUL_MAIL: {
        fetch: async () => {
          throw new Error("binding unavailable");
        },
      },
    },
  );
  expect(failed.status).toBe(503);
});
