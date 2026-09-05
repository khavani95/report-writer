import {
  getMemberByUser,
  listMembers,
  matchMemberByName,
  matchMembersByName,
  createMember,
  updateMember,
  findUnlinkedMemberByName,
  resolveMemberByName,
  getOpenDay,
  openDay,
  closeDay,
  reopenDay,
  staleOpenDays,
  getSegments,
  replaceSegments,
  getDayMessages,
  deleteLastRawMessage,
  saveRawMessage,
} from "@/db/queries";
import { toJalali, type JalaliInfo } from "@/lib/jalali";
import {
  applyEvents,
  buildSegments,
  parseMessage,
  splitLeadingName,
  isReportable,
  dayBounds,
  type Segment,
} from "@/ai/segments";
import { planDay } from "@/ai/day-plan";
import type { Member, MemberDay } from "@/db/schema";

/**
 * قواعدِ روزِ یک عضو: تشخیص صاحبِ گزارش، بازکردن روز، چسباندن پیام به
 * زنجیره، و نهایی‌کردن روز.
 */

export interface Target {
  member: Member;
  /** گزارش برای عضو دیگری ثبت شد (نه فرستنده) */
  onBehalf: boolean;
  /**
   * نام مبهم بود و به چند عضو می‌خورد؛ گزارش ثبت نشده و باید پرسید.
   */
  ambiguous: Member[] | null;
  /**
   * متنی که باید تحلیل شود.
   * وقتی گزارش برای دیگری است، نامِ ابتدای پیام از آن جدا شده؛ وگرنه همان
   * متنِ کامل است — تا جمله‌ای مثل «جلسه هیئت‌مدیره برگزار شد» دو واژه‌ی
   * اولش را از دست ندهد.
   */
  text: string;
}

/**
 * صاحبِ این گزارش کیست؟
 * اگر پیام با نام عضو دیگری شروع شود («ایدین امروز …») گزارش به او نسبت
 * داده می‌شود؛ وگرنه به فرستنده.
 */
export async function resolveTarget(
  chatId: number,
  sender: Member,
  text: string,
): Promise<Target> {
  const mine: Target = {
    member: sender,
    onBehalf: false,
    ambiguous: null,
    text,
  };

  // مقایسه با فهرست اعضا با قاعده‌ی سست انجام می‌شود؛ تطبیق با یک عضوِ
  // واقعی خودش ضامنِ درستی است.
  const loose = splitLeadingName(text, { strict: false });
  if (!loose.name) return mine;

  const roster = await listMembers(chatId);
  const matches = matchMembersByName(roster, loose.name);

  // «محمد» به دو عضو می‌خورد: نه حدس بزن، نه عضو سوم بساز — بپرس
  if (matches.length > 1 && !matches.some((m) => m.id === sender.id)) {
    return { ...mine, ambiguous: matches };
  }

  const matched = matches.length === 1 ? matches[0] : null;
  if (matched) {
    // نامِ خودِ فرستنده در ابتدای پیام یعنی همان فرستنده
    if (matched.id === sender.id) return { ...mine, text: loose.rest };
    return { member: matched, onBehalf: true, ambiguous: null, text: loose.rest };
  }

  // عضوِ ناشناس فقط با نشانه‌ی روشن ساخته می‌شود: فعلِ حرکتیِ سوم‌شخص.
  // بدون این شرط، هر جمله‌ای که با دو اسم شروع شود یک «عضو» جعلی می‌سازد.
  const strict = splitLeadingName(text);
  if (!strict.name) return mine;

  const created = await resolveMemberByName(chatId, strict.name, roster);
  return {
    member: created,
    onBehalf: true,
    ambiguous: null,
    text: strict.rest,
  };
}

/**
 * عضوِ متناظر با فرستنده. اگر قبلاً دیگری برایش گزارش داده باشد، به همان
 * ردیفِ «فقط نام» وصل می‌شود تا دو نفر نشوند.
 */
export async function linkSender(
  chatId: number,
  userId: number,
  telegramName: string,
): Promise<Member | null> {
  const existing = await getMemberByUser(chatId, userId);
  if (existing) return existing;

  const unlinked = telegramName
    ? await findUnlinkedMemberByName(chatId, telegramName)
    : null;
  if (unlinked) {
    await updateMember(unlinked.id, { userId });
    return { ...unlinked, userId };
  }
  return null;
}

/** ساخت عضو تازه پس از پرسیدن نام */
export async function registerMember(
  chatId: number,
  userId: number,
  rawName: string,
): Promise<Member> {
  // اگر کسی به‌جای نام یک گزارش کامل بفرستد، نام غول‌پیکر ذخیره نشود
  const fullName = rawName.trim().split(/\s+/).slice(0, 4).join(" ").slice(0, 60);
  const unlinked = await findUnlinkedMemberByName(chatId, fullName);
  if (unlinked) {
    await updateMember(unlinked.id, { userId, fullName });
    return { ...unlinked, userId, fullName };
  }
  return createMember({ chatId, userId, fullName });
}

export interface DayContext {
  day: MemberDay;
  /** روزهای قبلیِ بازمانده که همین حالا نهایی شدند */
  autoClosed: MemberDay[];
  /** روزِ امروز بسته بود و با همین پیام دوباره باز شد */
  reopened: boolean;
}

/**
 * روزِ امروزِ این عضو را برمی‌گرداند.
 *
 * اگر روزِ قبلی هنوز باز مانده باشد (عضو «پایان روز» را فراموش کرده)، بی‌صدا
 * نهایی می‌شود و روز تازه باز می‌شود — نه اینکه بات خطا بدهد و گیر کند.
 * نهایی‌کردنِ خودکار عمداً بدون هوش مصنوعی است: زنجیره‌ی آن روز پیام‌به‌پیام
 * نوشته شده و آماده است، و نباید نخستین پیامِ صبحِ عضو را پشتِ یک فراخوانیِ
 * کند نگه داشت.
 */
export async function ensureToday(
  member: Member,
  j: JalaliInfo = toJalali(),
): Promise<DayContext> {
  const stale = await staleOpenDays(member.id, j.key);
  if (stale.length) {
    await Promise.all(stale.map((d) => closeDay(d.id)));
  }
  const day = await openDay(member.id, j);

  // گزارشِ تکمیلی بعد از «پایان روز» نباید بی‌صدا به روزِ بسته بچسبد؛
  // وگرنه وضعیت روز با محتوایش نمی‌خواند.
  if (day.status === "closed") {
    await reopenDay(day.id);
    return {
      day: { ...day, status: "open", closedAt: null },
      autoClosed: stale,
      reopened: true,
    };
  }
  return { day, autoClosed: stale, reopened: false };
}

/**
 * یک پیام را به زنجیره‌ی روز اضافه می‌کند (مسیر قطعی، بدون هوش مصنوعی).
 * ذخیره‌ی پیام خام و به‌روزرسانی زنجیره با هم انجام می‌شود.
 */
export async function ingestMessage(
  day: MemberDay,
  text: string,
  meta: {
    senderUserId: number;
    kind: "text" | "voice";
    telegramMessageId?: number;
    telegramFileId?: string;
    /** متنِ اصلیِ پیام برای ردِ ممیزی (اگر با متنِ تحلیل فرق دارد) */
    rawText?: string;
  },
): Promise<Segment[]> {
  // پیامِ غیرگزارشی («سلام») نه ذخیره می‌شود نه به زنجیره می‌چسبد
  const { events } = parseMessage(text);
  if (!isReportable(events)) return [];

  const raw = meta.rawText ?? text;
  const [, current] = await Promise.all([
    saveRawMessage({
      memberDayId: day.id,
      senderUserId: meta.senderUserId,
      telegramMessageId: meta.telegramMessageId,
      kind: meta.kind,
      text: meta.kind === "text" ? raw : undefined,
      transcript: meta.kind === "voice" ? raw : undefined,
      telegramFileId: meta.telegramFileId,
    }),
    getSegments(day.id),
  ]);

  const next = applyEvents(current, events);
  await replaceSegments(day.id, next);
  return next;
}

export interface DayResult {
  segments: Segment[];
  start: string | null;
  end: string | null;
  aiFailed: boolean;
  aiIncomplete: boolean;
}

/**
 * کلِ روز را دوباره تحلیل می‌کند (پارسر قطعی + هوش مصنوعی) و می‌نویسد.
 * `close` روز را هم می‌بندد.
 */
export async function buildDay(
  day: MemberDay,
  opts?: { close?: boolean },
): Promise<DayResult> {
  const messages = await getDayMessages(day.id);
  const plan = await planDay(messages);

  // پاسخِ بی‌اعتمادِ AI نباید داده‌ی نوشته‌شده را پاک کند
  if (plan.aiFailed && !plan.segments.length) {
    const current = await getSegments(day.id);
    if (current.length) {
      const bounds = dayBounds(current);
      if (opts?.close) await closeDay(day.id);
      return { segments: current, ...bounds, aiFailed: true, aiIncomplete: false };
    }
  }

  await replaceSegments(day.id, plan.segments);
  if (opts?.close) await closeDay(day.id);

  return {
    segments: plan.segments,
    ...dayBounds(plan.segments),
    aiFailed: plan.aiFailed,
    aiIncomplete: plan.aiIncomplete,
  };
}

/**
 * برگرداندن آخرین ثبتِ همین روز.
 *
 * چون پیام‌های خام منبع حقیقت‌اند و زنجیره از رویشان ساخته می‌شود، «برگشت»
 * یعنی حذف آخرین پیام و ساختنِ دوباره‌ی زنجیره از بقیه — نتیجه دقیقاً همان
 * چیزی است که اگر آن پیام فرستاده نشده بود. پس به پشته‌ی undo نیازی نیست.
 *
 * ⚠️ بازسازی قطعی است؛ شرح‌هایی که هوش مصنوعی در /report روان کرده بود از
 * بین می‌روند و با /report دوباره ساخته می‌شوند.
 */
export async function undoLast(
  day: MemberDay,
): Promise<DayResult & { removed: boolean }> {
  const removed = await deleteLastRawMessage(day.id);
  if (!removed) return { ...(await readDay(day)), removed: false };

  const messages = await getDayMessages(day.id);
  const segments = buildSegments(messages);
  await replaceSegments(day.id, segments);
  return {
    segments,
    ...dayBounds(segments),
    aiFailed: false,
    aiIncomplete: false,
    removed: true,
  };
}

/** خواندنِ وضعیت فعلیِ روز، بدون فراخوانی هوش مصنوعی */
export async function readDay(day: MemberDay): Promise<DayResult> {
  const segments = await getSegments(day.id);
  return {
    segments,
    ...dayBounds(segments),
    aiFailed: false,
    aiIncomplete: false,
  };
}

/** روزِ بازِ عضو، اگر باشد */
export async function currentOpenDay(member: Member): Promise<MemberDay | null> {
  return getOpenDay(member.id);
}
