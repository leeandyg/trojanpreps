import OpenAI from "openai";

const FAST_MODEL = process.env.LLM_MODEL || "gemini-3.5-flash-lite";
// Used for the report and redo grading, where quality matters more than latency.
export const REPORT_MODEL = process.env.REPORT_MODEL || FAST_MODEL;

export async function chatJSON<T>(system: string, user: string, temperature = 0.3, model = FAST_MODEL): Promise<T> {
  const client = new OpenAI({
    baseURL: process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.LLM_API_KEY,
  });
  const call = (m: string) =>
    client.chat.completions.create({
      model: m,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
  let res;
  try {
    res = await call(model);
  } catch (e) {
    if (model === FAST_MODEL) throw e;
    console.error(`model ${model} failed, falling back to ${FAST_MODEL}`, e);
    res = await call(FAST_MODEL);
  }
  return JSON.parse(res.choices[0].message.content || "{}") as T;
}
