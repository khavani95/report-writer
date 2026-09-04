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
} from "@/services/time-parse";
import { normalizeName } from "@/lib/text-normalize";

export type SegmentEvent =
  /** رسیدن به یک محل — قطعه‌ی تازه‌ای باز می‌کند */
  | { kind: "arrive"; time: string | null; place: string | null }
  /** ترک کردن — قطعه‌ی باز را می‌بندد */
  | { kind: "leave"; time: string | null }
  /** «تا ۵ اونجا بودم» — فقط پایانِ قطعه‌ی جاری */
  | { kind: "until"; time: string }
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
];

/** پسوندهای شناسه‌ی فعل */
const VERB_SUFFIXES = ["", "م", "ی", "یم", "ید", "ن", "ند", "ه", "ه‌ام", "ه‌اند"];

/** واژه‌هایی که ابتدای مقصد می‌آیند و بخشی از نام محل نیستند */
const PLACE_PREFIXES = ["به", "در", "سمت", "طرف", "سراغ", "سوی", "تو", "توی"];

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

/** آیا این واژه می‌تواند شروع یک عبارتِ زمانی باشد؟ */
function isTimeToken(t?: string): boolean {
  if (!t) return false;
  const n = normalizeToken(t);
  return n === "ساعت" || /^\d{1,2}(:\d{2})?$/.test(n);
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
      // «۸ و نیم» یک عبارتِ زمانی است، نه دو بند
      const isHalfHour = normalizeToken(tokens[i + 1] ?? "") === "نیم";
      const isConnector =
        !isHalfHour && (t === "و" || t === "سپس" || t === "بعدش");
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
    if (t === "ساعت" || isVerbToken(tokens[i])) return true;
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
    // «تا ساعت ۵» یا «ساعت ۵»
    let j = i + 1;
    if (normalizeToken(tokens[j] ?? "") === "ساعت") j += 1;
    if (!/^\d{1,2}(:\d{2})?$/.test(normalizeToken(tokens[j] ?? ""))) continue;
    // واژه‌های «صبح/عصر/شب» و «و نیم» بعد از عدد هم بخشی از عبارت‌اند
    let end = j + 1;
    const expr: string[] = [tokens[j]];
    while (end < tokens.length) {
      const n = normalizeToken(tokens[end]);
      if (/^(صبح|عصر|ظهر|شب|بامداد|غروب|بعدازظهر)$/.test(n)) {
        expr.push(tokens[end]);
        end += 1;
        continue;
      }
      if (n === "و" && normalizeToken(tokens[end + 1] ?? "") === "نیم") {
        expr.push(tokens[end], tokens[end + 1]);
        end += 2;
        continue;
      }
      break;
    }
    return { expr: expr.join(" "), start: i, end, until };
  }
  return null;
}

/** مقصد را از واژه‌های بعد از فعل بیرون می‌کشد (خالی یعنی «ترک کردن») */
function extractPlace(tokens: string[], from: number): string | null {
  let i = from;
  // حذف حرف اضافه‌ی ابتدای مقصد: «رفتم به دفتر»
  while (i < tokens.length && PLACE_PREFIXES.includes(normalizeToken(tokens[i]))) {
    i += 1;
  }
  // اگر بعد از مقصد فعلی هست، یعنی شرحِ کار هم چسبیده؛ مقصد را کوتاه‌تر می‌گیریم
  const tailHasVerb = tokens.slice(i).some((t) => isVerbToken(t));
  const max = tailHasVerb ? 2 : 3;

  const words: string[] = [];
  for (let k = i; k < tokens.length && words.length < max; k++) {
    const n = normalizeToken(tokens[k]);
    if (!n) continue;
    if (isVerbToken(tokens[k])) break;
    if (n === "تا" || n === "ساعت" || n === "که" || n === "ولی" || n === "اما") break;
    if (NOTE_PREFIXES.includes(n)) break;
    if (/^\d/.test(n)) break;
    words.push(tokens[k]);
  }
  const place = words.join(" ").replace(/\s+(رو|را)$/, "").trim();
  return place || null;
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
function classifyClause(clause: string): SegmentEvent[] {
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
    const t = parseSingleTime(time.expr, "exit");
    if (t) events.push({ kind: "until", time: t });
    const note = cleanNote(rest);
    if (isMeaningful(note)) events.push({ kind: "note", text: note });
    return events;
  }

  if (verbKind) {
    const place = verbKind === "leave" ? null : extractPlace(rest, verbIdx + 1);
    const arriving = verbKind === "arrive" || (verbKind === "move" && !!place);
    const t = time
      ? parseSingleTime(time.expr, arriving ? "entry" : "exit")
      : null;

    const events: SegmentEvent[] = [
      arriving
        ? { kind: "arrive", time: t, place }
        : { kind: "leave", time: t },
    ];

    // اگر بعد از مقصد هنوز جمله‌ای مانده، شرحِ کار است
    const placeWords = place ? place.split(/\s+/).length : 0;
    const tail = rest.slice(verbIdx + 1 + placeWords);
    const note = cleanNote(tail);
    if (isMeaningful(note) && tail.some((t2) => isVerbToken(t2))) {
      events.push({ kind: "note", text: note });
    }
    return events;
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
    if (!/^[؀-ۿ]{2,}$/.test(n)) break;
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
export function parseMessage(text: string): ParsedMessage {
  const { name, rest } = splitLeadingName(text);
  const events: SegmentEvent[] = [];
  for (const clause of splitClauses(rest)) {
    events.push(...classifyClause(clause));
  }
  return { personName: name, events: mergeNotes(events) };
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
      /**
       * «رسیدنِ» دوباره به همان محل، وقتی هنوز کاری برایش ثبت نشده، یعنی
       * عضو دارد ساعت خودش را تصحیح می‌کند — نه اینکه دوباره جایی رفته.
       * در گروه واقعی دیده شد: «ساعت ۹:۳۰ اومدم همت» و بعد «ساعت ۹ اومدم
       * همت»؛ بدون این قاعده سه قطعه‌ی «همت» ساخته می‌شد که دوتاش خالی بود
       * و در جدول ماهانه هم دیده می‌شد.
       */
      const sameSpot = Boolean(
        last && !last.description && !last.endTime && samePlace(last.place, ev.place),
      );
      // برای تصحیح، ساعتِ خودِ همین قطعه مبنای «رو به جلو» نیست؛ وگرنه
      // اصلاحِ ۹:۳۰ به ۹:۰۰ به ۲۱:۰۰ تفسیر می‌شد.
      const baseline = lastKnownTime(sameSpot ? out.slice(0, -1) : out);
      const time = ev.time ? forwardInDay(ev.time, baseline) : null;

      if (sameSpot && last) {
        if (time) last.startTime = time;
        if (ev.place && !last.place) last.place = ev.place;
        continue;
      }
      // قطعه‌ی «فقط شرح» (بدون محل و ساعت) هنوز جا دارد؛ همان را کامل می‌کنیم
      if (last && !last.place && !last.startTime && !last.endTime) {
        last.place = ev.place;
        last.startTime = time;
        continue;
      }
      if (last && !last.endTime && time) last.endTime = time;
      out.push({
        place: ev.place,
        description: "",
        startTime: time,
        endTime: null,
      });
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

  return out;
}

/**
 * زنجیره‌ی کاملِ روز را از روی همه‌ی پیام‌های آن عضو می‌سازد.
 * همان مسیرِ قطعی است، فقط روی چند پیام پشت‌سرهم.
 */
export function buildSegments(messages: string[]): Segment[] {
  let segments: Segment[] = [];
  for (const msg of messages) {
    segments = applyEvents(segments, parseMessage(msg).events);
  }
  return segments;
}

/**
 * آیا این رویدادها «گزارش» هستند؟
 *
 * در گروه، هر پیامی گزارش نیست: «سلام»، «ممنون»، «باشه» نباید روز باز کنند
 * یا به زنجیره بچسبند. گزارش یعنی دست‌کم یک ساعت/جابه‌جایی، یا شرحی که
 * فعل دارد («صورت وضعیت رو رسیدگی کردم»).
 */
export function isReportable(events: SegmentEvent[]): boolean {
  return events.some((ev) => {
    if (ev.kind !== "note") return true;
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
