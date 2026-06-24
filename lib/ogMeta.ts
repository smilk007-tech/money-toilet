import type { Metadata } from "next";

export const SITE_NAME = "돈버는 화장실";

type ShareMetaInput = {
  nick: string;
  amount: string;
};

/** 공유 페이지 title · description · og:description (길이 가이드 준수) */
export function buildShareCopy({ nick, amount }: ShareMetaInput) {
  const title = `${nick}님이 화장실에서 ${amount} 벌었어요 · ${SITE_NAME} 변기 위 월급루팡 실시간 인증`;

  const ogDescription = `변기 위에 앉아 실시간으로 돈을 모으는 월급루팡! ${nick}님이 화장실에서 ${amount} 벌었어요. ${SITE_NAME}에 지금 접속해서 나도 같이 벌어보세요 👇`;

  const description = `근무 시간에 화장실에서 돈 버는 월급루팡 게임, ${SITE_NAME}. ${nick}님이 변기 위에서 ${amount} 벌었어요. 실시간 접속자들과 함께 쓸어담는 수입을 인증해 보세요. 무료로 지금 바로 접속해서 나도 같이 벌어보세요!`;

  return { title, description, ogDescription };
}

export function buildShareMetadata(input: ShareMetaInput): Metadata {
  const { title, description, ogDescription } = buildShareCopy(input);
  return {
    title,
    description,
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
