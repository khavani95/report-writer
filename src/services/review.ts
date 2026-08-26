import { getDayConversation, listWorkers } from "@/db/queries";
import { extractDay } from "@/ai/day";
import { namesMatch } from "@/lib/text-normalize";
import {
  writeDayData,
  loadDaySummary,
  deterministicGaps,
  type DaySummary,
} from "./consolidate";

export interface ReviewResult {
  summary: DaySummary;
  questions: string[];
  complete: boolean;
  /** سرویس هوش مصنوعی پاسخ نداد؛ فقط ورود/خروجِ قطعی استخراج شد */
  aiFailed: boolean;
}

/**
 * کل مکالمه‌ی روز (به‌علاوه‌ی پاسخ‌های تکمیلی) را یک‌بار به AI می‌دهد،
 * داده را می‌نویسد و فهرست سؤال‌های باقی‌مانده را برمی‌گرداند.
 */
export async function runExtraction(
  projectId: number,
  workDayId: number,
  opts?: { changes?: string[]; deletions?: string[] },
): Promise<ReviewResult> {
  const conversation = await getDayConversation(workDayId);
  const known = (await listWorkers(projectId)).map((w) => w.fullName);

  const changes = opts?.changes ?? [];
  const deletions = opts?.deletions ?? [];

  let convo = conversation;
  if (changes.length) {
    convo += "\n\n[اصلاحیه‌های سرکارگر روی گزارش:]\n" + changes.join("\n");
  }
  if (deletions.length) {
    convo +=
      "\n\n[این نفرات در گزارش نیایند (سرکارگر حذفشان کرد): " +
      deletions.join("، ") +
      "]";
  }

  const { data, aiFailed } = await extractDay(convo, known);

  // حذف قطعی نیروهای حذف‌شده (چه از فهرست نیروها، چه از فعالیت‌ها)
  if (deletions.length) {
    data.workers = data.workers.filter(
      (w) => !deletions.some((d) => namesMatch(d, w.name)),
    );
    for (const a of data.activities) {
      a.workers = (a.workers ?? []).filter(
        (nm) => !deletions.some((d) => namesMatch(d, nm)),
      );
    }
  }

  // با شکست AI، فعالیت‌ها/موانع/دوباره‌کاری‌های ثبت‌شده دست‌نخورده می‌مانند
  await writeDayData(projectId, workDayId, data, { keepNonAttendance: aiFailed });

  const summary = await loadDaySummary(workDayId);
  const questions = deterministicGaps(summary);
  return { summary, questions, complete: questions.length === 0, aiFailed };
}

/** فقط وضعیت فعلی را از دیتابیس می‌خواند (بدون فراخوانی AI) */
export async function currentGaps(workDayId: number): Promise<ReviewResult> {
  const summary = await loadDaySummary(workDayId);
  const questions = deterministicGaps(summary);
  return {
    summary,
    questions,
    complete: questions.length === 0,
    aiFailed: false,
  };
}
