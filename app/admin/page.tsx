import type { Metadata } from "next";
import AdminDashboard from "./AdminDashboard";

// 검색엔진 비노출(질문 20) — 페이지 자체에 noindex.
export const metadata: Metadata = {
  title: "MoneyToilet Admin",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
