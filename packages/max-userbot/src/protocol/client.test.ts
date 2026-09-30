import { describe, expect, test } from "bun:test";
import { nextFrameSequence } from "./client";

describe("nextFrameSequence", () => {
	test("зацикливает uint16 sequence без переполнения заголовка", () => {
		expect(nextFrameSequence(65_534)).toBe(65_535);
		expect(nextFrameSequence(65_535)).toBe(1);
	});

	test("не переиспользует sequence ожидающего запроса", () => {
		expect(nextFrameSequence(65_535, (seq) => seq === 1)).toBe(2);
	});
});

// A TCP peer that never completes TLS must not hold a login command forever.
test("bounds a stalled TLS handshake and closes the socket", async () => {
	const { createServer } = await import("node:net");
	const { MaxProtocolClient } = await import("./client");
	const sockets = new Set<import("node:net").Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.resume();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing address");
	const errors: Error[] = [];
	const client = new MaxProtocolClient({
		host: "127.0.0.1",
		port: address.port,
		connectTimeoutMs: 20,
		onClose: (error) => errors.push(error),
	});
	try {
		await expect(client.connect()).rejects.toThrow("Истекло время подключения");
		expect(errors).toHaveLength(1);
		await expect(client.request(1, {})).rejects.toThrow("не подключён");
	} finally {
		client.close();
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
