import "dotenv/config";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomBytes, createHash } from "node:crypto";
import { db } from "../../src/lib/db";
const origin = process.env.TEST_BASE_URL || "http://localhost:3000";
const headers = { Origin: origin };
const random = () => randomBytes(16).toString("hex");
async function account(r: APIRequestContext, label: string) {
  const handle = `${label}${randomBytes(5).toString("hex")}`,
    password = random();
  const response = await r.post("/api/auth/register", {
    headers,
    data: { handle, name: label, password },
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()).user, password };
}
test.afterAll(async () => {
  await db.$disconnect();
});
test("admin checks, account disabling, reports, domains and atomic draft sending", async ({
  playwright,
}) => {
  const admin = await playwright.request.newContext({ baseURL: origin }),
    member = await playwright.request.newContext({ baseURL: origin });
  const au = await account(admin, "operator"),
    mu = await account(member, "member");
  await db.user.update({ where: { id: au.id }, data: { role: "ADMIN" } });
  expect(
    (await member.patch("/api/me", { headers, data: { role: "ADMIN" } })).ok(),
  ).toBeTruthy();
  expect((await (await member.get("/api/me")).json()).user.role).toBe("USER");
  const draft = (
    await (
      await member.post("/api/drafts", {
        headers,
        data: {
          to: [au.email],
          subject: "Concurrent draft",
          body: "private body marker 741",
        },
      })
    ).json()
  ).entry;
  const sends = await Promise.all(
    [1, 2].map(() =>
      member.post("/api/send", {
        headers,
        data: {
          id: draft.id,
          to: [au.email],
          subject: "Concurrent draft",
          body: "private body marker 741",
        },
      }),
    ),
  );
  expect(sends.map((r) => r.status()).sort()).toEqual([200, 409]);
  const sent = (await (await member.get("/api/messages?folder=sent")).json())
    .entries;
  expect(sent).toHaveLength(1);
  expect((await admin.get(`/api/messages/${sent[0].id}`)).status()).toBe(404);
  expect(
    (
      await member.post("/api/reports", {
        headers,
        data: {
          category: "delivery",
          detail: "An operator-visible delivery report.",
        },
      })
    ).status(),
  ).toBe(201);
  const view = await (await admin.get("/api/admin")).json();
  expect(view.server.database).toBe("connected");
  expect(JSON.stringify(view)).not.toContain("private body marker 741");
  const report = view.reports.find(
    (r: { detail: string }) =>
      r.detail === "An operator-visible delivery report.",
  );
  expect(report).toBeTruthy();
  expect(
    (
      await admin.patch(`/api/admin/reports/${report.id}`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBeTruthy();
  const domainResponse = await member.post("/api/domains", {
    headers,
    data: { name: `${random()}.invalid` },
  });
  expect(domainResponse.status()).toBe(201);
  const domain = (await domainResponse.json()).domain;
  expect(
    (await admin.delete(`/api/domains/${domain.id}`, { headers })).status(),
  ).toBe(404);
  expect(
    (
      await member.post(`/api/domains/${domain.id}/verify`, {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(400);
  expect(
    (await member.delete(`/api/domains/${domain.id}`, { headers })).ok(),
  ).toBeTruthy();
  expect(
    (
      await admin.patch(`/api/admin/users/${mu.id}`, {
        headers,
        data: { disabled: true },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await member.get("/api/me")).status()).toBe(401);
  expect(
    (
      await member.post("/api/auth/login", {
        headers,
        data: { email: mu.email, password: mu.password },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await admin.patch(`/api/admin/users/${mu.id}`, {
        headers,
        data: { disabled: false },
      })
    ).ok(),
  ).toBeTruthy();
  await admin.dispose();
  await member.dispose();
});
test("one-time verification and reset tokens revoke sessions and cannot be replayed", async ({
  playwright,
}) => {
  const client = await playwright.request.newContext({ baseURL: origin });
  const user = await account(client, "recover");
  const token = randomBytes(32).toString("hex"),
    hash = createHash("sha256").update(token).digest("hex");
  await db.actionToken.create({
    data: {
      userId: user.id,
      kind: "verify",
      hash,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect(
    (await client.post("/api/auth/verify", { headers, data: { token } })).ok(),
  ).toBeTruthy();
  expect(
    (
      await client.post("/api/auth/verify", { headers, data: { token } })
    ).status(),
  ).toBe(400);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: user.id } })).verifiedAt,
  ).not.toBeNull();
  const reset = randomBytes(32).toString("hex");
  await db.actionToken.create({
    data: {
      userId: user.id,
      kind: "reset",
      hash: createHash("sha256").update(reset).digest("hex"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const password = random();
  expect(
    (
      await client.post("/api/auth/reset", {
        headers,
        data: { token: reset, password },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await client.get("/api/me")).status()).toBe(401);
  expect(
    (
      await client.post("/api/auth/reset", {
        headers,
        data: { token: reset, password },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await client.post("/api/auth/login", {
        headers,
        data: { email: user.email, password },
      })
    ).ok(),
  ).toBeTruthy();
  const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  expect(stored.passwordHash).not.toContain(password);
  await client.dispose();
});
test("inbound gateway authenticates and deduplicates actual PostgreSQL delivery", async ({
  playwright,
}) => {
  test.skip(!process.env.INBOUND_TOKEN, "No inbound gateway key configured.");
  const client = await playwright.request.newContext({ baseURL: origin });
  const u = await account(client, "inbound");
  const payload = {
    eventId: `test-${random()}`,
    from: "sender@example.net",
    to: [u.email],
    subject: "Inbound message",
    text: "Gateway normalized plain text.",
  };
  expect(
    (await client.post("/api/mail/inbound", { data: payload })).status(),
  ).toBe(401);
  const auth = { Authorization: `Bearer ${process.env.INBOUND_TOKEN}` };
  const first = await client.post("/api/mail/inbound", {
    headers: auth,
    data: payload,
  });
  expect(first.ok()).toBeTruthy();
  const second = await client.post("/api/mail/inbound", {
    headers: auth,
    data: payload,
  });
  expect((await second.json()).duplicate).toBe(true);
  const inbox = (await (await client.get("/api/messages?folder=inbox")).json())
    .entries;
  expect(inbox).toHaveLength(1);
  expect(inbox[0].message.body).toBe(payload.text);
  await client.dispose();
});
