/**
 * شبیه‌ساز درایور HTTP نئون.
 *
 * درایور نئون هر دستور SQL را با یک fetch جداگانه می‌فرستد؛ پس با گرفتنِ
 * fetch هم می‌شود دیدِ دقیقی از «چند رفت‌وبرگشت» داشت (که مستقیماً زمانِ
 * پاسخ بات است) و هم خودِ SQL و پارامترها را راستی‌آزمایی کرد.
 */

export interface Call {
  sql: string;
  params: unknown[];
}

/** شناسه‌ی نوعِ واقعیِ پستگرس برای ستون‌های پرکاربرد */
const TYPE_IDS = {
  int4: 23,
  int8: 20,
  text: 25,
  bool: 16,
  timestamp: 1114,
  jsonb: 3802,
} as const;

export type ColumnType = keyof typeof TYPE_IDS;
export type MockRow = Record<string, [ColumnType, string | null]>;

export type Responder = (call: Call) => MockRow[] | undefined;

export interface NeonMock {
  calls: Call[];
  restore: () => void;
  /** فقط دستورهایی که با این واژه شروع می‌شوند */
  of: (verb: string) => Call[];
}

/** جای fetch را می‌گیرد و پاسخِ نئون را شبیه‌سازی می‌کند */
export function installNeonMock(responder: Responder = () => []): NeonMock {
  const original = globalThis.fetch;
  const calls: Call[] = [];

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const call: Call = {
      sql: String(body.query ?? ""),
      params: body.params ?? [],
    };
    calls.push(call);

    const rows = responder(call) ?? [];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return new Response(
      JSON.stringify({
        command: call.sql.trim().split(/\s+/)[0].toUpperCase(),
        rowCount: rows.length,
        fields: columns.map((name) => ({
          name,
          dataTypeID: TYPE_IDS[rows[0][name][0]],
        })),
        rows: rows.map((r) => columns.map((c) => r[c][1])),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
    of: (verb) =>
      calls.filter((c) =>
        c.sql.trim().toLowerCase().startsWith(verb.toLowerCase()),
      ),
  };
}
