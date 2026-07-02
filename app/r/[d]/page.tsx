import { decodeReceipt, fmtWon, heroAmount } from "@/lib/receipt/receiptShare";
import { buildShareMetadata } from "@/lib/ogMeta";
import { SHORT_ID_RE, loadReceipt } from "@/lib/receipt/receiptStore";
import { resolveSiteUrl } from "@/lib/siteUrl";
import PayslipShare from "@/components/PayslipShare";
import ReceiptMissing from "@/components/ReceiptMissing";

type Props = { params: Promise<{ d: string }> };
const siteUrl = resolveSiteUrl();

// 영수증은 한 번 생성되면 불변(덮어쓰기 경로 없음, 30일 TTL 후 소멸) → ISR로 길게 캐시해
// 동일 d 재방문 시 Redis 재조회 자체를 건너뛴다(렌더 결과를 Vercel이 캐시).
export const revalidate = 2592000; // 30일 — Redis TTL과 동일
async function resolveData(d: string) {
  return SHORT_ID_RE.test(d) ? await loadReceipt(d) : decodeReceipt(d);
}

export async function generateMetadata({ params }: Props) {
  const { d } = await params;
  const data = await resolveData(d);
  const nick = data?.n || "익명의 볼일러";
  const hero = data ? heroAmount(data) : 0;
  return buildShareMetadata({ nick, amount: fmtWon(hero), tier: data?.p });
}

export default async function ReceiptSharePage({ params }: Props) {
  const { d } = await params;
  const data = await resolveData(d);

  if (!data) return <ReceiptMissing />;

  return <PayslipShare data={data} siteUrlHref={siteUrl} />;
}
