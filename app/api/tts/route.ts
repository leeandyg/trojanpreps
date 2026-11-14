// Returns audio for the interviewer's voice. Any non-200 makes the client
// fall back to the browser's built-in voice.
export async function POST(req: Request) {
  const { text } = await req.json();
  const provider = process.env.TTS_PROVIDER || "elevenlabs";
  const key = process.env.TTS_API_KEY;

  try {
    let upstream: Response | null = null;

    if (provider === "elevenlabs" && key) {
      const voice = process.env.TTS_VOICE || "JBFqnCBsd6RMkjVDRZzb";
      upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: { "xi-api-key": key || "", "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: process.env.TTS_MODEL || "eleven_flash_v2_5" }),
      });
    }

    if (!upstream) return new Response(null, { status: 204 });
    if (!upstream.ok) {
      console.error("tts upstream error", upstream.status, await upstream.text());
      return new Response(null, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg" },
    });
  } catch (e) {
    console.error("tts error", e);
    return new Response(null, { status: 502 });
  }
}
