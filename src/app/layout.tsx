import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "گزارش فعالیت هیئت‌مدیره",
  description: "بات تلگرام گزارش روزانه و ماهانه‌ی فعالیت اعضای هیئت‌مدیره",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          fontFamily:
            "Vazirmatn, Tahoma, system-ui, -apple-system, sans-serif",
          margin: 0,
        }}
      >
        {children}
      </body>
    </html>
  );
}
