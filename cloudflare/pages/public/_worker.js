// Pages provides the public hostname; the existing Worker runs Next.js and mail.
const unavailable = () =>
  new Response(
    "Почтовый сервис временно недоступен. Проверьте подключение Worker.",
    {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
export default {
  async fetch(request, env) {
    if (!env.SOUL_MAIL) return unavailable();
    try {
      // Preserve the original URL, Origin, cookies, body and response headers.
      // The backend's APP_URL must equal the confirmed Pages public origin.
      return await env.SOUL_MAIL.fetch(request);
    } catch {
      return unavailable();
    }
  },
};
