import { Type } from "@google/genai";
import { generateWithRetry } from "./gemini";
import { extractionResponseSchema, type ExtractedEventItem } from "./schema";
import { extractAttendanceFromText } from "./attendance-fallback";

const SYSTEM_INSTRUCTION = `تو دستیار ثبت گزارش روزانه‌ی یک کارگاه ساختمانی هستی.
از پیام (متنی یا صوتی) سرکارگر، همه‌ی داده‌ها را استخراج و در آرایه‌ی events برمی‌گردانی.

## کارکرد نیرو (خیلی مهم — دقت کن)
- برای هر نیرویی که ورود یا خروجش اعلام می‌شود، یک رویداد جداگانه با type="attendance" بساز.
- ⚠️ هیچ نیرویی را جا ننداز. اگر پیام چند خط یا چند نفر دارد، برای هرکدام یک رویداد جدا بده.
  اگر ۳ نفر در پیام هستند، باید دقیقاً ۳ رویداد attendance بدهی.
- کلمات «اومد، آمد، امد، اومدن، آمدند، اومدند، رسید، حاضر شد» یعنی event="ورود".
- کلمات «رفت، رفتن، رفتند، خارج شد، مرخص شد» یعنی event="خروج".
- ⚠️ هر وقت ساعتی گفته شده (مثل «ساعت ۸»)، حتماً فیلد time را با فرمت HH:MM (۲۴ساعته) پر کن.
  هیچ‌وقت وقتی ساعت در متن هست، time را خالی نگذار.
- تشخیص صبح/عصر:
  * ورود معمولاً صبح است: «۷ اومد» → 07:00 ، «۸ اومد» → 08:00.
  * خروج معمولاً بعدازظهر/عصر است: «۴ رفت» → 16:00 ، «۵ رفت» → 17:00 ، «۸ رفت» → 20:00.
  * «ظهر» ~12:00.
- workerName را دقیقاً همان نام و نام‌خانوادگیِ گفته‌شده بگذار (بدون تغییر).

## مثال (حتماً مثل این کامل جواب بده)
پیام:
«ایدین نوری ساعت ۸ اومد
محمد خوانی ساعت ۸ اومد
شایان مومن ساعت ۵ رفت»
خروجی درست:
events = [
  { type:"attendance", workerName:"ایدین نوری", event:"ورود", time:"08:00" },
  { type:"attendance", workerName:"محمد خوانی", event:"ورود", time:"08:00" },
  { type:"attendance", workerName:"شایان مومن", event:"خروج", time:"17:00" }
]

## انواع دیگر رویداد
- فعالیت اجرایی: type="activity" با workFront، activityType، description و workers
  (نام همه‌ی نیروهای درگیر را در workers بیاور). اگر زمان گفته شد startTime/endTime (HH:MM)
  و اگر تمام‌روز بود isFullDay=true.
- مانع/مشکل/تأخیر: type="issue" با issueType و description.
- دوباره‌کاری: type="rework" با workFront، amount، cause و description.
- نیروی جدید: type="worker_new" با workerName و trade.
- نامفهوم/بدون داده: type="other".

## قواعد کلی
- هر خط از پیام را جداگانه بررسی کن و مطمئن شو هیچ‌کس و هیچ داده‌ای جا نماند.
- چیزی از خودت نساز؛ فقط آنچه در پیام هست. اگر ساعت اصلاً گفته نشده، time را خالی بگذار
  (ولی اگر گفته شده، حتماً پرش کن).`;

interface ExtractInput {
  /** متن پیام (برای پیام متنی) */
  text?: string;
  /** صوت به‌صورت base64 (برای پیام صوتی) */
  audioBase64?: string;
  audioMimeType?: string;
  /** فهرست نام نیروهای شناخته‌شده برای کمک به تطبیق */
  knownWorkers?: string[];
}

export interface ExtractResult {
  events: ExtractedEventItem[];
  /** متن پیاده‌شده‌ی صوت (اگر ورودی صوتی بود) */
  transcript?: string;
}

/**
 * از متن یا صوت، رویدادهای گزارش را استخراج می‌کند.
 * صوت اول به متن پیاده می‌شود، سپس همان مسیر متنی اجرا می‌شود تا هر دو
 * از پارسر قطعیِ ورود/خروج هم بهره ببرند.
 */
export async function extractEvents(input: ExtractInput): Promise<ExtractResult> {
  let text = input.text ?? "";
  let transcript: string | undefined;

  if (input.audioBase64) {
    transcript = await transcribeAudio(
      input.audioBase64,
      input.audioMimeType || "audio/ogg",
    );
    text = transcript;
  }

  // لایه‌ی ۱: هوش مصنوعی (برای جمله‌های روان و انواع رویداد)
  const aiEvents = await aiExtractText(text, input.knownWorkers);
  // لایه‌ی ۲: پارسر قطعی ورود/خروج (تضمین عدم جا افتادن)
  const regexEvents = extractAttendanceFromText(text);

  return { events: mergeAttendance(aiEvents, regexEvents), transcript };
}

/** فراخوانی جِمِنای روی متن با اسکیمای ساختاریافته */
async function aiExtractText(
  text: string,
  knownWorkers?: string[],
): Promise<ExtractedEventItem[]> {
  if (!text.trim()) return [];

  const knownList =
    knownWorkers && knownWorkers.length
      ? `\n\nنیروهای شناخته‌شده‌ی این کارگاه: ${knownWorkers.join("، ")}.\nاگر نامی نزدیک به این‌هاست، همان نام استاندارد را برگردان.`
      : "";

  try {
    const raw = await generateWithRetry({
      systemInstruction: SYSTEM_INSTRUCTION,
      responseSchema: extractionResponseSchema,
      temperature: 0,
      parts: [{ text: `پیام سرکارگر:\n${text}${knownList}` }],
    });
    const parsed = JSON.parse(raw) as { events?: ExtractedEventItem[] };
    return parsed.events ?? [];
  } catch (e) {
    // خطای API (سهمیه/شبکه) نباید کل پیام را خراب کند؛ پارسر قطعی جبران می‌کند
    console.error("aiExtractText failed:", e);
    return [];
  }
}

/**
 * ادغام رویدادهای هوش مصنوعی و پارسر قطعی.
 * رویدادهای کارکردِ بدون داده حذف، و در تعارض، نسخه‌ای که «زمان» دارد نگه داشته می‌شود.
 */
function mergeAttendance(
  aiEvents: ExtractedEventItem[],
  regexEvents: ExtractedEventItem[],
): ExtractedEventItem[] {
  const norm = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();
  const key = (e: ExtractedEventItem) => `${norm(e.workerName)}|${e.event ?? ""}`;

  const attendance = new Map<string, ExtractedEventItem>();

  // فقط رویدادهای کارکردِ باارزش هوش مصنوعی (رویداد یا زمان داشته باشند)
  for (const e of aiEvents) {
    if (e.type === "attendance" && (e.event || e.time)) {
      attendance.set(key(e), e);
    }
  }
  // پارسر قطعی: اگر نبود اضافه کن؛ اگر نسخه‌ی قبلی زمان نداشت، جایگزین کن
  for (const e of regexEvents) {
    const k = key(e);
    const prev = attendance.get(k);
    if (!prev || (!prev.time && e.time)) attendance.set(k, e);
  }

  const nonAttendance = aiEvents.filter((e) => e.type !== "attendance");
  return [...attendance.values(), ...nonAttendance];
}

/**
 * فقط پیاده‌سازی صوت به متن (بدون استخراج) — برای موارد نیاز به متن خام.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = "audio/ogg",
): Promise<string> {
  try {
    // با تلاش دوباره: یک خطای گذرای ۵۰۳ نباید کل ویس را از بین ببرد
    const text = await generateWithRetry({
      systemInstruction:
        "تو رونویسِ دقیق پیام‌های صوتی فارسیِ کارگاه ساختمانی هستی.",
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

// ────────────────────────────────────────────────────────────
//  تحلیل جواب‌های «ویزارد کنترل پایان روز»
// ────────────────────────────────────────────────────────────

/** اجرای یک درخواست متنی با اسکیمای مشخص و برگرداندن JSON تحلیل‌شده */
async function parseWithSchema<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T> {
  try {
    const text = await generateWithRetry({
      systemInstruction:
        "تو دستیار استخراج داده‌ی ساختاریافته از متن فارسیِ کارگاه ساختمانی هستی.",
      responseSchema: schema,
      temperature: 0,
      parts: [{ text: prompt }],
    });
    return JSON.parse(text) as T;
  } catch (e) {
    console.error("parseWithSchema failed:", e);
    return {} as T;
  }
}

export interface ProfileAnswer {
  fullName?: string;
  trade?: string;
  employmentType?: "روزمزد" | "پیمانکار";
}

/** تحلیل پاسخ کاربر برای تکمیل پروفایل یک نیرو */
export function parseWorkerProfile(text: string): Promise<ProfileAnswer> {
  return parseWithSchema<ProfileAnswer>(
    `از این جمله، اطلاعات یک نیروی کارگاه را استخراج کن: «${text}».\n` +
      `- fullName: نام و نام‌خانوادگی کامل اگر گفته شده.\n` +
      `- trade: تخصص (مثل بنا، آرماتوربند، جوشکار، برقکار، کارگر ساده).\n` +
      `- employmentType: اگر روزمزد بود «روزمزد»، اگر پیمانکاری بود «پیمانکار».`,
    {
      type: Type.OBJECT,
      properties: {
        fullName: { type: Type.STRING, nullable: true },
        trade: { type: Type.STRING, nullable: true },
        employmentType: {
          type: Type.STRING,
          enum: ["روزمزد", "پیمانکار"],
          nullable: true,
        },
      },
    },
  );
}

export interface TimeAnswer {
  startTime?: string;
  endTime?: string;
  isFullDay?: boolean;
}

/** تحلیل پاسخ کاربر برای بازه‌ی زمانی یک فعالیت */
export function parseActivityTime(text: string): Promise<TimeAnswer> {
  return parseWithSchema<TimeAnswer>(
    `از این جمله بازه‌ی زمانی فعالیت را استخراج کن: «${text}».\n` +
      `- اگر تمام‌روز/کل روز/از صبح تا شب بود isFullDay=true.\n` +
      `- در غیر این صورت startTime و endTime را به‌صورت HH:MM ۲۴ساعته بده.\n` +
      `- «۸ تا ۴» یعنی startTime=08:00 و endTime=16:00.`,
    {
      type: Type.OBJECT,
      properties: {
        startTime: { type: Type.STRING, nullable: true },
        endTime: { type: Type.STRING, nullable: true },
        isFullDay: { type: Type.BOOLEAN, nullable: true },
      },
    },
  );
}

export interface EntryExitAnswer {
  entry?: string;
  exit?: string;
}

/** تحلیل پاسخ کاربر برای ساعت ورود و خروج یک نیرو */
export function parseEntryExit(
  text: string,
  workerName: string,
): Promise<EntryExitAnswer> {
  return parseWithSchema<EntryExitAnswer>(
    `ساعت ورود و خروج نیرویی به نام «${workerName}» را از این جمله استخراج کن: «${text}».\n` +
      `- entry: ساعت ورود (معمولاً صبح) به‌صورت HH:MM ۲۴ساعته.\n` +
      `- exit: ساعت خروج (معمولاً عصر) به‌صورت HH:MM ۲۴ساعته.\n` +
      `- «۷ تا ۵» یعنی entry=07:00 و exit=17:00. «۸ اومد ۸ رفت» یعنی entry=08:00 و exit=20:00.`,
    {
      type: Type.OBJECT,
      properties: {
        entry: { type: Type.STRING, nullable: true },
        exit: { type: Type.STRING, nullable: true },
      },
    },
  );
}

export interface CoverageAnswer {
  description?: string;
  workFront?: string;
  activityType?: string;
  startTime?: string;
  endTime?: string;
  isFullDay?: boolean;
}

/** تحلیل پاسخ کاربر برای فعالیتِ یک نیروی بدون فعالیت */
export function parseCoverageActivity(
  text: string,
  workerName: string,
): Promise<CoverageAnswer> {
  return parseWithSchema<CoverageAnswer>(
    `نیرویی به نام «${workerName}» امروز کاری انجام داده که هنوز ثبت نشده.\n` +
      `از این توضیح، فعالیتش را استخراج کن: «${text}».\n` +
      `- description: شرح فعالیت.\n` +
      `- workFront: محل/جبهه‌ی کاری.\n` +
      `- activityType: نوع فعالیت.\n` +
      `- اگر زمان گفته شد startTime/endTime (HH:MM) وگرنه اگر تمام‌روز بود isFullDay=true.`,
    {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, nullable: true },
        workFront: { type: Type.STRING, nullable: true },
        activityType: { type: Type.STRING, nullable: true },
        startTime: { type: Type.STRING, nullable: true },
        endTime: { type: Type.STRING, nullable: true },
        isFullDay: { type: Type.BOOLEAN, nullable: true },
      },
    },
  );
}
