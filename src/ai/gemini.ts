import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";

let _client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return _client;
}

/**
 * کدهای خطای گذرا. ۵۰۳ («این مدل فعلاً تحت فشار زیاد است») رایج‌ترینشان است
 * و با یک تلاش دوباره‌ی کوتاه معمولاً حل می‌شود؛ بدون retry یک خطای لحظه‌ای
 * کل تحلیل روز را از بین می‌برد.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * فاصله‌ی بین تلاش‌ها (میلی‌ثانیه) — ۳ تلاش برای هر مدل.
 * عمداً کوتاه است: وقتی مدل واقعاً شلوغ است، سقوط به مدل پشتیبان
 * مؤثرتر از تلاش‌های بیشتر روی همان مدل است و بودجه‌ی ۵۵ ثانیه‌ایِ
 * وبهوک تلگرام هم باید رعایت شود.
 */
const BACKOFF_MS = [600, 1500];

function statusOf(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const s = (e as { status?: unknown }).status;
  if (typeof s === "number") return s;
  // پیام خطای SDK گاهی JSON خام است: {"error":{"code":503,...}}
  const msg = (e as { message?: unknown }).message;
  if (typeof msg === "string") {
    const m = msg.match(/"code"\s*:\s*(\d{3})/);
    if (m) return Number(m[1]);
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GenerateOptions {
  systemInstruction: string;
  responseSchema?: unknown;
  temperature?: number;
  /** بخش‌های پیام کاربر (متن یا صوت) */
  parts: unknown[];
}

/**
 * یک فراخوانیِ Gemini با تلاش دوباره روی خطاهای گذرا و در پایان،
 * سقوط به مدل پشتیبان. متن پاسخ را برمی‌گرداند؛ در صورت شکست خطا پرتاب می‌کند.
 */
export async function generateWithRetry(
  opts: GenerateOptions,
): Promise<string> {
  const client = getGemini();
  const models = [
    ...new Set([config.gemini.model, ...config.gemini.fallbackModels]),
  ];

  let lastError: unknown = new Error("gemini: هیچ تلاشی انجام نشد");

  for (const model of models) {
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        const res = await client.models.generateContent({
          model,
          contents: [
            { role: "user", parts: opts.parts as never },
          ],
          config: {
            systemInstruction: opts.systemInstruction,
            responseMimeType: opts.responseSchema
              ? "application/json"
              : undefined,
            responseSchema: opts.responseSchema as never,
            temperature: opts.temperature ?? 0,
          },
        });
        const text = res.text;
        // پاسخ خالی هم شکست است؛ وگرنه به‌جای داده، «هیچ» می‌نویسیم
        if (!text || !text.trim()) {
          throw new Error("gemini: پاسخ خالی برگشت");
        }
        return text;
      } catch (e) {
        lastError = e;
        const status = statusOf(e);
        const canRetry = status === null || RETRYABLE.has(status);
        if (!canRetry || attempt === BACKOFF_MS.length) break;
        console.warn(
          `[gemini] ${model} خطای گذرا (${status ?? "نامشخص"})؛ تلاش ${attempt + 2}…`,
        );
        await sleep(BACKOFF_MS[attempt]);
      }
    }
    console.warn(`[gemini] ${model} جواب نداد؛ مدل بعدی امتحان می‌شود.`);
  }

  throw lastError;
}
