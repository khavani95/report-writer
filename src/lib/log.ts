/**
 * توصیف امنِ خطا برای لاگ.
 *
 * چاپ کردن خودِ شیء خطا خطرناک است: خطاهای grammY (BotError) کل ctx را
 * همراه دارند و داخلش `api.token` — یعنی توکن بات به‌صورت متن ساده در
 * لاگ‌های سرور می‌نشیند. این تابع فقط بخش‌های به‌دردبخور را بیرون می‌کشد
 * و در پایان هر چیزی که شبیه توکن بات است را هم پنهان می‌کند.
 */

/**
 * الگوی توکن بات تلگرام: 8916911537:AAF...
 * عمداً بدون \b نوشته شده تا شکل داخل آدرس هم پوشش داده شود
 * (`api.telegram.org/bot<توکن>/setWebhook` — همان شکلی که در کد می‌سازیم).
 */
const BOT_TOKEN = /\d{8,12}:[A-Za-z0-9_-]{30,}/g;

/** پنهان‌کردن توکن در هر متنی */
export function redact(text: string): string {
  return text.replace(BOT_TOKEN, "<توکن-پنهان‌شده>");
}

interface GrammyLike {
  method?: unknown;
  error_code?: unknown;
  description?: unknown;
  /** BotError خطای اصلی را اینجا نگه می‌دارد */
  error?: unknown;
  ctx?: { update?: { update_id?: unknown } };
}

export function describeError(e: unknown): string {
  const parts: string[] = [];

  if (e instanceof Error) parts.push(`${e.name}: ${e.message}`);
  else if (typeof e === "string") parts.push(e);
  else parts.push(String(e));

  const g = e as GrammyLike;
  const updateId = g?.ctx?.update?.update_id;
  if (updateId !== undefined) parts.push(`update=${String(updateId)}`);

  // BotError خطای واقعی را در .error می‌گذارد؛ همان جای اطلاعات مفید است
  const inner = (g?.error ?? null) as GrammyLike | null;
  const src = inner ?? g;
  if (src?.method) parts.push(`method=${String(src.method)}`);
  if (src?.error_code !== undefined) parts.push(`code=${String(src.error_code)}`);
  if (src?.description) parts.push(`desc=${String(src.description)}`);

  const stack = e instanceof Error && e.stack ? `\n${e.stack}` : "";
  return redact(parts.join(" | ") + stack);
}
