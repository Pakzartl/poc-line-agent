import { createHmac, timingSafeEqual } from "node:crypto";

export function createLineSignature(
	rawBody: string,
	channelSecret: string,
): string {
	return createHmac("sha256", channelSecret).update(rawBody).digest("base64");
}

export function verifyLineSignature(
	rawBody: string,
	channelSecret: string,
	signature: string | null,
): boolean {
	if (!channelSecret || !signature) {
		return false;
	}

	const expected = Buffer.from(
		createLineSignature(rawBody, channelSecret),
		"base64",
	);
	const received = Buffer.from(signature, "base64");

	if (expected.byteLength !== received.byteLength) {
		return false;
	}

	return timingSafeEqual(expected, received);
}
