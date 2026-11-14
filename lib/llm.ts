import OpenAI from "openai";

export async function chatJSON<T>(system: string, user: string, temperature = 0.3): Promise<T> {
  const client = new OpenAI({
    baseURL: process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.LLM_API_KEY,
  });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL || "gemini-3.5-flash-lite",
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return JSON.parse(res.choices[0].message.content || "{}") as T;
}
