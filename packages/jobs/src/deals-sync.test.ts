import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";

const getAllDealIds = mock(() => Promise.resolve<string[]>([]));
const deleteDeals = mock(() => Promise.resolve());
mock.module("@psi-opora/db/queries", () => ({
	deleteDeal: mock(() => Promise.resolve()),
	deleteDeals,
	getAllDealIds,
	getSyncWatermark: mock(() => Promise.resolve(null)),
	replaceDealDictionary: mock(() => Promise.resolve()),
	upsertDeals: mock(() => Promise.resolve()),
}));

const { syncDeletedDeals } = await import("./deals-sync");

function apiListing(records: unknown[]): BitrixApi {
	return {
		async call() {
			throw new Error("Unexpected call");
		},
		async list<T>() {
			return records as T[];
		},
	};
}

function apiListingIds(ids: string[]): BitrixApi {
	return apiListing(ids.map((id) => ({ ID: id })));
}

describe("syncDeletedDeals", () => {
	beforeEach(() => {
		getAllDealIds.mockClear();
		deleteDeals.mockClear();
	});

	it("удаляет из зеркала сделки, которых больше нет в Bitrix", async () => {
		getAllDealIds.mockImplementationOnce(() =>
			Promise.resolve(["1", "2", "3"]),
		);
		const api = apiListingIds(["1", "3"]);

		const result = await syncDeletedDeals(api);

		expect(result).toEqual({ deleted: 1 });
		expect(deleteDeals).toHaveBeenCalledWith(["2"]);
	});

	it("ничего не удаляет, если локальное зеркало пусто", async () => {
		getAllDealIds.mockImplementationOnce(() => Promise.resolve([]));
		const api = apiListingIds([]);

		const result = await syncDeletedDeals(api);

		expect(result).toEqual({ deleted: 0 });
		expect(deleteDeals).not.toHaveBeenCalled();
	});

	it("ничего не удаляет, если все локальные id всё ещё есть в Bitrix", async () => {
		getAllDealIds.mockImplementationOnce(() => Promise.resolve(["1", "2"]));
		const api = apiListingIds(["1", "2"]);

		const result = await syncDeletedDeals(api);

		expect(result).toEqual({ deleted: 0 });
		expect(deleteDeals).not.toHaveBeenCalled();
	});

	it("прерывает синхронизацию при невалидном ID из Bitrix", async () => {
		getAllDealIds.mockImplementationOnce(() => Promise.resolve(["1", "2"]));
		const api = apiListing([{ ID: "1" }, { ID: 2 }]);

		await expect(syncDeletedDeals(api)).rejects.toThrow();
		expect(deleteDeals).not.toHaveBeenCalled();
	});

	it("не удаляет сделки, если полный список Bitrix не получен", async () => {
		getAllDealIds.mockImplementationOnce(() => Promise.resolve(["1", "2"]));
		const api: BitrixApi = {
			async call() {
				throw new Error("Unexpected call");
			},
			async list() {
				throw new Error("Bitrix24 pagination incomplete");
			},
		};

		await expect(syncDeletedDeals(api)).rejects.toThrow(
			"pagination incomplete",
		);
		expect(deleteDeals).not.toHaveBeenCalled();
	});
});
