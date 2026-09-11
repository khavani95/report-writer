/**
 * پارسر قطعیِ «زنجیره‌ی روز» (بدون هوش مصنوعی).
 *
 * روزِ هر عضو یک زنجیره از قطعه‌هاست: ۰۹:۰۰ همت → ۱۲:۰۰ باغ موزه → ۱۹:۰۰ پایان.
 * این فایل از متن فارسیِ محاوره‌ای، رویدادهای این زنجیره را بیرون می‌کشد.
 * هوش مصنوعی هرگز تنها راه استخراج نیست؛ این مسیر همیشه کار می‌کند.
 *
 * ⚠️ نکته‌ی کلیدیِ زبانی: «رفتم» دو معنی دارد و تفاوتشان در وجودِ مقصد است.
 *    «ساعت ۱۲ رفتم پروژه باغ موزه» → رفتن *به* جایی (شروع قطعه‌ی تازه)
 *    «ساعت ۷ رفتم»                  → ترک کردن (پایان قطعه/روز)
 */

import {
  normalizeDigits,
  parseSingleTime,
  forwardInDay,
  readNumber,
  readMinutes,
  isNumberWord,
  isFractionWord,
} from "@/services/time-parse";
import { normalizeName } from "@/lib/text-normalize";

export type SegmentEvent =
  /** رسیدن به یک محل — قطعه‌ی تازه‌ای باز می‌کند */
  | { kind: "arrive"; time: string | null; place: string | null }
  /** ترک کردن — قطعه‌ی باز را می‌بندد */
  | { kind: "leave"; time: string | null }
  /** «تا ۵ اونجا بودم» — فقط پایانِ قطعه‌ی جاری */
  | { kind: "until"; time: string }
  /**
   * بندی که فقط ساعت است («هفت و نیم صبح» در خط دوم پیام).
   * به قطعه‌ی جاری می‌چسبد: اگر ساعت شروع ندارد شروع، وگرنه پایان.
   */
  | { kind: "at"; time: string }
  /** شرح کار، بدون ساعت و بدون مقصد — به قطعه‌ی جاری می‌چسبد */
  | { kind: "note"; text: string };

export interface ParsedMessage {
  /** نام عضو دیگری که گزارش برای اوست («ایدین امروز …») */
  personName: string | null;
  events: SegmentEvent[];
}

/** یک قطعه‌ی فعالیت در روز */
export interface Segment {
  place: string | null;
  description: string;
  startTime: string | null;
  endTime: string | null;
}

// ── واژگان ────────────────────────────────────────────────

/** فعل‌هایی که همیشه «رسیدن» معنی می‌دهند، حتی بدون مقصد */
const ARRIVE_VERBS = [
  "اومدم", "اومدیم", "اومد", "اومدن", "اومدند",
  "آمدم", "آمدیم", "آمد", "آمدن", "آمدند",
  "امدم", "امدیم", "امد", "امدن", "امدند",
  "رسیدم", "رسیدیم", "رسید", "رسیدن", "رسیدند",
];

/** فعل‌های دوپهلو: با مقصد یعنی رفتن به جایی، بدون مقصد یعنی ترک کردن */
const MOVE_VERBS = [
  "رفتم", "رفتیم", "رفت", "رفتن", "رفتند",
  "برگشتم", "برگشتیم", "برگشت", "برگشتن", "برگشتند",
];

/** فعل‌هایی که همیشه «ترک کردن» معنی می‌دهند */
const LEAVE_VERBS = [
  "مرخص", "خارج", "زدم", "تعطیل", "برگشتم خونه",
];

/** بن‌های فعلِ گذشته — برای تشخیص «این تکه یک جمله است، نه اسمِ محل» */
const PAST_STEMS = [
  "کرد", "داد", "شد", "بود", "رفت", "اومد", "آمد", "امد", "رسید", "گرفت",
  "زد", "دید", "خورد", "موند", "ماند", "گفت", "برد", "آورد", "اورد",
  "انداخت", "بست", "کشید", "چید", "ساخت", "خواند", "خوند", "نوشت",
  "فرستاد", "رسوند", "نشست", "گذاشت", "برداشت", "پرداخت", "خواست",
  "توانست", "تونست", "شنید", "پرسید", "خرید", "فروخت", "بردم",
  "داشت", "گذشت", "شمرد", "خواند", "پیوست", "رساند",
];

/** پسوندهای شناسه‌ی فعل */
const VERB_SUFFIXES = ["", "م", "ی", "یم", "ید", "ن", "ند", "ه", "ه‌ام", "ه‌اند"];

/** واژه‌هایی که ابتدای مقصد می‌آیند و بخشی از نام محل نیستند */
const PLACE_PREFIXES = [
  "به", "در", "سمت", "طرف", "سراغ", "سوی", "تو", "توی",
  // «رفتم از ایران ویبره دستگاه گرفتم» → محل «ایران ویبره» است نه «از ایران»
  "از",
];

/** «رفتم خونه» یعنی پایانِ کار، نه مقصدِ تازه */
const HOME_WORDS = ["خونه", "خانه", "منزل"];

/**
 * واژه‌هایی که مقصد را تمام می‌کنند.
 * «رفتم ساختمان برای فلاشینگ بام» → محل «ساختمان» است نه «ساختمان برای فلاشینگ».
 * روزهای هفته هم اینجا هستند چون «رفتیم پنجشنبه یه سری وسیله آوردیم»
 * محلش «پنجشنبه یه» نیست.
 */
const PLACE_STOP = [
  "برای", "جهت", "بابت", "درباره", "بخاطر", "بهخاطر", "همراه", "با",
  "شنبه", "یکشنبه", "دوشنبه", "سهشنبه", "چهارشنبه", "پنجشنبه", "جمعه",
  "روز", "یه", "یک", "یکی", "چند", "سری", "تا", "ساعت", "که", "ولی", "اما",
];

/** نشانه‌های «شروعِ کار» بدون فعل حرکتی: «۹ صبح شروع کردم» */
const START_WORDS = ["شروع", "آغاز", "اغاز", "استارت", "ورود"];

/** نشانه‌های «پایانِ کار» بدون فعل حرکتی: «ترک کار ساعت ۱۹:۳۰» */
const END_WORDS = [
  "ترک", "تعطیل", "تمام", "تموم", "پایان", "خاتمه", "اتمام", "خروج",
];

/** فعل‌های «بودن» — نشانه‌ی حضور در جایی، نه انجامِ کاری */
const BEING_VERBS = [
  "بود", "بودم", "بودیم", "بودن", "بودند", "هست", "هستم", "هستیم",
];

/** «الان تعطیل کردیم» — ساعتِ گفته‌نشده یعنی همین حالا */
const NOW_WORDS = ["الان", "الآن", "هماکنون", "همینالان", "تازه"];

/** قیدهای زمانی که در ابتدای جمله می‌آیند و معنایی برای ما ندارند */
const TIME_ADVERBS = ["امروز", "دیروز", "فردا", "صبح", "امشب", "دیشب"];

/** عناوینِ احترامی که پیش از نام می‌آیند و بخشی از نام نیستند */
const TITLES = ["آقای", "اقای", "خانم", "مهندس", "دکتر", "جناب", "سرکار"];

/** فعل‌های حرکتیِ سوم‌شخص — نشانه‌ی «این گزارشِ کسِ دیگری است» */
const THIRD_PERSON_MOVE =
  /(?:^|\s)(?:رفت|رفتن|رفتند|اومد|اومدن|اومدند|آمد|آمدن|آمدند|امد|امدن|امدند|رسید|رسیدن|رسیدند|برگشت|برگشتن|برگشتند)(?:\s|$)/;

/** فعل اول‌شخص یعنی گزارش برای خودِ فرستنده است */
const FIRST_PERSON =
  /(رفتم|اومدم|آمدم|امدم|رسیدم|کردم|بودم|شدم|دادم|رفتیم|کردیم|بودیم|اومدیم|دیدم|داشتم)/;

/** هر فعلِ سوم‌شخصی (سست‌تر از THIRD_PERSON_MOVE) */
const THIRD_PERSON_ANY = /(رفت|اومد|آمد|امد|رسید|کرد|بود|شد|داد|انجام|داشت)/;

/**
 * واژگانِ تعارف و گپ.
 * پیامی که *همه‌ی* واژه‌هایش از این فهرست باشد گزارش نیست — «سلام»،
 * «ممنون»، «اوکی داداش». هر واژه‌ی دیگری که در پیام باشد یعنی حرفِ تازه‌ای
 * زده شده و پیام گزارش حساب می‌شود.
 */
const CHITCHAT_WORDS = new Set([
  "سلام", "سلامعلیکم", "علیکم", "درود", "صبح", "ظهر", "شب", "بخیر", "بخير",
  "خسته", "نباشید", "نباشی", "نباشین", "ممنون", "ممنونم", "مرسی", "متشکرم",
  "تشکر", "سپاس", "سپاسگزارم", "لطف", "دارید", "داری", "کردی", "کردین",
  "باشه", "باشد", "بله", "آره", "اره", "نه", "خب", "خوبه", "عالی", "احسنت",
  "چشم", "اوکی", "اوکیه", "اوکیم", "ok", "okay", "حله", "حتما", "خواهش",
  "میکنم", "قربانت", "فدات", "دمت", "گرم", "ایول", "عزیز", "جان", "داداش",
  "آقا", "اقا", "خانم", "مهندس", "دکتر", "بابا", "والا", "دیگه", "بفرمایید",
  "خداحافظ", "بدرود", "شبخوش", "روزبخیر",
]);

/** واژه‌هایی که ابتدای شرح می‌آیند و اطلاعاتی ندارند */
const NOTE_PREFIXES = [
  "اونجا", "آنجا", "اینجا", "همونجا", "همانجا",
  "بعدش", "سپس", "هم", "و", "من", "ما",
];

/** حذف نویسه‌های زینتی و یکسان‌سازی حروف برای مقایسه‌ی واژه‌ها */
function normalizeToken(t: string): string {
  return t
    .replace(/[ىيﻱﻲ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‍‎‏]/g, "")
    // ⚠️ «:» عمداً در این فهرست نیست. وقتی حذف می‌شد، «۹:۳۰» به «۹۳۰»
    // تبدیل و از الگوی ساعت رد می‌شد؛ یعنی هیچ ساعتی که دو نقطه داشت
    // خوانده نمی‌شد. فقط دو نقطه‌ی ابتدا/انتهای واژه («همت:») پاک می‌شود.
    .replace(/[.,،؛;!؟?"'«»()]/g, "")
    .replace(/^:+|:+$/g, "")
    .trim();
}

/** آیا این واژه یک فعلِ گذشته است؟ (با احتساب پیشوندهای نفی/استمرار) */
export function isVerbToken(raw: string): boolean {
  let t = normalizeToken(raw);
  if (!t) return false;
  for (const p of ["نمی", "می", "ن"]) {
    if (t.startsWith(p) && t.length > p.length + 2) {
      t = t.slice(p.length);
      break;
    }
  }
  return PAST_STEMS.some((stem) =>
    VERB_SUFFIXES.some((suf) => t === stem + suf),
  );
}

function isMoveVerb(t: string): boolean {
  return MOVE_VERBS.includes(normalizeToken(t));
}
function isArriveVerb(t: string): boolean {
  return ARRIVE_VERBS.includes(normalizeToken(t));
}
function isLeaveVerb(t: string): boolean {
  return LEAVE_VERBS.includes(normalizeToken(t));
}

/** آیا این واژه می‌تواند شروع یک عبارتِ زمانی باشد؟ («۵»، «پنج»، «ساعت») */
function isTimeToken(t?: string): boolean {
  if (!t) return false;
  return normalizeToken(t) === "ساعت" || isNumberWord(t);
}

// ── بندبندی جمله ──────────────────────────────────────────

/**
 * متن را به «بند»های مستقل می‌شکند.
 *
 * شکستن روی « و » فقط وقتی انجام می‌شود که تکه‌ی بعدی خودش یک جمله باشد
 * (فعل یا «ساعت» داشته باشد)؛ وگرنه نامِ محل‌هایی مثل «پروژه آب و برق»
 * از وسط نصف می‌شوند.
 */
export function splitClauses(text: string): string[] {
  const hard = normalizeDigits(text)
    .split(/[\n.؛!؟?]+|،|,/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const part of hard) {
    const tokens = part.split(/\s+/).filter(Boolean);
    let cur: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = normalizeToken(tokens[i]);
      // «۸ و نیم»، «نه و ربع» و «بیست و یک» یک عبارتِ زمانی‌اند، نه دو بند
      const joinsNumber =
        (isNumberWord(tokens[i - 1]) || isFractionWord(tokens[i - 1])) &&
        (isNumberWord(tokens[i + 1]) || isFractionWord(tokens[i + 1]));
      const isConnector =
        !joinsNumber && (t === "و" || t === "سپس" || t === "بعدش");
      if (isConnector && cur.length && restIsClause(tokens, i + 1)) {
        out.push(cur.join(" "));
        cur = [];
        continue; // خودِ حرف ربط دور ریخته می‌شود
      }
      // «تا ۵» شروع یک بندِ تازه است و «تا» بخشی از آن می‌ماند
      if (t === "تا" && cur.length && isTimeToken(tokens[i + 1])) {
        out.push(cur.join(" "));
        cur = [tokens[i]];
        continue;
      }
      cur.push(tokens[i]);
    }
    if (cur.length) out.push(cur.join(" "));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * آیا تکه‌ی بعد از حرف ربط (تا حرف ربطِ بعدی) خودش یک بند کامل است؟
 * «… و ساعت ۷ رفتم» → بله. «پروژه آب و برق» → نه.
 */
function restIsClause(tokens: string[], from: number): boolean {
  for (let i = from; i < tokens.length; i++) {
    const t = normalizeToken(tokens[i]);
    if (t === "و" || t === "سپس" || t === "بعدش") break;
    // فعل لازم است، نه صرفاً «ساعت». وگرنه «من و شایان ساعت ۱۹:۳۰» از وسط
    // نصف می‌شود و «من» فاعلِ بی‌جمله می‌ماند.
    if (isVerbToken(tokens[i])) return true;
  }
  return false;
}

// ── تحلیل یک بند ──────────────────────────────────────────

interface TimeHit {
  /** متنِ عبارتِ زمانی، برای تشخیص صبح/عصر */
  expr: string;
  /** ایندکس واژه‌ای که عبارت از آن شروع می‌شود */
  start: number;
  /** ایندکس واژه‌ی بعد از عبارت */
  end: number;
  /** «تا ۵» یعنی پایانِ بازه */
  until: boolean;
}

/** نخستین عبارتِ زمانی بند را پیدا می‌کند */
function findTime(tokens: string[]): TimeHit | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = normalizeToken(tokens[i]);
    const until = t === "تا";
    const isMarker = t === "ساعت" || until || t === "از";
    if (!isMarker) continue;
    // «تا ساعت ۵» یا «ساعت پنج» — «حدود/تقریبا» هم رد می‌شود
    let j = i + 1;
    if (normalizeToken(tokens[j] ?? "") === "ساعت") j += 1;
    const hour = readNumber(tokens, j);
    if (!hour) continue;

    let end = j + hour.consumed;
    let minute: string | null = null;

    // «و نیم» / «و ربع» / «و ده دقیقه»
    const mins = readMinutes(tokens, end);
    if (mins && !hour.text.includes(":")) {
      minute = mins.text;
      end += mins.consumed;
    }

    // «صبح/عصر/شب» بعد از عدد هم بخشی از عبارت است
    const qualifiers: string[] = [];
    while (end < tokens.length) {
      const n = normalizeToken(tokens[end]);
      if (!/^(صبح|عصر|ظهر|شب|بامداد|غروب|بعدازظهر)$/.test(n)) break;
      qualifiers.push(tokens[end]);
      end += 1;
    }

    // عبارت به شکل رقمی بازسازی می‌شود تا parseSingleTime دست‌نخورده بماند
    const digits =
      minute !== null
        ? `${hour.text}:${minute.padStart(2, "0")}`
        : hour.text;
    return {
      expr: [digits, ...qualifiers].join(" "),
      start: i,
      end,
      until,
    };
  }

  // بدون واژه‌ی «ساعت»: عددی که بلافاصله «صبح/عصر/شب» دنبالش بیاید
  // («۹ صبح شروع کردم»). بدون این شرط، «۳ متر» هم زمان خوانده می‌شد.
  for (let i = 0; i < tokens.length; i++) {
    const num = readNumber(tokens, i);
    if (!num) continue;
    let end = i + num.consumed;

    // «هفت و نیم صبح» — کسر هم پیش از واژه‌ی صبح/عصر می‌آید
    const mins = readMinutes(tokens, end);
    const digits =
      mins && !num.text.includes(":")
        ? `${num.text}:${mins.text.padStart(2, "0")}`
        : num.text;
    if (mins && !num.text.includes(":")) end += mins.consumed;

    const next = normalizeToken(tokens[end] ?? "");
    if (!/^(صبح|عصر|ظهر|شب|بامداد|غروب|بعدازظهر)$/.test(next)) continue;
    return {
      expr: `${digits} ${tokens[end]}`,
      start: i,
      end: end + 1,
      until: false,
    };
  }
  return null;
}

/** مقصد را از واژه‌های بعد از فعل بیرون می‌کشد (خالی یعنی «ترک کردن») */
function extractPlace(tokens: string[], from: number): string | null {
  let i = from;
  // حذف حرف اضافه و قیدهای ابتدای مقصد: «رفتم به دفتر»، «هم بانک مرکزی»
  while (i < tokens.length) {
    const n = normalizeToken(tokens[i]);
    if (
      PLACE_PREFIXES.includes(n) ||
      NOTE_PREFIXES.includes(n) ||
      TIME_ADVERBS.includes(n)
    ) {
      i += 1;
      continue;
    }
    break;
  }
  // اگر بعد از مقصد فعلی هست، یعنی شرحِ کار هم چسبیده؛ مقصد را کوتاه‌تر می‌گیریم
  const tailHasVerb = tokens.slice(i).some((t) => isVerbToken(t));
  const max = tailHasVerb ? 2 : 3;

  const words: string[] = [];
  for (let k = i; k < tokens.length && words.length < max; k++) {
    const n = normalizeToken(tokens[k]);
    if (!n) continue;
    if (isVerbToken(tokens[k])) break;
    if (PLACE_STOP.includes(n)) break;
    if (NOTE_PREFIXES.includes(n)) break;
    if (/^\d/.test(n)) break;
    words.push(tokens[k]);
  }
  const place = words.join(" ").replace(/\s+(رو|را)$/, "").trim();
  return place || null;
}

/** واژه‌های محل را از فهرست بند حذف می‌کند تا در شرح تکرار نشوند */
function dropPlace(tokens: string[], place: string): string[] {
  const words = place.split(/\s+/).filter(Boolean);
  const first = tokens.findIndex((t) => normalizeToken(t) === normalizeToken(words[0]));
  if (first < 0) return tokens;
  return [...tokens.slice(0, first), ...tokens.slice(first + words.length)];
}

/** جای نخستین واژه‌ی این فهرست در بند (‎-۱ اگر نبود) */
function indexOfWord(tokens: string[], words: string[]): number {
  return tokens.findIndex((t) =>
    words.some((w) => normalizeToken(t).startsWith(w)),
  );
}

/** آیا این مقصد «خانه» است؟ (فقط تک‌واژه؛ «خانه گستر» یک شرکت است) */
function isHome(place: string): boolean {
  const words = place.split(/\s+/).filter(Boolean);
  return words.length === 1 && HOME_WORDS.includes(normalizeToken(words[0]));
}

/** پاک‌سازی متنِ شرح */
function cleanNote(tokens: string[]): string {
  const words = [...tokens];
  while (words.length) {
    const n = normalizeToken(words[0]);
    if (TIME_ADVERBS.includes(n) || NOTE_PREFIXES.includes(n)) words.shift();
    else break;
  }
  return words.join(" ").replace(/^[\s،,.-]+|[\s،,.-]+$/g, "").trim();
}

/**
 * آیا این بند محتوایی برای شرح دارد؟
 * «تا ۵ اونجا بودم» بعد از پاک‌سازی فقط «بودم» می‌ماند — یعنی هیچ.
 */
function isMeaningful(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => normalizeToken(w));
  if (!words.length) return false;
  if (words.every((w) => isVerbToken(w))) return false;
  return normalizeToken(words.join(" ")).length >= 3;
}

/** تحلیل یک بند به رویدادها */
function classifyClause(
  clause: string,
  hint: "entry" | "exit" = "entry",
): SegmentEvent[] {
  const tokens = clause.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  const time = findTime(tokens);

  // واژه‌های بیرون از عبارتِ زمانی — فعل و مقصد از این‌ها خوانده می‌شوند
  const rest = tokens.filter(
    (_, i) => !time || i < time.start || i >= time.end,
  );

  let verbIdx = -1;
  let verbKind: "arrive" | "move" | "leave" | null = null;
  for (let i = 0; i < rest.length; i++) {
    if (isArriveVerb(rest[i])) { verbIdx = i; verbKind = "arrive"; break; }
    if (isMoveVerb(rest[i])) { verbIdx = i; verbKind = "move"; break; }
    if (isLeaveVerb(rest[i])) { verbIdx = i; verbKind = "leave"; break; }
  }

  // بندِ «تا ۵ …» فقط پایانِ قطعه‌ی جاری را می‌گوید
  if (time?.until && verbKind !== "arrive" && verbKind !== "move") {
    const events: SegmentEvent[] = [];
    /**
     * «تا ۴ همت بودم» → محل «همت» است. ولی «تا ۵ اونجا لوله‌کشی مخزن رو
     * انجام دادن» شرحِ کار است نه محل. تفاوت در فعلِ بند است: فعلِ «بودن»
     * یعنی حضور در جایی، هر فعلِ دیگری یعنی انجامِ کاری.
     * محل پیش از «تا» می‌آید تا به قطعه‌ی جاری بنشیند، وگرنه پس از
     * بسته‌شدنِ قطعه قطعه‌ی تازه‌ای می‌ساخت.
     */
    const onlyBeing = rest
      .filter((t) => isVerbToken(t))
      .every((t) => BEING_VERBS.includes(normalizeToken(t)));
    const place = onlyBeing ? extractPlace(rest, 0) : null;
    if (place && !isHome(place)) {
      events.push({ kind: "arrive", time: null, place });
    }
    const t = parseSingleTime(time.expr, "exit");
    if (t) events.push({ kind: "until", time: t });
    const note = cleanNote(place ? dropPlace(rest, place) : rest);
    if (isMeaningful(note)) events.push({ kind: "note", text: note });
    return events;
  }

  /**
   * بندی که ساعت دارد ولی فعل حرکتی ندارد.
   * پیش از این، ساعتش کاملاً دور ریخته می‌شد و فقط شرح می‌ماند:
   * «ساعت ۹ بانک مرکزی بود» ، «۹ صبح شروع کردم» ، «ترک کار ساعت ۱۹:۳۰».
   */
  if (time && !verbKind) {
    const has = (words: string[]) =>
      rest.some((t) => words.some((w) => normalizeToken(t).startsWith(w)));

    const place = extractPlace(rest, 0);

    if (has(END_WORDS)) {
      const t = parseSingleTime(time.expr, "exit");
      return t ? [{ kind: "leave", time: t }] : [];
    }
    const t = parseSingleTime(time.expr, has(START_WORDS) ? "entry" : hint);
    if (!t) return [];

    // «ورود ساعت ۱۰» و «ورود به پروژه شهرداری» — «ورود» نامِ محل نیست،
    // پس مقصد از پس از همان واژه خوانده می‌شود.
    if (has(START_WORDS)) {
      const after = extractPlace(rest, indexOfWord(rest, START_WORDS) + 1);
      return [
        { kind: "arrive", time: t, place: after && !isHome(after) ? after : null },
      ];
    }
    if (place && !isHome(place)) {
      const events: SegmentEvent[] = [{ kind: "arrive", time: t, place }];
      const tail = cleanNote(dropPlace(rest, place));
      if (isMeaningful(tail)) events.push({ kind: "note", text: tail });
      return events;
    }
    // فقط ساعت: به قطعه‌ی جاری می‌چسبد («هفت و نیم صبح» در خط دوم)
    return [{ kind: "at", time: t }];
  }

  if (verbKind) {
    const found = verbKind === "leave" ? null : extractPlace(rest, verbIdx + 1);
    // «ساعت ۵ رفتم خونه» یعنی پایانِ کار، نه مقصدِ تازه
    const goingHome = found !== null && isHome(found);
    const place = goingHome ? null : found;
    const arriving =
      !goingHome && (verbKind === "arrive" || (verbKind === "move" && !!place));
    const t = time
      ? parseSingleTime(time.expr, arriving ? "entry" : "exit")
      : null;

    const events: SegmentEvent[] = [
      arriving
        ? { kind: "arrive", time: t, place }
        : { kind: "leave", time: t },
    ];

    // اگر بعد از مقصد هنوز جمله‌ای مانده، شرحِ کار است.
    // مقصدِ خانه هم از شرح حذف می‌شود؛ «خونه» اطلاعاتی ندارد.
    const skip = found ? found.split(/\s+/).length : 0;
    const tail = rest.slice(verbIdx + 1 + skip);
    // «رفتم ساختمان برای فلاشینگ بام» → شرح «برای فلاشینگ بام» نباید گم شود
    const note = cleanNote(tail);
    if (isMeaningful(note)) events.push({ kind: "note", text: note });
    return events;
  }

  /**
   * «ورود به پروژه شهرداری» یا «خروج از پروژه شهرداری» بدون ساعت.
   * ساعتش معمولاً در خط بعدی می‌آید؛ اگر اینجا رویداد نسازیم، آن ساعت هم
   * جایی برای نشستن ندارد و کل پیام به شرح تبدیل می‌شود.
   */
  if (!time) {
    const words = rest.map((t) => normalizeToken(t));
    const isEnd = words.some((w) => END_WORDS.some((e) => w.startsWith(e)));
    const isStart = words.some((w) => START_WORDS.some((e) => w.startsWith(e)));
    if (isEnd) return [{ kind: "leave", time: null }];
    if (isStart) {
      const after = extractPlace(rest, indexOfWord(rest, START_WORDS) + 1);
      return [
        { kind: "arrive", time: null, place: after && !isHome(after) ? after : null },
      ];
    }
  }

  // بدون فعلِ حرکتی: یا فقط ساعت است یا فقط شرحِ کار
  const note = cleanNote(rest);
  if (!isMeaningful(note)) return [];
  return [{ kind: "note", text: note }];
}

// ── تحلیل یک پیام ─────────────────────────────────────────

/**
 * اگر پیام با نام کسِ دیگری شروع شود، آن نام را جدا می‌کند.
 * («ایدین امروز ساعت ۷ رفت باغ موزه» → گزارشِ ایدین، نه فرستنده)
 *
 * ⚠️ سخت‌گیریِ عمدی: در حالت پیش‌فرض فقط وقتی نام جدا می‌شود که جمله فعلِ
 * حرکتیِ سوم‌شخص داشته باشد. وگرنه جمله‌ای مثل «جلسه هیئت‌مدیره برگزار شد»
 * دو واژه‌ی اولش «نام» تلقی می‌شد و از شرحِ کار حذف می‌شد.
 * حالت `strict: false` فقط برای مقایسه با فهرست اعضا به‌کار می‌رود؛ آنجا
 * تطبیق با یک عضوِ واقعی خودش ضامنِ درستی است.
 */
export function splitLeadingName(
  text: string,
  opts?: { strict?: boolean },
): { name: string | null; rest: string } {
  const strict = opts?.strict !== false;
  const clean = normalizeDigits(text).trim();
  const tokens = clean.split(/\s+/).filter(Boolean);
  const name: string[] = [];
  let consumed = 0;

  for (const tok of tokens) {
    const n = normalizeToken(tok);
    if (!n) break;
    // عنوانِ احترامی شمرده نمی‌شود ولی مصرف می‌شود: «مهندس نوری رفت …»
    if (!name.length && TITLES.includes(n)) {
      consumed += 1;
      continue;
    }
    if (name.length >= 2) break;
    if (TIME_ADVERBS.includes(n) || n === "ساعت" || /^\d/.test(n)) break;
    if (isVerbToken(tok) || isMoveVerb(tok) || isArriveVerb(tok)) break;
    if (PLACE_PREFIXES.includes(n) || NOTE_PREFIXES.includes(n)) break;
    // نامِ لاتین هم نام است: «Shayan امروز ساعت ۹ اومد»
    if (!/^[؀-ۿa-zA-Z]{2,}$/.test(n)) break;
    name.push(tok);
    consumed += 1;
  }

  if (!name.length) return { name: null, rest: clean };
  const rest = tokens.slice(consumed).join(" ");
  // فعلِ اول‌شخص یعنی گزارش برای خودِ فرستنده است، هرچه در ابتدا آمده باشد
  if (FIRST_PERSON.test(rest)) return { name: null, rest: clean };
  const cue = strict ? THIRD_PERSON_MOVE : THIRD_PERSON_ANY;
  if (!cue.test(rest)) return { name: null, rest: clean };
  return { name: name.join(" "), rest };
}

/** تحلیل کاملِ یک پیام: نامِ صاحبِ گزارش + رویدادهای زنجیره */
export function parseMessage(
  text: string,
  opts?: { now?: string | null },
): ParsedMessage {
  const { name, rest } = splitLeadingName(text);
  const events: SegmentEvent[] = [];
  for (const clause of splitClauses(rest)) {
    // ساعتِ تنها را با توجه به رویدادهای پیشِ خودش تفسیر می‌کنیم:
    // بعد از «خروج»، «ساعت ۵» یعنی ۱۷:۰۰ نه ۰۵:۰۰.
    const hint = events.some((e) => e.kind === "leave" || e.kind === "until")
      ? "exit"
      : "entry";
    events.push(...classifyClause(clause, hint));
  }
  const merged = mergeNotes(events);

  /**
   * «من و شایان الان تعطیل کردیم» ساعتی نمی‌گوید ولی دقیقاً یعنی همین حالا.
   * بدون این، رویداد بی‌ساعت می‌ماند و در زنجیره اثری نمی‌گذارد.
   */
  if (opts?.now && NOW_WORDS.some((w) => rest.includes(w))) {
    for (const ev of merged) {
      if ((ev.kind === "leave" || ev.kind === "arrive") && !ev.time) {
        ev.time = opts.now;
      }
    }
  }
  return { personName: name, events: merged };
}

/** شرح‌های پشت‌سرهم یک جمله بودند؛ دوباره با «و» به هم وصل می‌شوند */
function mergeNotes(events: SegmentEvent[]): SegmentEvent[] {
  const out: SegmentEvent[] = [];
  for (const ev of events) {
    const prev = out[out.length - 1];
    if (ev.kind === "note" && prev?.kind === "note") {
      prev.text = `${prev.text} و ${ev.text}`;
      continue;
    }
    out.push(ev);
  }
  return out;
}

// ── ساختنِ زنجیره ─────────────────────────────────────────

/** آیا این دو، یک محل‌اند؟ («همت» و «پروژه همت» یکی‌اند) */
function samePlace(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** آخرین ساعتِ شناخته‌شده‌ی زنجیره (برای تصحیح ساعت‌های عقب‌رفته) */
function lastKnownTime(segments: Segment[]): string | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].endTime) return segments[i].endTime;
    if (segments[i].startTime) return segments[i].startTime;
  }
  return null;
}

/** افزودن شرح به قطعه، بدون تکرار */
function appendDescription(seg: Segment, text: string) {
  const t = text.trim();
  if (!t) return;
  if (!seg.description) seg.description = t;
  else if (!seg.description.includes(t)) seg.description += `؛ ${t}`;
}

/**
 * رویدادها را روی زنجیره‌ی موجود سوار می‌کند و زنجیره‌ی تازه را برمی‌گرداند.
 * ورودی تغییر نمی‌کند.
 */
export function applyEvents(
  segments: Segment[],
  events: SegmentEvent[],
): Segment[] {
  const out: Segment[] = segments.map((s) => ({ ...s }));

  for (const ev of events) {
    const last = out[out.length - 1] as Segment | undefined;

    if (ev.kind === "arrive") {
      // قطعه‌ی «باز» یعنی هنوز بسته نشده و می‌تواند کامل شود
      const open = last && !last.endTime ? last : undefined;
      const sameSpot = Boolean(
        open && !open.description && samePlace(open.place, ev.place),
      );
      // برای تصحیح، ساعتِ خودِ همین قطعه مبنای «رو به جلو» نیست؛ وگرنه
      // اصلاحِ ۹:۳۰ به ۹:۰۰ به ۲۱:۰۰ تفسیر می‌شد.
      const baseline = lastKnownTime(sameSpot ? out.slice(0, -1) : out);
      const time = ev.time ? forwardInDay(ev.time, baseline) : null;

      // «اومدم» بدون محل و بدون ساعت هیچ اطلاعاتی ندارد
      if (!ev.place && !time) continue;

      if (!last) {
        out.push({
          place: ev.place,
          description: "",
          startTime: time,
          endTime: null,
        });
        continue;
      }

      /**
       * «رسیدنِ» دوباره به همان محل، وقتی هنوز کاری برایش ثبت نشده، یعنی
       * عضو دارد ساعت خودش را تصحیح می‌کند — نه اینکه دوباره جایی رفته.
       */
      if (sameSpot && open) {
        if (time) open.startTime = time;
        continue;
      }

      /**
       * قطعه‌ی بازِ بی‌محل را همین رویداد کامل می‌کند.
       * «ساعت ۱۰ اومدم» و بعد «رفتم همت» یک قطعه‌اند، نه دو تا — و قطعه‌ی
       * اولِ بی‌محل نباید به‌صورت سطرِ خالی در گزارش بماند.
       */
      if (open && !open.place && (!time || !open.startTime)) {
        if (ev.place) open.place = ev.place;
        if (time && !open.startTime) open.startTime = time;
        continue;
      }

      /**
       * «ساعت ۹ اومد» بدون محل، وقتی قطعه‌ی جاری محل دارد: این ساعتِ شروعِ
       * روز است، نه مقصدِ تازه. هرگز قطعه‌ی خالی نمی‌سازیم.
       */
      if (!ev.place) {
        if (open && !open.startTime && time) open.startTime = time;
        continue;
      }

      if (open && time) open.endTime = time;
      out.push({
        place: ev.place,
        description: "",
        startTime: time,
        endTime: null,
      });
      continue;
    }

    if (ev.kind === "at") {
      if (!last) {
        out.push({
          place: null,
          description: "",
          startTime: ev.time,
          endTime: null,
        });
        continue;
      }
      if (!last.startTime) {
        last.startTime = forwardInDay(ev.time, lastKnownTime(out.slice(0, -1)));
      } else if (!last.endTime) {
        last.endTime = forwardInDay(ev.time, last.startTime);
      }
      continue;
    }

    if (ev.kind === "leave" || ev.kind === "until") {
      const time = ev.time ? forwardInDay(ev.time, lastKnownTime(out)) : null;
      if (!time) continue;
      if (last) last.endTime = time;
      else out.push({ place: null, description: "", startTime: null, endTime: time });
      continue;
    }

    // شرح
    if (!last) {
      out.push({ place: null, description: ev.text, startTime: null, endTime: null });
      continue;
    }
    appendDescription(last, ev.text);
  }

  return compactSegments(out);
}

/**
 * حذف قطعه‌هایی که نه محل دارند نه شرح.
 * چنین قطعه‌ای در گزارش و اکسل فقط یک سطرِ خالی است. ساعت‌هایش به همسایه
 * منتقل می‌شود و اگر جایی برای انتقال نبود (مثلاً تنها قطعه‌ی روز)، حذف
 * نمی‌شود تا ساعتِ شروع/پایانِ روز از دست نرود.
 */
export function compactSegments(segments: Segment[]): Segment[] {
  const out = segments.map((s) => ({ ...s }));
  const keep: Segment[] = [];

  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    if (seg.place || seg.description.trim()) {
      keep.push(seg);
      continue;
    }
    const next = out[i + 1];
    const prev = keep[keep.length - 1];
    const startMovable = !seg.startTime || (next && !next.startTime);
    const endMovable = !seg.endTime || (prev && !prev.endTime);
    if (!startMovable || !endMovable) {
      keep.push(seg);
      continue;
    }
    if (seg.startTime && next) next.startTime = seg.startTime;
    if (seg.endTime && prev) prev.endTime = seg.endTime;
  }
  return keep;
}

/**
 * زنجیره‌ی کاملِ روز را از روی همه‌ی پیام‌های آن عضو می‌سازد.
 * همان مسیرِ قطعی است، فقط روی چند پیام پشت‌سرهم.
 */
export type DayMessage = string | { text: string; at?: string | null };

export function buildSegments(messages: DayMessage[]): Segment[] {
  let segments: Segment[] = [];
  for (const msg of messages) {
    const text = typeof msg === "string" ? msg : msg.text;
    const now = typeof msg === "string" ? null : (msg.at ?? null);
    segments = applyEvents(segments, parseMessage(text, { now }).events);
  }
  return segments;
}

/**
 * آیا این رویدادها «گزارش» هستند؟
 *
 * قاعده عمداً سخاوتمند است: **هر پیامی گزارش است، مگر آشکارا گپ باشد.**
 * تجربه‌ی گروه واقعی نشان داد قاعده‌ی سخت‌گیرانه (فقط جمله‌های فعل‌دار)
 * گزارش‌های اسمی را بی‌صدا دور می‌ریزد — «پیگیری کارهای ساختمان آمود برای
 * رفع نواقص» هیچ‌جا ثبت نشد و فرستنده هم خبردار نشد. گزارشِ گم‌شده گران‌تر
 * از یک سطر اضافه است؛ سطر اضافه با /undo پاک می‌شود.
 *
 * پیام گزارش نیست فقط وقتی: هیچ ساعت و جابه‌جایی ندارد، **و** یا همه‌ی
 * واژه‌هایش تعارف است، یا آن‌قدر کوتاه است که فعلی هم ندارد.
 */
export function isReportable(events: SegmentEvent[]): boolean {
  return events.some((ev) => {
    if (ev.kind !== "note") return true; // ساعت یا جابه‌جایی، همیشه گزارش است

    const words = ev.text
      .split(/\s+/)
      .map((w) => normalizeToken(w))
      .filter((w) => /[؀-ۿa-zA-Z0-9]/.test(w));

    if (!words.length) return false; // فقط ایموجی یا نشانه
    if (words.every((w) => CHITCHAT_WORDS.has(w))) return false;
    if (words.length >= 3) return true;
    // جمله‌ی کوتاه فقط با فعل گزارش است: «جلسه داشتیم» آری، «باشه» نه
    return ev.text.split(/\s+/).some((w) => isVerbToken(w));
  });
}

/** ساعت شروع و پایانِ کلِ روز، از اولین و آخرین قطعه */
export function dayBounds(segments: Segment[]): {
  start: string | null;
  end: string | null;
} {
  const start = segments.find((s) => s.startTime)?.startTime ?? null;
  let end: string | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].endTime) {
      end = segments[i].endTime;
      break;
    }
  }
  return { start, end };
}
