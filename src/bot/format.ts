import type { ExtractedEventItem } from "@/ai/schema";
import type {
  DaySummary,
  AttendanceRow,
  ActivityRow,
} from "@/services/consolidate";
import { humanDuration } from "@/services/attendance-calc";
import { toFaDigits } from "@/lib/jalali";
import type { WorkDay } from "@/db/schema";

/** مدت‌زمان با ارقام فارسی، هم‌شکل با بقیه‌ی متن‌های بات */
function dur(minutes: number): string {
  return toFaDigits(humanDuration(minutes));
}

/** کارت یک نیرو برای مرور پایان روز */
export function formatWorkerCard(
  a: AttendanceRow,
  index: number,
  total: number,
): string {
  const profile = [a.trade, a.employmentType].filter(Boolean).join("، ") || "—";
  const time =
    a.entry || a.exit
      ? `${a.entry ? toFaDigits(a.entry) : "—"} تا ${a.exit ? toFaDigits(a.exit) : "—"}`
      : "—";
  const work =
    a.dayFraction >= 1
      ? "۱ روز کامل"
      : a.workedMinutes
        ? dur(a.workedMinutes)
        : "—";
  const ot = a.overtimeMinutes ? ` (+${dur(a.overtimeMinutes)} اضافه‌کاری)` : "";
  const acts =
    a.assignedActivityMinutes || a.hasActivity ? "" : "\n⚠️ بدون فعالیت ثبت‌شده";
  return (
    `👷 نیرو ${toFaDigits(index + 1)} از ${toFaDigits(total)}\n\n` +
    `▪️ نام: ${a.name}\n` +
    `▪️ تخصص/نوع: ${profile}\n` +
    `▪️ ساعت: ${time}\n` +
    `▪️ کارکرد: ${work}${ot}${acts}`
  );
}

/** کارت فعالیت‌ها */
export function formatActivitiesCard(activities: ActivityRow[]): string {
  if (!activities.length) return "🏗️ فعالیت‌ها:\n— هیچ فعالیتی ثبت نشده.";
  const lines = activities.map((a) => {
    const time = a.isFullDay
      ? "تمام‌روز"
      : a.startTime && a.endTime
        ? `${toFaDigits(a.startTime)}–${toFaDigits(a.endTime)}`
        : "بدون زمان";
    const who = a.workers.length ? ` — ${a.workers.join("، ")}` : "";
    return `• ${a.workFront ? a.workFront + ": " : ""}${a.description} (${time})${who}`;
  });
  return "🏗️ فعالیت‌ها:\n" + lines.join("\n");
}

/** کارت موانع و دوباره‌کاری */
export function formatIssuesReworkCard(s: DaySummary): string {
  const parts: string[] = [];
  if (s.issues.length) {
    parts.push("⚠️ موانع/مشکلات:");
    for (const i of s.issues) parts.push(`• ${i.type}: ${i.description}`);
  }
  if (s.reworks.length) {
    parts.push("🔁 دوباره‌کاری‌ها:");
    for (const r of s.reworks)
      parts.push(
        `• ${r.workFront ? r.workFront + " — " : ""}${r.description}${r.cause ? ` (علت: ${r.cause})` : ""}`,
      );
  }
  if (!parts.length) parts.push("موانع یا دوباره‌کاری‌ای ثبت نشده.");
  return parts.join("\n");
}

/**
 * کارت پایانیِ نواقص: هرچه هنوز کم است، پیش از ثبت نهایی یک‌جا نشان داده می‌شود
 * تا نیرویی بدون فعالیت یا بدون ساعت در گزارش نماند.
 */
export function formatGapsCard(gaps: string[]): string {
  const lines = gaps.map((q, i) => `${toFaDigits(i + 1)}. ${q}`);
  return (
    `📝 چند مورد هنوز کامل نیست (${toFaDigits(gaps.length)}):\n\n` +
    lines.join("\n") +
    "\n\n«✏️ تکمیل» را بزن و همه را در یک پیام (متن یا ویس) جواب بده،\n" +
    "یا «✅ ثبت با همین نواقص» را بزن تا گزارش همین‌طور نهایی شود."
  );
}

/** خلاصه‌ی «چه چیزی فهمیدم» برای بازخورد آنیِ بعد از هر پیام */
export function formatAck(events: ExtractedEventItem[]): string {
  if (!events.length) return "✅ پیام ذخیره شد.";

  const lines: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case "attendance":
        lines.push(
          `🕒 ${e.event ?? "کارکرد"} ${e.workerName ?? ""}` +
            (e.time ? ` ساعت ${toFaDigits(e.time)}` : ""),
        );
        break;
      case "activity":
        lines.push(
          `🏗️ فعالیت${e.workFront ? ` (${e.workFront})` : ""}: ${e.description ?? e.activityType ?? ""}`,
        );
        break;
      case "issue":
        lines.push(`⚠️ ${e.issueType ?? "مشکل"}: ${e.description ?? ""}`);
        break;
      case "rework":
        lines.push(
          `🔁 دوباره‌کاری${e.workFront ? ` (${e.workFront})` : ""}: ${e.description ?? ""}`,
        );
        break;
      case "worker_new":
        lines.push(
          `➕ نیروی جدید: ${e.workerName ?? ""}${e.trade ? ` (${e.trade})` : ""}`,
        );
        break;
    }
  }
  if (!lines.length) return "✅ پیام ذخیره شد.";
  return "✅ ثبت شد:\n" + lines.join("\n");
}

/** خلاصه‌ی کامل روز برای نمایش قبل از/هنگام پایان روز */
export function formatDaySummary(day: WorkDay, s: DaySummary): string {
  const parts: string[] = [];
  parts.push(`📋 گزارش ${day.dateLabel}`);
  parts.push(`🔖 ${day.reportNo ?? ""}`);
  parts.push("");

  parts.push(`👷 نیروها (${toFaDigits(s.workerCount)} نفر):`);
  if (s.attendance.length) {
    for (const a of s.attendance) {
      const worked =
        a.dayFraction >= 1
          ? "۱ روز کامل"
          : a.workedMinutes
            ? dur(a.workedMinutes)
            : "—";
      const ot = a.overtimeMinutes ? ` + ${dur(a.overtimeMinutes)} اضافه‌کاری` : "";
      const hours =
        a.entry && a.exit
          ? ` [${toFaDigits(a.entry)}–${toFaDigits(a.exit)}]`
          : "";
      parts.push(`• ${a.name}: ${worked}${ot}${hours}`);
    }
  } else {
    parts.push("—");
  }

  if (s.activities.length) {
    parts.push("");
    parts.push("🏗️ فعالیت‌ها:");
    for (const a of s.activities) {
      const time = a.isFullDay
        ? " (تمام‌روز)"
        : a.startTime && a.endTime
          ? ` (${toFaDigits(a.startTime)}–${toFaDigits(a.endTime)})`
          : "";
      const who = a.workers.length ? `\n   👥 ${a.workers.join("، ")}` : "";
      parts.push(
        `• ${a.workFront ? a.workFront + " — " : ""}${a.description}${time}${who}`,
      );
    }
  }

  if (s.issues.length) {
    parts.push("");
    parts.push("⚠️ موانع/مشکلات:");
    for (const i of s.issues) parts.push(`• ${i.type}: ${i.description}`);
  }

  if (s.reworks.length) {
    parts.push("");
    parts.push("🔁 دوباره‌کاری‌ها:");
    for (const r of s.reworks)
      parts.push(
        `• ${r.workFront ? r.workFront + " — " : ""}${r.description}${r.cause ? ` (علت: ${r.cause})` : ""}`,
      );
  }

  return parts.join("\n");
}
