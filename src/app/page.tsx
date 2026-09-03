export default function Home() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 24px",
        lineHeight: 1.9,
        color: "#1f2937",
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>📋 گزارش فعالیت هیئت‌مدیره</h1>
      <p style={{ fontSize: 18, color: "#4b5563" }}>
        بات تلگرام که از پیام‌های روزمره‌ی اعضا، گزارش روزانه و جدول ماهانه‌ی
        فعالیت می‌سازد.
      </p>

      <div
        style={{
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 12,
          padding: 20,
          marginTop: 24,
        }}
      >
        <strong>وضعیت:</strong> سرویس فعال است ✅
        <br />
        وبهوک تلگرام روی مسیر <code>/api/telegram</code> قرار دارد.
      </div>

      <h2 style={{ fontSize: 22, marginTop: 32 }}>نحوه‌ی کار</h2>
      <ol>
        <li>بات را به گروه هیئت‌مدیره اضافه کنید.</li>
        <li>هر عضو در طول روز می‌نویسد کجا رفته و چه کرده.</li>
        <li>
          <code>/report</code> گزارش امروز، <code>/month</code> خروجی اکسل ماهانه.
        </li>
      </ol>
    </main>
  );
}
