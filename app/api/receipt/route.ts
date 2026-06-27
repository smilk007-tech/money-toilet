import { NextResponse } from "next/server";
import { decodeReceipt, encodeReceiptForShare } from "@/lib/receipt/receiptShare";
import { saveReceipt } from "@/lib/receipt/receiptStore";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("d" in body)) {
    return NextResponse.json({ error: "missing d" }, { status: 400 });
  }

  const encoded = String((body as { d: unknown }).d);
  const data = decodeReceipt(encoded);
  if (!data) {
    return NextResponse.json({ error: "invalid receipt" }, { status: 400 });
  }

  const id = await saveReceipt(data);
  if (!id) {
    // KV 미설정 → 기존 base64url 그대로 반환 (폴백)
    return NextResponse.json({ id: encodeReceiptForShare(data), fallback: true });
  }

  return NextResponse.json({ id });
}
