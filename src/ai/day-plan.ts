import { Type } from "@google/genai";
import { generateWithRetry } from "./gemini";
import { buildSegments, type DayMessage, type Segment } from "./segments";
import { timeToMinutes } from "@/services/time-parse";
import { normalizeName } from "@/lib/text-normalize";

/**
 * لایه‌ی هوش مصنوعی روی پارسر قطعی.
 *
 * پارسر قطعی همیشه اجرا می‌شود و نتیجه‌اش «کفِ» گزارش است؛ هوش مصنوعی فقط
 * شرح‌ها را روان‌تر و قطعه‌های جاافتاده را کامل می‌کند. اگر پاسخِ AI چیزی را
 * که پارسر پیدا کرده جا انداخته باشد، آن پاسخ «بی‌اعتماد» است و فقط
 * اجازه‌ی افزودن دارد — هرگز اجازه‌ی حذف.
 */

export interface DayPlan {
  segments: Segment[];
  /** فراخوانیِ هوش مصنوعی شکست خورد (سهمیه، شبکه، پاسخ نامعتبر) */
  aiFailed: boolean;
  /** پاسخ آمد ولی ناقص بود؛ زنجیره‌ی قطعی مبنا ماند */
  aiIncomplete: boolean;
}

const SYSTEM = `تو دستیار تهیه‌ی «گزارش فعالیت روزانه‌ی اعضای هیئت‌مدیره» هستی.
پیام‌های یک عضو در طول یک روز به تو داده می‌شود (به ترتیب زمانی).
وظیفه: روزِ او را به «قطعه‌های فعالیت» بشکن.

هر قطعه یعنی یک محل و کارهایی که آنجا انجام شده:
- place: محل فعالیت («پروژه همت»، «باغ موزه»، «دفتر مرکزی»). اگر گفته نشده، خالی بگذار.
- description: شرح کارهای انجام‌شده در آن محل، با همان واژه‌های خودِ عضو، روان و کوتاه.
- startTime و endTime: ساعت شروع و پایانِ همان قطعه، به‌صورت HH:MM و ۲۴ساعته.

قاعده‌های مهم:
- «رفتم/رفت» اگر مقصد داشته باشد یعنی جابه‌جایی به محل تازه (قطعه‌ی جدید):
  «ساعت ۱۲ رفتم پروژه باغ موزه» → قطعه‌ی تازه از ۱۲:۰۰ در باغ موزه.
- «رفتم/رفت» بدون مقصد یعنی ترک کردن و پایانِ قطعه: «ساعت ۷ رفتم» → endTime=19:00.
- ساعت‌های محاوره‌ای بعدازظهرند مگر خلافش گفته شود: «۵ رفتم»→17:00 ، «۸ اومدم»→08:00 ، «تا ۵»→17:00.
- ترتیب قطعه‌ها زمانی است و ساعت‌ها رو به جلو می‌روند.
- شرحِ بدون ساعت («صورت وضعیت رو رسیدگی کردم») به قطعه‌ی جاری می‌چسبد و قطعه‌ی تازه نمی‌سازد.
- چیزی از خودت اضافه نکن؛ فقط از پیام‌ها استخراج کن.
- پیام‌های غیرکاری را در شرح نیاور: احوال‌پرسی، تشکر، شوخی، و گفت‌وگوی
  بی‌ربط به کار. اگر روزی هیچ محتوای کاری نداشت، segments را خالی برگردان.`;

const planSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      description: "قطعه‌های فعالیت روز، به ترتیب زمانی",
      items: {
        type: Type.OBJECT,
        properties: {
          place: { type: Type.STRING, description: "محل فعالیت", nullable: true },
          description: { type: Type.STRING, description: "شرح کارهای انجام‌شده" },
          startTime: { type: Type.STRING, description: "HH:MM", nullable: true },
          endTime: { type: Type.STRING, description: "HH:MM", nullable: true },
        },
        required: ["description"],
      },
    },
  },
  required: ["segments"],
};

/** ساعتِ برگشتی از مدل را به HH:MM معتبر تبدیل می‌کند (وگرنه null) */
function safeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * زنجیره‌ی روزِ یک عضو را از روی پیام‌هایش می‌سازد.
 * همیشه پارسر قطعی اجرا می‌شود؛ هوش مصنوعی فقط رویش سوار می‌شود.
 */
export async function planDay(messages: DayMessage[]): Promise<DayPlan> {
  const deterministic = buildSegments(messages);
  const conversation = messages
    .map((m) => (typeof m === "string" ? m : m.text).trim())
    .filter(Boolean);
  if (!conversation.length) {
    return { segments: [], aiFailed: false, aiIncomplete: false };
  }

  let aiSegments: Segment[] | null = null;
  try {
    const text = await generateWithRetry({
      systemInstruction: SYSTEM,
      responseSchema: planSchema,
      temperature: 0,
      parts: [{ text: `پیام‌های امروزِ این عضو:\n${conversation.join("\n")}` }],
    });
    const parsed = JSON.parse(text) as {
      segments?: Array<Record<string, unknown>>;
    };
    aiSegments = (parsed.segments ?? [])
      .map((s) => ({
        place: typeof s.place === "string" && s.place.trim() ? s.place.trim() : null,
        description:
          typeof s.description === "string" ? s.description.trim() : "",
        startTime: safeTime(s.startTime),
        endTime: safeTime(s.endTime),
      }))
      .filter((s) => s.place || s.description || s.startTime || s.endTime);
  } catch (e) {
    console.error("planDay AI failed:", e);
  }

  if (!aiSegments) {
    return { segments: deterministic, aiFailed: true, aiIncomplete: false };
  }

  const { segments, incomplete } = mergePlans(deterministic, aiSegments);
  return { segments, aiFailed: false, aiIncomplete: incomplete };
}

/**
 * ادغام زنجیره‌ی قطعی با پاسخ هوش مصنوعی.
 *
 * برای هر قطعه‌ی قطعی، متناظرش در پاسخ AI پیدا می‌شود (بر اساس محل یا ساعت
 * شروع). اگر متناظری نبود، همان قطعه‌ی قطعی نگه داشته و پاسخ «ناقص» علامت
 * می‌خورد. قطعه‌های اضافیِ AI فقط وقتی می‌آیند که پارسر قطعی چیزی نیافته
 * باشد یا محلشان تازه باشد.
 */
export function mergePlans(
  deterministic: Segment[],
  ai: Segment[],
): { segments: Segment[]; incomplete: boolean } {
  if (!deterministic.length) {
    return { segments: ai, incomplete: false };
  }

  const used = new Set<number>();
  let incomplete = false;

  const merged: Segment[] = deterministic.map((det) => {
    const idx = ai.findIndex((a, i) => !used.has(i) && sameSegment(det, a));
    if (idx < 0) {
      incomplete = true;
      return { ...det };
    }
    used.add(idx);
    const a = ai[idx];
    return {
      // محل و ساعت‌های قطعی مرجع‌اند؛ AI فقط جای خالی را پر می‌کند
      place: det.place ?? a.place,
      description: a.description || det.description,
      startTime: det.startTime ?? a.startTime,
      endTime: det.endTime ?? a.endTime,
    };
  });

  // قطعه‌هایی که فقط AI دیده — افزودن مجاز است، حذف نه
  const extra = ai.filter((_, i) => !used.has(i));
  if (extra.length) {
    merged.push(...extra);
    merged.sort(byStartTime);
  }

  return { segments: merged, incomplete };
}

/** آیا این دو قطعه یک چیزند؟ (هم‌محل یا هم‌ساعتِ شروع) */
function sameSegment(a: Segment, b: Segment): boolean {
  if (a.place && b.place) {
    const na = normalizeName(a.place);
    const nb = normalizeName(b.place);
    if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  }
  if (a.startTime && a.startTime === b.startTime) return true;
  if (!a.place && !b.place && a.startTime === b.startTime) return true;
  return false;
}

/** مرتب‌سازی زمانی؛ قطعه‌ی بدون ساعت آخر می‌ماند */
function byStartTime(a: Segment, b: Segment): number {
  const ta = timeToMinutes(a.startTime) ?? Number.MAX_SAFE_INTEGER;
  const tb = timeToMinutes(b.startTime) ?? Number.MAX_SAFE_INTEGER;
  return ta - tb;
}
