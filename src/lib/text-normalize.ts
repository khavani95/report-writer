/**
 * نرمال‌سازی متن فارسی برای تطبیق نام‌ها.
 * تفاوت‌های ی/ي، ک/ك، آ/ا، فاصله‌ها و نیم‌فاصله را یکسان می‌کند.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase() // «shayan momen» و «Shayan Momen» یک نفرند
    .replace(/[ىيﻱﻲ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[‌‍‎‏]/g, "") // نیم‌فاصله و نشانه‌های جهت
    .replace(/[.,،؛;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** فاصله‌ی ویرایشی (Levenshtein) بین دو رشته */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * اسکلتِ صامتِ یک نام — پلی میان نامِ فارسی و همان نام به لاتین.
 *
 * عضوی که با دکمه‌ی «نام تلگرام» ثبت شده نامش لاتین است («Shayan Momen»)
 * ولی بقیه در گروه او را «شایان» صدا می‌زنند. بدون این نگاشت، آن دو هرگز
 * یک نفر شناخته نمی‌شدند و برای هر شکلِ نوشتن یک عضو تازه ساخته می‌شد.
 *
 * روش: مصوت‌ها حذف و صامت‌ها به نمادِ مشترک نگاشته می‌شوند.
 * «شایان مومن» → «Sn mmn» ، «Shayan Momen» → «Sn mmn».
 */
const FA_CONSONANT: Record<string, string> = {
  ب: "b", پ: "p", ت: "t", ط: "t", ث: "s", س: "s", ص: "s", ج: "j",
  چ: "C", ح: "h", ه: "h", خ: "K", د: "d", ذ: "z", ز: "z", ض: "z",
  ظ: "z", ر: "r", ژ: "Z", ش: "S", غ: "G", ق: "G", ف: "f", ک: "k",
  گ: "g", ل: "l", م: "m", ن: "n",
  // مصوت‌ها و نویسه‌های خاموش
  ا: "", آ: "", و: "", ی: "", ع: "", ء: "", ئ: "", أ: "", إ: "", ؤ: "",
};

function wordKey(word: string): string {
  // فارسی
  if (/[؀-ۿ]/.test(word)) {
    let out = "";
    for (const ch of word) out += FA_CONSONANT[ch] ?? "";
    return out;
  }
  // لاتین: اول تکرارِ نوشتاری («Mohammad» → «mohamad»)، بعد دونویسه‌ها،
  // بعد حذف مصوت‌ها. ترتیب مهم است: اگر تکرار بعد از حذف مصوت‌ها جمع شود،
  // «Momen» هم به «mn» تبدیل می‌شود و دیگر با «مومن» نمی‌خواند.
  const out = word
    .toLowerCase()
    .replace(/(.)\1+/g, "$1")
    .replace(/kh/g, "K")
    .replace(/gh/g, "G")
    .replace(/sh/g, "S")
    .replace(/ch/g, "C")
    .replace(/zh/g, "Z")
    .replace(/ph/g, "f")
    .replace(/q/g, "G")
    .replace(/w/g, "v")
    .replace(/c/g, "k")
    .replace(/x/g, "ks")
    .replace(/[aeiouy]/g, "")
    .replace(/[^a-zKGSCZ]/g, "");
  return out;
}

/** کلید آوایی کل نام (هر واژه جدا) */
export function phoneticKey(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .map(wordKey)
    .filter(Boolean);
}

/** آیا دو نام از نظر آوایی یکی‌اند؟ (سخت‌گیرانه، تا دو نفر ادغام نشوند) */
function phoneticMatch(a: string, b: string): boolean {
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (!ka.length || !kb.length) return false;

  const ja = ka.join("");
  const jb = kb.join("");
  // کلیدِ یک‌حرفی بی‌معناست. کلیدِ دوحرفی («شایان» → Sn) برخورد دارد، ولی
  // findWorkerMatch فقط تطبیقِ یکتا را می‌پذیرد؛ اگر دو عضو یک کلید داشته
  // باشند نتیجه «مبهم» می‌شود، نه ادغامِ اشتباه.
  if (ja.length < 2 || jb.length < 2) return false;
  if (ja === jb) return true;
  if (ja.length >= 5 && jb.length >= 5 && levenshtein(ja, jb) <= 1) return true;

  // اشاره با نام کوچک: «شایان» ⊆ «Shayan Momen»
  return keySubset(ka, kb) || keySubset(kb, ka);
}

/** آیا همه‌ی واژه‌های کلیدِ a زیرمجموعه‌ی واقعیِ b هستند؟ */
function keySubset(a: string[], b: string[]): boolean {
  if (!a.length || a.length >= b.length) return false;
  const set = new Set(b);
  return a.every((t) => t.length >= 2 && set.has(t));
}

/**
 * آیا دو نامِ نرمال‌شده «به‌احتمال زیاد» یک نفرند؟
 * برابرِ نرمال‌شده، یا فاصله‌ی ویرایشی ≤۱ برای نام‌های چندحرفی
 * (مثل «یدین نوری» و «ایدین نوری»).
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  if (na.length >= 6 && nb.length >= 6 && levenshtein(na, nb) <= 1) return true;
  if (tokenSubset(na, nb) || tokenSubset(nb, na)) return true;
  return phoneticMatch(na, nb);
}

/** آیا همه‌ی توکن‌های a در b هستند (برای اشاره با نام کوچک: «ایدین» ⊆ «ایدین نوری») */
function tokenSubset(a: string, b: string): boolean {
  const ta = a.split(" ").filter(Boolean);
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.length || ta.length >= tb.size + 1) return false;
  // فقط وقتی a کوتاه‌تر از b است (زیرمجموعه‌ی واقعی)
  if (ta.length >= b.split(" ").filter(Boolean).length) return false;
  return ta.every((t) => tb.has(t) && t.length >= 2);
}

/**
 * بهترین نیروی منطبق را از میان کاندیداها پیدا می‌کند.
 * هر کاندیدا فهرستی از نام‌هاست (نام کامل + نام‌های مستعار).
 * فقط وقتی نتیجه می‌دهد که تطبیق «یکتا» باشد؛ اگر چند نفر منطبق شدند،
 * برای جلوگیری از ادغام اشتباه، -۱ برمی‌گرداند.
 */
export function findWorkerMatch(
  name: string,
  candidates: string[][],
): number {
  const matches: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].some((c) => namesMatch(c, name))) matches.push(i);
  }
  // اولویت با تطبیق دقیقِ نرمال‌شده اگر بیش از یکی بود
  if (matches.length > 1) {
    const nn = normalizeName(name);
    const exact = matches.filter((i) =>
      candidates[i].some((c) => normalizeName(c) === nn),
    );
    if (exact.length === 1) return exact[0];
    return -1; // مبهم
  }
  return matches.length === 1 ? matches[0] : -1;
}
