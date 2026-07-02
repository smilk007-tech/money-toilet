import type { Metadata } from "next";

export const SITE_NAME = "돈버는 화장실";

type ShareMetaInput = {
  nick: string;
  amount: string;
};

export function buildShareCopy({ nick, amount }: ShareMetaInput) {
  const title = `${nick}님이 변기 위에서 ${amount} 벌었어요💰`;
  const ogDescription = `이 사람 급여명세서 확인 👇`;
  const description = `근무 시간에 화장실에서 돈 벌기, 변기위의 월급루팡! 실시간 수입을 인증해 보세요`;
  return { title, description, ogDescription };
}

export function buildShareMetadata(input: ShareMetaInput): Metadata {
  const { title, description, ogDescription } = buildShareCopy(input);
  return {
    title,
    description,
    // 검색엔진 비노출(질문 20). generateMetadata 반환에 직접 포함해야
    // layout robots가 덮어써지는 문제를 피한다. OG/twitter는 유지 → 카톡 미리보기 정상.
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description: ogDescription,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: ogDescription,
    },
  };
}
