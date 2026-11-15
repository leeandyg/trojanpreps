// Mints a short-lived Deepgram token so the browser can stream mic audio to
// Deepgram directly without ever seeing STT_API_KEY. Any non-200 makes the
// client fall back to Chrome's built-in recognizer.
export async function POST() {
  const key = process.env.STT_API_KEY;
  if (!key) return new Response(null, { status: 204 });
  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 60 }), // only needs to last until the socket opens
    });
    if (!res.ok) {
      console.error("stt token error", res.status, await res.text());
      return new Response(null, { status: 502 });
    }
    const { access_token } = await res.json();
    return Response.json({ token: access_token });
  } catch (e) {
    console.error("stt token error", e);
    return new Response(null, { status: 502 });
  }
}
