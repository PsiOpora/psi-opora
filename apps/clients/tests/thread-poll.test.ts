import { expect, mock, test } from "bun:test";
import { resolveThreadPoll } from "../src/components/inbox/thread-poll";

const snapshot = { messages: [], deletionVersion: "deleted" };

test("a deletion with no deltas replaces previously loaded history with empty history", async () => {
	const load = mock(async () => snapshot);
	expect(await resolveThreadPoll(snapshot, "[]", load)).toEqual({
		...snapshot,
		replace: true,
	});
	expect(load).toHaveBeenCalledTimes(1);
});

test("an unchanged version keeps incremental polling, even with no deltas", async () => {
	const load = mock(async () => snapshot);
	expect(await resolveThreadPoll(snapshot, "deleted", load)).toEqual({
		...snapshot,
		replace: false,
	});
	expect(load).not.toHaveBeenCalled();
});

test("reload failure propagates so the caller retains its version and retries", async () => {
	const load = mock(async () => {
		throw new Error("offline");
	});
	await expect(resolveThreadPoll(snapshot, "[]", load)).rejects.toThrow(
		"offline",
	);
	load.mockImplementation(async () => snapshot);
	expect((await resolveThreadPoll(snapshot, "[]", load))?.replace).toBe(true);
});

test("uses the reloaded version if another deletion happens during refresh", async () => {
	const newer = { messages: [], deletionVersion: "deleted-again" };
	expect(await resolveThreadPoll(snapshot, "[]", async () => newer)).toEqual({
		...newer,
		replace: true,
	});
});

test("an error response cannot advance deletion state", async () => {
	const load = mock(async () => snapshot);
	expect(await resolveThreadPoll({}, "[]", load)).toBeUndefined();
	expect(load).not.toHaveBeenCalled();
});
