/**
 * مهلتِ تکیِ فراخوانی Gemini.
 * بدون این، یک تماسِ گیرکرده کل بودجه‌ی وبهوک را می‌خورد و تابع سرورلس
 * کشته می‌شود؛ در گروه واقعی یک پیام صوتی به همین دلیل بی‌جواب ماند.
 */
process.env.GEMINI_API_KEY = "test-key";

import test from "node:test";
import assert from "node:assert/strict";
import { getGemini, generateWithRetry } from "../src/ai/gemini";

test("هر فراخوانی Gemini با AbortSignal مهلت‌دار فرستاده می‌شود", async () => {
  const client = getGemini();
  const seen: Array<Record<string, unknown>> = [];
  const original = client.models.generateContent;

  // خطای ۴۰۰ تکرارشدنی نیست، پس حلقه سریع تمام می‌شود
  client.models.generateContent = (async (req: Record<string, unknown>) => {
    seen.push(req);
    throw new Error('{"error":{"code":400,"message":"bad request"}}');
  }) as unknown as typeof client.models.generateContent;

  try {
    await assert.rejects(
      generateWithRetry({ systemInstruction: "تست", parts: [{ text: "سلام" }] }),
    );
  } finally {
    client.models.generateContent = original;
  }

  assert.ok(seen.length > 0, "دست‌کم یک تلاش انجام شد");
  for (const req of seen) {
    const config = req.config as { abortSignal?: AbortSignal };
    assert.ok(
      config.abortSignal instanceof AbortSignal,
      "فراخوانی بدون مهلت رفت",
    );
    assert.equal(config.abortSignal.aborted, false);
  }
});
