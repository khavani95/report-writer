import { Bot, InputFile, type Context } from "grammy";
import { config } from "@/lib/config";
import { describeError } from "@/lib/log";
import {
  COMMANDS,
  MSG,
  identityKeyboard,
  reportKeyboard,
  monthKeyboard,
} from "./text";
import { formatDayReport, formatAck, formatMembers, formatProfile } from "./format";
import {
  claimUpdate,
  getState,
  setPhase,
  clearState,
  listMembers,
  updateMember,
  getMemberById,
  getDayByDate,
  getDayById,
  listUnlinkedMembers,
  availableMonths,
  loadMonth,
} from "@/db/queries";
import {
  linkSender,
  registerMember,
  resolveTarget,
  ensureToday,
  ingestMessage,
  buildDay,
} from "@/services/member-day";
import { parseMessage, isReportable } from "@/ai/segments";
import { transcribeAudio } from "@/ai/voice";
import { buildMonthlyExcel } from "@/services/board-excel";
import { toJalali, jalaliMonthLabel } from "@/lib/jalali";
import type { Member } from "@/db/schema";

let _bot: Bot | null = null;

export function getBot(): Bot {
  if (_bot) return _bot;
  const bot = new Bot(config.telegram.botToken, {
    // پیش‌فرض grammY ۵۰۰ ثانیه است؛ یعنی یک درخواستِ کندِ تلگرام می‌تواند
    // تابع سرورلس را تا سقف ۶۰ ثانیه‌اش بخواباند و آپدیت را بی‌پاسخ بگذارد.
    client: { timeoutSeconds: 20 },
  });
  registerHandlers(bot);
  _bot = bot;
  return bot;
}

/** نام نمایشیِ کاربر تلگرام — فقط یک پیشنهاد است، نه مرجع */
function displayName(from?: { first_name?: string; last_name?: string }): string {
  return [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
}

function registerHandlers(bot: Bot) {
  /**
   * حصار خطا — بیرونی‌ترین لایه.
   * اگر خطایی از اینجا بیرون برود، grammY آن را به وبهوک پرتاب می‌کند،
   * پاسخ ۵۰۰ می‌شود و تلگرام همان آپدیت را بی‌پایان دوباره می‌فرستد.
   * (bot.catch فقط در long polling کار می‌کند، در وبهوک نه.)
   */
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (e) {
      // خودِ شیء خطا چاپ نمی‌شود؛ خطاهای grammY توکن بات را همراه دارند
      console.error("[bot] خطای هندلر:", describeError(e));
      try {
        await ctx.reply(MSG.error);
      } catch {
        /* حتی پاسخ‌دادن هم ممکن است شکست بخورد */
      }
    }
  });

  /**
   * حذف آپدیت تکراری. تلگرام هر آپدیتی را که پاسخ ۲۰۰ نگیرد یا دیر پاسخ
   * بگیرد دوباره می‌فرستد؛ بدون این بررسی، یک پیام دوبار به زنجیره‌ی روز
   * می‌چسبد و قطعه‌ی تکراری می‌سازد.
   */
  bot.use(async (ctx, next) => {
    const id = ctx.update.update_id;
    if (id && !(await claimUpdate(id))) {
      console.warn(`[bot] آپدیت تکراری ${id} نادیده گرفته شد`);
      return;
    }
    await next();
  });

  bot.use(async (ctx, next) => {
    const allow = config.telegram.allowedChatIds;
    if (allow.length && ctx.chat && !allow.includes(String(ctx.chat.id))) {
      await ctx.reply(MSG.notAllowed);
      return;
    }
    await next();
  });

  // ── دستورها ────────────────────────────────────────
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(MSG.welcome);
    // فهرست دستورها همین‌جا ثبت می‌شود تا در منوی تلگرام دیده شود و کسی
    // مجبور نباشد دستور را از حفظ تایپ کند. عملیات idempotent است و
    // شکستش نباید /start را خراب کند.
    try {
      await ctx.api.setMyCommands([...COMMANDS]);
    } catch (e) {
      console.error("[bot] ثبت فهرست دستورها ناموفق بود:", describeError(e));
    }
  });

  bot.command("members", async (ctx) => {
    await ctx.reply(formatMembers(await listMembers(ctx.chat.id)));
  });

  bot.command("me", async (ctx) => {
    const member = await senderMember(ctx);
    if (!member) return await ctx.reply(MSG.noProfile);

    // «/me محمد خوانی — مدیرعامل» پروفایل را اصلاح می‌کند
    const args = (ctx.match ?? "").toString().trim();
    if (args) {
      const [rawName, role] = splitProfileInput(args);
      const name = rawName.split(/\s+/).slice(0, 4).join(" ").slice(0, 60);
      await updateMember(member.id, {
        fullName: name || member.fullName,
        role: role ?? member.role,
        profileStatus: (role ?? member.role) ? "complete" : "pending",
      });
      const updated = await getMemberById(member.id);
      return await ctx.reply(formatProfile(updated ?? member));
    }
    await ctx.reply(formatProfile(member));
  });

  bot.command("report", async (ctx) => {
    await sendDayReport(ctx, { close: false });
  });

  bot.command("close", async (ctx) => {
    await sendDayReport(ctx, { close: true });
  });

  bot.command("month", async (ctx) => {
    const months = await availableMonths(ctx.chat.id);
    if (!months.length) return await ctx.reply(MSG.noMonths);
    await ctx.reply("کدام ماه؟", {
      reply_markup: monthKeyboard(
        months.map((m) => ({ key: m, label: jalaliMonthLabel(m) })),
      ),
    });
  });

  // ── دکمه‌های شیشه‌ای ────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const presser = ctx.from.id;

    // این دو فقط «تأییدِ ظاهری» هستند. اگر آپدیت دوباره تحویل داده شده باشد
    // یا دیر رسیده باشیم، تلگرام ۴۰۰ می‌دهد؛ نباید کل هندلر را بخواباند.
    try {
      await ctx.answerCallbackQuery();
    } catch {
      /* query قدیمی یا قبلاً پاسخ‌داده‌شده */
    }

    const [kind, ...rest] = data.split(":");

    // خروجی ماهانه برای همه‌ی اعضا آزاد است
    if (kind === "month") {
      await sendMonthlyExcel(ctx, rest[0]);
      return;
    }

    // بقیه‌ی دکمه‌ها شخصی‌اند: شناسه‌ی صاحبِ دکمه داخل داده است
    const owner = Number(rest[0]);
    if (owner !== presser) {
      try {
        await ctx.answerCallbackQuery({ text: MSG.notMyButton, show_alert: true });
      } catch {
        /* بی‌اهمیت */
      }
      return;
    }

    if (kind === "name") {
      await finishName(ctx, displayName(ctx.from));
      return;
    }

    // «من همان عضوم که دیگران برایم گزارش داده‌اند»
    if (kind === "link") {
      const member = await getMemberById(Number(rest[1]));
      if (!member || member.userId) return;
      await updateMember(member.id, { userId: presser });
      await askRoleNext(ctx, member.fullName);
      return;
    }

    if (kind === "refresh" || kind === "close") {
      const day = await getDayById(Number(rest[1]));
      if (!day) return;
      const member = await getMemberById(day.memberId);
      if (!member) return;
      await ctx.reply(MSG.processing);
      const res = await buildDay(day, { close: kind === "close" });
      if (res.aiFailed) await ctx.reply(MSG.aiUnavailable);
      else if (res.aiIncomplete) await ctx.reply(MSG.aiIncomplete);
      await ctx.reply(formatDayReport(member, day, res.segments, res), {
        reply_markup: kind === "close" ? undefined : reportKeyboard(presser, day.id),
      });
      if (kind === "close") await ctx.reply(MSG.dayClosed(day.dateLabel));
      return;
    }
  });

  // ── پیام‌ها ────────────────────────────────────────
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
    const res = await fetch(url);
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    const text = await transcribeAudio(b64);
    if (!text) return await ctx.reply(MSG.voiceFailed);
    await onMessage(ctx, text, {
      kind: "voice",
      telegramFileId: file.file_id,
    });
  });

  bot.on("message:text", async (ctx) => {
    await onMessage(ctx, ctx.message.text, {
      kind: "text",
      telegramMessageId: ctx.message.message_id,
    });
  });
}

/** «محمد خوانی — مدیرعامل» → ["محمد خوانی", "مدیرعامل"] */
function splitProfileInput(text: string): [string, string | null] {
  const parts = text.split(/[|,،—-]+/).map((p) => p.trim()).filter(Boolean);
  return [parts[0] ?? "", parts[1] ?? null];
}

/** عضوِ متناظر با فرستنده‌ی این آپدیت (اگر ثبت شده باشد) */
async function senderMember(ctx: Context): Promise<Member | null> {
  if (!ctx.chat || !ctx.from) return null;
  return linkSender(ctx.chat.id, ctx.from.id, displayName(ctx.from));
}

/**
 * مسیر اصلیِ هر پیام.
 * ترتیب عمدی است: اول فازِ گفتگو (پرسیدن نام/سمت)، بعد گزارش.
 */
async function onMessage(
  ctx: Context,
  text: string,
  meta: { kind: "text" | "voice"; telegramMessageId?: number; telegramFileId?: string },
) {
  if (!ctx.chat || !ctx.from || ctx.from.is_bot) return;
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const state = await getState(chatId, userId);

  if (state?.phase === "await_name") {
    await finishName(ctx, text);
    return;
  }

  if (state?.phase === "await_role") {
    const member = await senderMember(ctx);
    if (member) {
      await updateMember(member.id, {
        role: text.trim(),
        profileStatus: "complete",
      });
      await ctx.reply(MSG.profileDone(member.fullName, text.trim()));
      // گزارشی که پیش از پرسیدنِ نام فرستاده بود نباید گم شود
      const pending = state.pendingText;
      await clearState(chatId, userId);
      if (pending) {
        await ctx.reply(MSG.pendingSaved);
        await ingestReport(ctx, { ...member, role: text.trim() }, pending, {
          kind: "text",
        });
      }
    }
    return;
  }

  const { events } = parseMessage(text);
  // در گروه هر پیامی گزارش نیست؛ «سلام» نباید روز باز کند یا نام بپرسد
  if (!isReportable(events)) return;

  const sender = await senderMember(ctx);
  if (!sender) {
    const suggestion = displayName(ctx.from);
    const unlinked = await listUnlinkedMembers(chatId);
    await setPhase(chatId, userId, "await_name", text);
    await ctx.reply(MSG.askName(suggestion, unlinked.length > 0), {
      reply_markup:
        suggestion || unlinked.length
          ? identityKeyboard(userId, suggestion, unlinked)
          : undefined,
    });
    return;
  }

  await ingestReport(ctx, sender, text, meta);
}

/** ثبتِ نامِ عضو و پرسیدن سمت */
async function finishName(ctx: Context, name: string) {
  if (!ctx.chat || !ctx.from) return;
  const clean = name.trim();
  if (!clean) return;
  const member = await registerMember(ctx.chat.id, ctx.from.id, clean);
  await askRoleNext(ctx, member.fullName);
}

/**
 * گام بعدیِ شناسایی: پرسیدن سمت.
 * گزارشی که پیش از پرسیدنِ نام فرستاده شده (`pendingText`) باید حفظ شود.
 */
async function askRoleNext(ctx: Context, fullName: string) {
  if (!ctx.chat || !ctx.from) return;
  const state = await getState(ctx.chat.id, ctx.from.id);
  await setPhase(
    ctx.chat.id,
    ctx.from.id,
    "await_role",
    state?.pendingText ?? null,
  );
  await ctx.reply(MSG.askRole(fullName));
}

/** چسباندن یک پیام به زنجیره‌ی روزِ صاحبش */
async function ingestReport(
  ctx: Context,
  sender: Member,
  text: string,
  meta: { kind: "text" | "voice"; telegramMessageId?: number; telegramFileId?: string },
) {
  const chatId = ctx.chat!.id;
  const target = await resolveTarget(chatId, sender, text);
  const { day, autoClosed, reopened } = await ensureToday(target.member);

  // روزِ فراموش‌شده‌ی قبلی: بی‌صدا نهایی می‌شود، نه اینکه بات گیر کند
  if (autoClosed.length) {
    await ctx.reply(MSG.autoClosed(autoClosed.map((d) => d.dateLabel)));
  }
  if (reopened) await ctx.reply(MSG.dayReopened(day.dateLabel));

  // متنِ تحلیل ممکن است نامِ ابتدای پیام را نداشته باشد؛ ردِ ممیزی همیشه
  // متنِ کاملِ اصلی است
  const segments = await ingestMessage(day, target.text, {
    senderUserId: ctx.from!.id,
    kind: meta.kind,
    telegramMessageId: meta.telegramMessageId,
    telegramFileId: meta.telegramFileId,
    rawText: text,
  });

  await ctx.reply(
    formatAck(segments, target.onBehalf ? target.member.fullName : undefined),
    meta.telegramMessageId
      ? { reply_parameters: { message_id: meta.telegramMessageId } }
      : undefined,
  );
}

/** گزارش امروزِ فرستنده (با تحلیل کامل روز) */
async function sendDayReport(ctx: Context, opts: { close: boolean }) {
  const member = await senderMember(ctx);
  if (!member) return await ctx.reply(MSG.noProfile);

  const today = toJalali();
  const day = await getDayByDate(member.id, today.key);
  if (!day) return await ctx.reply(MSG.noOpenDay);

  await ctx.reply(MSG.processing);
  const res = await buildDay(day, { close: opts.close });
  if (res.aiFailed) await ctx.reply(MSG.aiUnavailable);
  else if (res.aiIncomplete) await ctx.reply(MSG.aiIncomplete);

  await ctx.reply(formatDayReport(member, day, res.segments, res), {
    reply_markup: opts.close
      ? undefined
      : reportKeyboard(ctx.from!.id, day.id),
  });
  if (opts.close) await ctx.reply(MSG.dayClosed(day.dateLabel));
}

/** ساخت و ارسال اکسل ماهانه */
async function sendMonthlyExcel(ctx: Context, month: string) {
  const chat = ctx.chat;
  if (!chat) return;
  await ctx.reply(MSG.building);

  const { members, days } = await loadMonth(chat.id, month);
  const title = "title" in chat && chat.title ? chat.title : "هیئت‌مدیره";
  const file = await buildMonthlyExcel(title, month, members, days);
  if (!file) return await ctx.reply(MSG.noDataForMonth);

  await ctx.replyWithDocument(new InputFile(file.buffer, file.fileName), {
    caption:
      `📊 گزارش فعالیت ${jalaliMonthLabel(month)}\n` +
      `تعداد اعضا: ${file.memberCount}`,
  });
}
