import { generateWithRetry } from "./gemini";

/**
 * پیاده‌سازی پیام صوتی به متن.
 * شکستش گزارش را از بین نمی‌برد: متن خالی برمی‌گردد و بات از عضو می‌خواهد
 * همان حرف را تایپ کند.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = "audio/ogg",
  /** نام اعضا و محل‌های شناخته‌شده — دقتِ رونویسیِ اسم‌های خاص را بالا می‌برد */
  hints: string[] = [],
): Promise<string> {
  const known = hints.length
    ? `\nاسم‌های خاصی که ممکن است در این پیام بیایند: ${hints.join("، ")}.`
    : "";
  try {
    // با تلاش دوباره: یک خطای گذرای ۵۰۳ نباید کل ویس را از بین ببرد
    const text = await generateWithRetry({
      systemInstruction:
        "تو رونویسِ دقیق پیام‌های صوتی فارسیِ کاری هستی. خروجی‌ات مستقیماً " +
        "به یک تحلیلگرِ متن داده می‌شود، پس قالبش مهم است.",
      temperature: 0,
      parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        {
          text:
            "این پیام صوتی فارسی را دقیق و کلمه‌به‌کلمه به متن فارسی تبدیل کن.\n" +
            "⚠️ ساعت‌ها را حتماً با رقم بنویس، نه با حرف: «ساعت ۹»، «ساعت ۹:۳۰»، «تا ۵».\n" +
            "نام محل‌ها و افراد را همان‌طور که شنیده می‌شود بنویس.\n" +
            "فقط خودِ متن را برگردان، بدون توضیح." +
            known,
        },
      ],
    });
    return text.trim();
  } catch (e) {
    console.error("transcribeAudio failed:", e);
    return "";
  }
}
