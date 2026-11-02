import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
const file = ".dev.vars";
if (!existsSync(file)) {
  const vars = existsSync(".env") ? parse(readFileSync(".env")) : {};
  if (!vars.DATABASE_URL)
    throw new Error("Configure the local development database first.");
  const allowed = [
    "DATABASE_URL",
    "MAIL_DOMAIN",
    "INBOUND_TOKEN",
    "REQUIRE_EMAIL_VERIFICATION",
    "RESEND_API_KEY",
    "MAIL_FROM",
    "SMTP_FROM",
    "ADMIN_EMAILS",
  ];
  const lines = [
    'APP_URL="http://localhost:8787"',
    ...allowed
      .filter((k) => vars[k])
      .map((k) => `${k}=${JSON.stringify(vars[k])}`),
  ];
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600, flag: "wx" });
}
const vars = parse(readFileSync(file));
const url = new URL(vars.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error(
    "This helper previews against a local development database only. Use Wrangler directly for an intentionally configured remote database.",
  );
const child = spawn(
  "npx",
  ["--no-install", "wrangler", "dev", "--port", "8787"],
  { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
