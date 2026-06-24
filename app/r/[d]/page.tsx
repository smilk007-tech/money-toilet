import type { Metadata } from "next";
import Link from "next/link";
import { decodeReceipt, fmtWon, heroAmount } from "@/lib/receiptShare";
import { SHORT_ID_RE, loadReceipt } from "@/lib/receiptStore";
import PayslipShare from "@/components/PayslipShare";

type Props = { params: Promise<{ d: string }> };
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");
async function resolveData(d: string) {
  return SHORT_ID_RE.test(d) ? await loadReceipt(d) : decodeReceipt(d);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { d } = await params;
  const data = await resolveData(d);
  const nick = data?.n || "익명의 볼일러";
  const hero = data ? heroAmount(data) : 0;
  const title = `${nick}님이 화장실에서 ${fmtWon(hero)} 벌었어요💰`;
  const description =
    "근무시간에 싸서 번 돈 인증 · 돈버는 화장실에서 같이 벌자! 👇";
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 22,
  padding: "32px 16px",
  background: "radial-gradient(120% 120% at 50% 0%, #1b2a22 0%, #0d120f 60%)",
};
const cta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "linear-gradient(180deg,#2fd39a,#16967a)",
  color: "#03241c",
  fontWeight: 900,
  fontSize: 17,
  padding: "14px 22px",
  borderRadius: 14,
  textDecoration: "none",
  boxShadow: "0 6px 18px rgba(0,0,0,.45)",
};

export default async function ReceiptSharePage({ params }: Props) {
  const { d } = await params;
  const data = await resolveData(d);

  if (!data) {
    return (
      <main style={wrap}>
        <p style={{ color: "#eafff5", fontSize: 16, fontWeight: 700 }}>
          급여명세서를 불러올 수 없어요 🥲
        </p>
        <Link href="/" style={cta}>
          🚽 화장실 가기
        </Link>
      </main>
    );
  }

  return <PayslipShare data={data} siteUrlHref={siteUrl} />;
}
