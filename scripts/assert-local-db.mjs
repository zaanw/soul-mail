import "dotenv/config";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing.");
const url = new URL(process.env.DATABASE_URL);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/soul" ||
  url.username !== "soul"
) {
  throw new Error(
    "Cloud onboarding only migrates the local soul development database. Configure other databases deliberately using README.",
  );
}
console.log("Confirmed local soul development database target.");
