import { toFaDigits } from "@/lib/jalali";
import type { Segment } from "@/ai/segments";
import type { Member, MemberDay } from "@/db/schema";

/** ساعت با ارقام فارسی */
function t(time: string | null): string {
  return time ? toFaDigits(time) : "—";
}

/** یک قطعه در یک خط: «۰۹:۰۰–۱۲:۰۰ | پروژه همت — شرح» */
function segmentLine(s: Segment): string {
  const time =
    s.startTime || s.endTime ? `${t(s.startTime)}–${t(s.endTime)}` : "بدون ساعت";
  const place = s.place ? ` ${s.place}` : "";
  const desc = s.description ? ` — ${s.description}` : "";
  return `▪️ ${time}${place}${desc}`;
}

/** گزارش روزانه‌ی یک عضو */
export function formatDayReport(
  member: Member,
  day: MemberDay,
  segments: Segment[],
  bounds: { start: string | null; end: string | null },
): string {
  const head =
    `📋 گزارش ${member.fullName}` +
    (member.role ? ` (${member.role})` : "") +
    `\n📅 ${day.dateLabel}`;

  if (!segments.length) {
    return `${head}\n\nهنوز چیزی ثبت نشده.`;
  }

  const body = segments.map(segmentLine).join("\n");
  const total = `\n\n🕘 شروع: ${t(bounds.start)}   🕕 پایان: ${t(bounds.end)}`;
  return `${head}\n\n${body}${total}`;
}

/**
 * تأییدِ کوتاهِ ثبت — بعد از هر پیام.
 * فقط آخرین وضعیتِ زنجیره را نشان می‌دهد تا عضو ببیند درست فهمیده شده.
 */
export function formatAck(segments: Segment[], onBehalfOf?: string): string {
  const last = segments[segments.length - 1];
  const who = onBehalfOf ? `📝 «${onBehalfOf}»: ` : "✅ ";
  if (!last) return `${who}ثبت شد.`;
  return `${who}${segmentLine(last).replace(/^▪️ /, "")}`;
}

/** فهرست اعضا */
export function formatMembers(list: Member[]): string {
  if (!list.length) return "هنوز عضوی ثبت نشده.";
  const lines = list.map((m, i) => {
    const role = m.role ? ` — ${m.role}` : "";
    const flag = m.userId ? "" : " ⚠️ (هنوز خودش پیام نداده)";
    return `${toFaDigits(i + 1)}. ${m.fullName}${role}${flag}`;
  });
  return `👥 اعضا (${toFaDigits(list.length)}):\n\n${lines.join("\n")}`;
}

/** پروفایل یک عضو */
export function formatProfile(member: Member): string {
  return (
    `👤 ${member.fullName}\n` +
    `▪️ سمت: ${member.role ?? "—"}\n\n` +
    "برای اصلاح: /me محمد خوانی — مدیرعامل"
  );
}
