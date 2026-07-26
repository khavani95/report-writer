import JSZip from "jszip";
import { listWorkDays } from "@/db/queries";
import { loadDaySummary } from "./consolidate";
import { buildDailyExcel } from "./report-excel";
import { jalaliMonthLabel } from "@/lib/jalali";
import type { Project } from "@/db/schema";

/** حداکثر تعداد روزی که در یک درخواست پردازش می‌شود (سقف زمان اجرا) */
const MAX_DAYS = 45;

export interface MonthlyZipResult {
  buffer: Buffer;
  fileName: string;
  dayCount: number;
  skipped: number;
}

/**
 * برای هر روزِ کاری، آخرین نسخه‌ی گزارش روزانه را به‌صورت اکسل می‌سازد
 * و همه را در یک فایل زیپ بسته‌بندی می‌کند.
 * اگر ماه داده شود فقط همان ماه؛ وگرنه همه‌ی ماه‌ها با پوشه‌بندی ماهانه.
 */
export async function buildMonthlyZip(
  project: Project,
  month?: string,
): Promise<MonthlyZipResult | null> {
  const all = await listWorkDays(project.id, month);
  if (!all.length) return null;

  const days = all.slice(0, MAX_DAYS);
  const skipped = all.length - days.length;

  const zip = new JSZip();
  const safeProject = sanitize(project.name);

  for (const day of days) {
    const summary = await loadDaySummary(day.id);
    const buffer = await buildDailyExcel(project, day, summary);

    const revTag =
      day.revision > 0 ? `-rev${String(day.revision).padStart(2, "0")}` : "";
    const dateName = day.jalaliDate.replace(/\//g, "-");
    const fileName = `${dateName}${revTag}.xlsx`;

    // بدون فیلترِ ماه، هر ماه در پوشه‌ی خودش قرار می‌گیرد
    const folder = month ? "" : `${day.jalaliDate.slice(0, 7).replace("/", "-")}/`;
    zip.file(`${folder}${fileName}`, buffer);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const suffix = month
    ? sanitize(jalaliMonthLabel(month))
    : "همه‌ی-ماه‌ها";
  return {
    buffer,
    fileName: `roznegar-${safeProject}-${suffix}.zip`,
    dayCount: days.length,
    skipped,
  };
}

function sanitize(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}
