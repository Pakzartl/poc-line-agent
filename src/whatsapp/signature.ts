import { createHmac, timingSafeEqual } from "node:crypto";

export function createWhatsAppSignature(
	body: string,
	appSecret: string,
): string {
	return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

export function verifyWhatsAppSignature(
	body: string,
	appSecret: string,
	signature: string | null,
): boolean {
	if (!signature || !appSecret) {
		return false;
	}
	const expected = Buffer.from(createWhatsAppSignature(body, appSecret));
	const received = Buffer.from(signature);
	return (
		expected.length === received.length && timingSafeEqual(expected, received)
	);
}
