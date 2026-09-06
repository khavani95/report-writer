import {
  listChatIds,
  openDaysOfChat,
  closeDays,
  segmentsOfDays,
} from "@/db/queries";
import { dayBounds } from "@/ai/segments";
import { toJalali, toFaDigits } from "@/lib/jalali";
import { MSG } from "@/bot/text";
import { getBot } from "@/bot";
import { describeError } from "@/lib/log";
import { config } from "@/lib/config";

/**
 * کارهای زمان‌بندی‌شده‌ی روزانه.
 *
 * ⚠️ عمداً بدون هوش مصنوعی: بستن روزِ چند عضو یعنی چند فراخوانی، و هر
 * فراخوانی تا ۲۰ ثانیه بودجه می‌خواهد — از سقف ۶۰ ثانیه‌ی تابع رد می‌شود.
 * زنجیره‌ی هر روز پیام‌به‌پیام و به‌صورت قطعی نوشته شده و آماده است.
 */

/** فقط چت‌های مجاز (اگر فهرست مجاز خالی باشد، همه) */
function allowed(chatIds: number[]): number[] {
  const allow = config.telegram.allowedChatIds;
  if (!allow.length) return chatIds;
  return chatIds.filter((id) => allow.includes(String(id)));
}

/** یک خط از جمع‌بندی شبانه برای هر عضو */
function summaryLine(name: string, start: string | null, end: string | null) {
  if (!start && !end) return `▪️ ${name} — بدون ساعت`;
  const s = start ? toFaDigits(start) : "؟";
  const e = end ? toFaDigits(end) : "؟";
  return `▪️ ${name} — ${s} تا ${e}`;
}

export interface CloseResult {
  chats: number;
  days: number;
}

/**
 * بستنِ روزِ همه‌ی اعضا و فرستادنِ یک جمع‌بندی برای هر گروه.
 * یک پیام به‌جای ده‌ها تأییدیه.
 */
export async function closeAllDays(): Promise<CloseResult> {
  const bot = getBot();
  const today = toJalali();
  const chatIds = allowed(await listChatIds());
  let days = 0;

  for (const chatId of chatIds) {
    try {
      const open = await openDaysOfChat(chatId, today.key);
      if (!open.length) continue;

      const ids = open.map((d) => d.dayId);
      const segments = await segmentsOfDays(ids);
      const lines = open.map((d) => {
        const { start, end } = dayBounds(segments.get(d.dayId) ?? []);
        return summaryLine(d.memberName, start, end);
      });

      await closeDays(ids);
      days += ids.length;
      await bot.api.sendMessage(
        chatId,
        MSG.nightSummary(open[0].dateLabel, lines),
        { disable_notification: true },
      );
    } catch (e) {
      console.error(`[cron] بستن روزِ چت ${chatId} ناموفق:`, describeError(e));
    }
  }

  return { chats: chatIds.length, days };
}

/** پیام صبحگاهی + یادآوری قالب گزارش */
export async function greetChats(): Promise<{ chats: number }> {
  const bot = getBot();
  const today = toJalali();
  const chatIds = allowed(await listChatIds());

  for (const chatId of chatIds) {
    try {
      await bot.api.sendMessage(chatId, MSG.goodMorning(today.label));
    } catch (e) {
      console.error(`[cron] پیام صبحگاهیِ چت ${chatId} ناموفق:`, describeError(e));
    }
  }
  return { chats: chatIds.length };
}
