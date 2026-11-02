import { getCloudflareContext } from "@opennextjs/cloudflare";
export async function domainTxt(name: string): Promise<string[][]> {
  let worker = false;
  try {
    getCloudflareContext();
    worker = true;
  } catch {}
  if (!worker) {
    const { resolveTxt } = await import("node:dns/promises");
    return resolveTxt(name);
  }
  if (name.endsWith(".invalid")) return [];
  const endpoint = new URL("https://cloudflare-dns.com/dns-query");
  endpoint.searchParams.set("name", name);
  endpoint.searchParams.set("type", "TXT");
  const result = await fetch(endpoint, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw new Error("DNS unavailable");
  const data = (await result.json()) as {
    Status: number;
    Answer?: { type: number; data: string }[];
  };
  if (data.Status !== 0) return [];
  return (data.Answer || [])
    .filter((a) => a.type === 16)
    .map((a) =>
      [...a.data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        m[1].replace(/\\(["\\])/g, "$1"),
      ),
    );
}
