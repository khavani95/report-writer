import { generateWithRetry } from "./gemini";

/**
 * پیاده‌سازی پیام صوتی به متن.
 * شکستش گزارش را از بین نمی‌برد: متن خالی برمی‌گردد و بات از عضو می‌خواهد
 * همان حرف را تایپ کند.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = "audio/ogg",
): Promise<string> {
  try {
    // با تلاش دوباره: یک خطای گذرای ۵۰۳ نباید کل ویس را از بین ببرد
    const text = await generateWithRetry({
      systemInstruction:
        "تو رونویسِ دقیق پیام‌های صوتی فارسیِ کاری هستی.",
      temperature: 0,
      parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        {
          text: "این پیام صوتی فارسی را دقیق و کلمه‌به‌کلمه به متن فارسی تبدیل کن. فقط متن را برگردان.",
        },
      ],
    });
    return text.trim();
  } catch (e) {
    console.error("transcribeAudio failed:", e);
    return "";
  }
}
