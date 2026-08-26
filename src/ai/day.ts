import { Type } from "@google/genai";
import { getGemini } from "./gemini";
import { extractAttendanceFromText } from "./attendance-fallback";
import { findWorkerMatch } from "@/lib/text-normalize";
import { config } from "@/lib/config";

export interface DayWorker {
  name: string;
  trade?: string;
  employmentType?: "روزمزد" | "پیمانکار";
  entry?: string;
  exit?: string;
}
export interface DayActivity {
  workFront?: string;
  activityType?: string;
  description: string;
  workers: string[];
  startTime?: string;
  endTime?: string;
  isFullDay?: boolean;
}
export interface DayIssue {
  type?: "مانع" | "مشکل" | "تاخیر";
  description: string;
  impact?: string;
}
export interface DayRework {
  workFront?: string;
  amount?: string;
  cause?: string;
  description: string;
}
export interface DayData {
  workers: DayWorker[];
  activities: DayActivity[];
  issues: DayIssue[];
  reworks: DayRework[];
}
export interface DayExtraction {
  data: DayData;
  questions: string[];
  /**
   * فراخوانیِ هوش مصنوعی شکست خورد (سهمیه، شبکه، پاسخ نامعتبر).
   * در این حالت خروجی فقط از پارسر قطعیِ ورود/خروج می‌آید و فعالیت‌ها،
   * موانع و دوباره‌کاری‌ها معتبر نیستند؛ نباید داده‌ی قبلی را با آن‌ها بازنویسی کرد.
   */
  aiFailed: boolean;
}

const SYSTEM = `تو دستیار تهیه‌ی «گزارش روزانه‌ی کارگاه ساختمانی» هستی.
کلِ مکالمه‌ی یک روز کاری (پیام‌های متنی و متنِ پیاده‌شده‌ی ویس‌ها) به تو داده می‌شود.
وظیفه: کل روز را بفهم و داده‌ی ساختاریافته بساز، سپس برای کامل‌شدن گزارش سؤال بپرس.

استخراج:
- workers: هر نیرو با نام کامل، تخصص (trade)، نوع همکاری (employmentType: روزمزد یا پیمانکار)،
  ساعت ورود (entry) و خروج (exit) به‌صورت HH:MM ۲۴ساعته.
  «اومد/آمد/امد/رسید» = ورود ، «رفت» = خروج. «۸ اومد»→08:00 ، «۵ رفت»→17:00 ، «۸ رفت»→20:00.
  ⚠️ یکپارچه‌سازی نام (خیلی مهم): اگر بعداً فقط با نام کوچک (مثل «ایدین» یا «محمد») به کسی
  اشاره شد که قبلاً با نام کامل («آیدین نوری»، «محمد خوانی») معرفی شده، همان یک نفر است.
  او را فقط یک‌بار و با نام کامل بیاور و هرگز نامِ کوچک را جدا به‌عنوان نفر دوم نیاور.
  همچنین املای کمی متفاوت (آیدین/ایدین/یدین) هم یک نفر است.
  ⚠️ اگر سرکارگر گفت کسی را «حذف کن»، «اشتباه بود» یا «نیامد/نبود»، آن نفر را در خروجی نیاور.
- activities: هر فعالیت با محل (workFront)، نوع (activityType)، شرح (description)،
  نیروهای درگیر (workers: نام‌ها)، و زمان (startTime/endTime یا isFullDay برای تمام‌روز).
- issues: موانع/مشکلات/تأخیرات. reworks: دوباره‌کاری‌ها.

سؤال‌ها (questions) — به فارسی، کوتاه، محاوره‌ای، فقط برای موارد لازم:
- نیرویی که تخصص یا نوع همکاری‌اش نامشخص است.
- نیرویی که ساعت ورود یا خروجش گفته نشده.
- فعالیتی که زمانش (شروع/پایان یا تمام‌روز) مشخص نیست.
- نیرویی که حاضر بوده ولی به هیچ فعالیتی نسبت داده نشده.
اگر همه‌چیز کامل بود، questions را خالی برگردان.
چیزی از خودت نساز؛ فقط از مکالمه استخراج کن.`;

const daySchema = {
  type: Type.OBJECT,
  properties: {
    workers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          trade: { type: Type.STRING, nullable: true },
          employmentType: {
            type: Type.STRING,
            enum: ["روزمزد", "پیمانکار"],
            nullable: true,
          },
          entry: { type: Type.STRING, nullable: true },
          exit: { type: Type.STRING, nullable: true },
        },
        required: ["name"],
      },
    },
    activities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          workFront: { type: Type.STRING, nullable: true },
          activityType: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING },
          workers: { type: Type.ARRAY, items: { type: Type.STRING } },
          startTime: { type: Type.STRING, nullable: true },
          endTime: { type: Type.STRING, nullable: true },
          isFullDay: { type: Type.BOOLEAN, nullable: true },
        },
        required: ["description"],
      },
    },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            enum: ["مانع", "مشکل", "تاخیر"],
            nullable: true,
          },
          description: { type: Type.STRING },
          impact: { type: Type.STRING, nullable: true },
        },
        required: ["description"],
      },
    },
    reworks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          workFront: { type: Type.STRING, nullable: true },
          amount: { type: Type.STRING, nullable: true },
          cause: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING },
        },
        required: ["description"],
      },
    },
    questions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["workers", "activities", "issues", "reworks", "questions"],
};

const EMPTY: DayData = { workers: [], activities: [], issues: [], reworks: [] };

/**
 * کل مکالمه‌ی روز را با یک فراخوانی به AI تحلیل می‌کند و در کنارش
 * پارسر قطعی ورود/خروج را ادغام می‌کند تا هیچ کارکردی جا نماند.
 */
export async function extractDay(
  conversation: string,
  knownWorkers: string[] = [],
): Promise<DayExtraction> {
  let ai: DayExtraction = { data: EMPTY, questions: [], aiFailed: true };

  try {
    const client = getGemini();
    const known = knownWorkers.length
      ? `\n\nنیروهای شناخته‌شده‌ی کارگاه: ${knownWorkers.join("، ")}.`
      : "";
    const res = await client.models.generateContent({
      model: config.gemini.model,
      contents: [
        {
          role: "user",
          parts: [{ text: `مکالمه‌ی کل روز:\n${conversation}${known}` }],
        },
      ],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseSchema: daySchema,
        temperature: 0,
      },
    });
    const parsed = JSON.parse(res.text ?? "{}") as Partial<DayData> & {
      questions?: string[];
    };
    ai = {
      data: {
        workers: parsed.workers ?? [],
        activities: parsed.activities ?? [],
        issues: parsed.issues ?? [],
        reworks: parsed.reworks ?? [],
      },
      questions: parsed.questions ?? [],
      aiFailed: false,
    };
  } catch (e) {
    console.error("extractDay AI failed:", e);
  }

  // ادغام پارسر قطعی ورود/خروج (ستون فقرات مطمئن)
  mergeDeterministicAttendance(ai.data, conversation);
  return ai;
}

/**
 * ورود/خروج قطعی را روی داده‌ی AI سوار می‌کند.
 * اگر AI نیرو داده باشد، پارسر قطعی فقط ساعت‌های نیروهای موجود را پر می‌کند
 * (نیروی جدید نمی‌سازد) تا نامِ کوچک باعث تکرارِ نفر نشود.
 * فقط اگر AI هیچ نیرویی نداده (مثلاً خطای سهمیه)، به‌عنوان شبکه‌ی ایمنی می‌سازد.
 */
function mergeDeterministicAttendance(data: DayData, conversation: string) {
  const events = extractAttendanceFromText(conversation);
  const aiHadWorkers = data.workers.length > 0;
  for (const ev of events) {
    const name = (ev.workerName || "").trim();
    if (!name || !ev.time) continue;
    const idx = findWorkerMatch(
      name,
      data.workers.map((w) => [w.name]),
    );
    if (idx >= 0) {
      const w = data.workers[idx];
      if (ev.event === "ورود" && !w.entry) w.entry = ev.time;
      if (ev.event === "خروج" && !w.exit) w.exit = ev.time;
    } else if (!aiHadWorkers) {
      data.workers.push({
        name,
        entry: ev.event === "ورود" ? ev.time : undefined,
        exit: ev.event === "خروج" ? ev.time : undefined,
      });
    }
    // در غیر این صورت رد می‌کنیم تا نفر تکراری ساخته نشود
  }
}
