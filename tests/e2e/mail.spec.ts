import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
const origin = process.env.TEST_BASE_URL || "http://localhost:3000";
const headers = { Origin: origin };
const password = () => randomBytes(24).toString("hex");
async function account(r: APIRequestContext, label: string) {
  const handle = `t${label}${randomBytes(6).toString("hex")}`;
  const pass = password();
  const response = await r.post("/api/auth/register", {
    headers,
    data: { handle, name: label, password: pass },
  });
  expect(response.status()).toBe(201);
  return { handle, password: pass, ...(await response.json()).user };
}
test("real PostgreSQL delivery, isolation, drafts, files, account security and honest external status", async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({ baseURL: origin }),
    b = await playwright.request.newContext({ baseURL: origin }),
    outsider = await playwright.request.newContext({ baseURL: origin });
  const alice = await account(a, "alice"),
    bob = await account(b, "bob");
  expect(
    (
      await a.post("/api/send", {
        headers: { Origin: "https://attacker.invalid" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await a.get("/api/admin")).status()).toBe(403);
  const upload = await a.post("/api/attachments", {
    headers: {
      ...headers,
      "Content-Type": "text/plain",
      "X-File-Name": "hello.txt",
    },
    data: Buffer.from("Private attachment"),
  });
  expect(upload.status()).toBe(201);
  const file = (await upload.json()).file;
  const badFile = await a.post("/api/attachments", {
    headers: { ...headers, "Content-Type": "image/png" },
    data: Buffer.from("<script>bad</script>"),
  });
  expect(badFile.status()).toBe(400);
  const draft = await a.post("/api/drafts", {
    headers,
    data: {
      to: [bob.email],
      subject: "A real message",
      body: "Hello from PostgreSQL. <script>alert(1)</script>",
      attachments: [file.id],
    },
  });
  expect(draft.ok()).toBeTruthy();
  const entry = (await draft.json()).entry;
  expect((await outsider.get(`/api/messages/${entry.id}`)).status()).toBe(401);
  expect((await b.get(`/api/attachments/${file.id}`)).status()).toBe(404);
  const send = await a.post("/api/send", {
    headers,
    data: {
      id: entry.id,
      to: [bob.email],
      subject: "A real message",
      body: "Hello from PostgreSQL. <script>alert(1)</script>",
      attachments: [file.id],
    },
  });
  expect(send.ok()).toBeTruthy();
  expect((await send.json()).deliveries[0].status).toBe("delivered");
  expect(
    (
      await a.post("/api/send", {
        headers,
        data: { id: entry.id, to: [bob.email], subject: "duplicate", body: "" },
      })
    ).status(),
  ).toBe(409);
  const inbox = await b.get("/api/messages?folder=inbox&q=A%20real%20message");
  const received = (await inbox.json()).entries;
  expect(received).toHaveLength(1);
  const id = received[0].id;
  expect((await (await b.get(`/api/messages/${id}`)).json()).entry.read).toBe(
    false,
  );
  expect(
    (await (await b.get("/api/messages?folder=inbox")).json()).entries[0].read,
  ).toBe(false);
  expect((await a.get(`/api/messages/${id}`)).status()).toBe(404);
  expect((await b.get(`/api/attachments/${file.id}`)).ok()).toBeTruthy();
  expect(
    (
      await b.patch(`/api/messages/${id}`, {
        headers,
        data: { starred: true, read: true },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await (await b.get("/api/messages?folder=starred")).json()).entries,
  ).toHaveLength(1);
  expect(
    (
      await b.patch(`/api/messages/${id}`, {
        headers,
        data: { folder: "archive" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await (await b.get("/api/messages?folder=inbox")).json()).entries,
  ).toHaveLength(0);
  expect(
    (await (await a.get("/api/messages?folder=sent")).json()).entries,
  ).toHaveLength(1);
  expect(
    (
      await b.patch(`/api/messages/${id}`, {
        headers,
        data: { folder: "trash" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await b.delete(`/api/messages/${id}`, { headers })).ok(),
  ).toBeTruthy();
  expect((await a.get(`/api/attachments/${file.id}`)).ok()).toBeTruthy();
  const caps = await (await a.get("/api/capabilities")).json();
  if (!caps.externalMail) {
    expect(
      (
        await a.post("/api/send", {
          headers,
          data: { to: ["outside@example.net"], subject: "not fake", body: "x" },
        })
      ).status(),
    ).toBe(503);
    expect(
      (
        await a.post("/api/auth/recover", {
          headers,
          data: { email: "x@example.net" },
        })
      ).status(),
    ).toBe(503);
  }
  expect(
    (
      await a.post("/api/send", {
        headers,
        data: {
          to: [`absent${randomBytes(4).toString("hex")}@${caps.domain}`],
          subject: "missing",
          body: "x",
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await a.patch("/api/me", {
        headers,
        data: {
          name: "Alice Updated",
          signature: "Stay human.",
          theme: "light",
          notifications: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await (await a.get("/api/me")).json()).user.signature).toBe(
    "Stay human.",
  );
  const a2 = await playwright.request.newContext({ baseURL: origin });
  expect(
    (
      await a2.post("/api/auth/login", {
        headers,
        data: { email: alice.email, password: alice.password },
      })
    ).ok(),
  ).toBeTruthy();
  const newPass = password();
  expect(
    (
      await a.post("/api/me/password", {
        headers,
        data: { current: alice.password, password: newPass },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await a2.get("/api/me")).status()).toBe(401);
  const cookie = (await a.storageState()).cookies.find(
    (c) => c.name === "soul_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  expect((await a.delete("/api/sessions", { headers })).ok()).toBeTruthy();
  expect((await a.get("/api/me")).status()).toBe(401);
  await Promise.all([
    a.dispose(),
    b.dispose(),
    outsider.dispose(),
    a2.dispose(),
  ]);
});
test("desktop interface: register, compose, save and reopen draft", async ({
  page,
}) => {
  const handle = `ui${randomBytes(6).toString("hex")}`;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "mail with a soul." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "get started" }).click();
  await page.getByLabel("Ваше имя", { exact: true }).fill("UI Writer");
  await page.locator("input[name=handle]").fill(handle);
  await page.getByLabel("Пароль", { exact: true }).fill(password());
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL("/mail");
  await page
    .getByRole("button", { name: "Новое письмо", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Кому", exact: true })
    .fill(`${handle}@localhost`);
  await page
    .getByRole("textbox", { name: "Тема", exact: true })
    .fill("Saved in the database");
  await page
    .getByRole("textbox", { name: "Текст письма" })
    .fill("A real draft.");
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await page.getByRole("button", { name: /Черновики/ }).click();
  await page.getByText("Saved in the database", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Текст письма" })).toHaveValue(
    "A real draft.",
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page.getByRole("button", { name: /Входящие/ }).click();
  await page.getByText("Saved in the database", { exact: true }).click();
  await expect(page.locator(".message-body")).toHaveText("A real draft.");
  await page.screenshot({
    path: "test-results/desktop-mail.png",
    fullPage: true,
  });
});
test("iPhone layout and full-screen composer", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const r = context.request;
  await account(r, "mobile");
  await page.goto("/mail");
  await expect(
    page.getByRole("button", { name: "Открыть меню" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Новое письмо", exact: true })
    .last()
    .click();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box?.width).toBe(390);
  await page.screenshot({ path: "test-results/iphone-compose.png" });
  await context.close();
});
