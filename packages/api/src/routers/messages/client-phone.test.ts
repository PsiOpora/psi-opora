import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { createRouterClient } from "@orpc/server";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import * as queries from "@psi-opora/db/queries";
import { createORPCContext } from "../../orpc";
import { retryClientPhoneLink, setClientPhone } from "./client-phone";
import * as bindings from "./crm-contact";
import * as urls from "./crm-urls";

const input = {
	messenger: "telegram" as const,
	userId: "alias",
	phone: "4951234567",
};
const call = mock(async (method: string): Promise<unknown> => {
	switch (method) {
		case "crm.contact.add":
			return 42;
		case "crm.contact.update":
			return true;
		case "crm.contact.get":
			return { NAME: "Тест", PHONE: [{ ID: "7", VALUE: "+74951234568" }] };
		case "crm.deal.get":
			return {};
		case "crm.duplicate.findbycomm":
			return { CONTACT: [] };
		default:
			throw new Error(`Unexpected CRM call: ${method}`);
	}
});
const context = {
	...createORPCContext({
		headers: new Headers(),
		session: null,
		memberId: null,
		bitrixSession: {
			app: "clients",
			memberId: "test",
			userId: "1",
			domain: "example.test",
			exp: 9999999999,
		},
	}),
	getBitrixApi: async () => ({ call }) as unknown as BitrixApi,
};
const client = createRouterClient(
	{ setClientPhone, retryClientPhoneLink },
	{ context },
);

beforeEach(() => {
	call.mockClear();
	spyOn(queries, "resolveCanonicalIdentity").mockResolvedValue({
		messenger: "max",
		userId: "canonical",
	});
	spyOn(queries, "getBotUserProfile").mockResolvedValue(null);
	spyOn(urls, "resolvePortalDomain").mockResolvedValue("example.test");
	spyOn(bindings, "resolveDialogCrmBindings").mockResolvedValue({
		contactId: null,
		dealId: "99",
		leadId: null,
	});
});
afterEach(() => mock.restore());

describe("phone save and CRM link persistence", () => {
	for (const scenario of [
		"created",
		"added",
		"updated",
		"unchanged",
		"linked",
	] as const) {
		test(`${scenario}: retains saved phone and retries only the same CRM link`, async () => {
			if (["added", "updated", "unchanged"].includes(scenario)) {
				spyOn(bindings, "resolveDialogCrmBindings").mockResolvedValue({
					contactId: "42",
					dealId: "99",
					leadId: null,
				});
			}
			if (scenario === "linked") {
				call.mockImplementationOnce(async () => ({})); // crm.deal.get
				call.mockImplementationOnce(async () => ({ CONTACT: [42] }));
			}
			const persist = spyOn(queries, "upsertBitrixCrmLink")
				.mockRejectedValueOnce(new Error("database unavailable"))
				.mockResolvedValue(undefined);
			const result = await client.setClientPhone({
				...input,
				...(scenario === "updated" ? { replaceValueId: "7" } : {}),
				...(scenario === "unchanged" ? { phone: "4951234568" } : {}),
				...(scenario === "linked" ? { linkContactId: "42" } : {}),
			});
			expect(result).toMatchObject({
				ok: true,
				outcome: scenario,
				contact: { id: "42" },
				dealId: "99",
				linkError: expect.stringContaining("database unavailable"),
			});
			if (!result.ok) throw new Error("Phone save unexpectedly failed");
			expect(result.phone).toBe(
				scenario === "unchanged" ? "+74951234568" : "+74951234567",
			);
			const crmCalls = call.mock.calls.length;
			expect(
				await client.retryClientPhoneLink({
					...input,
					contactId: result.contact.id,
					dealId: result.dealId,
				}),
			).toEqual({ linkError: null });
			expect(call).toHaveBeenCalledTimes(crmCalls);
			expect(persist.mock.calls.map(([entry]) => entry)).toEqual([
				{
					messenger: "max",
					userId: "canonical",
					contactId: "42",
					dealId: "99",
				},
				{
					messenger: "max",
					userId: "canonical",
					contactId: "42",
					dealId: "99",
				},
			]);
		});
	}

	test("CRM phone failure does not attempt to persist a link", async () => {
		spyOn(bindings, "resolveDialogCrmBindings").mockResolvedValue({
			contactId: null,
			dealId: null,
			leadId: null,
		});
		const persist = spyOn(queries, "upsertBitrixCrmLink").mockResolvedValue(
			undefined,
		);
		call.mockImplementationOnce(async () => ({ CONTACT: [] }));
		call.mockRejectedValueOnce(new Error("CRM unavailable"));
		expect(await client.setClientPhone(input)).toMatchObject({
			ok: false,
			error: expect.stringContaining("CRM unavailable"),
		});
		expect(persist).not.toHaveBeenCalled();
	});

	test("retry failure is separate and a missing deal is not overwritten", async () => {
		const persist = spyOn(queries, "upsertBitrixCrmLink").mockRejectedValue(
			new Error("database unavailable"),
		);
		expect(
			await client.retryClientPhoneLink({
				...input,
				contactId: "42",
				dealId: null,
			}),
		).toEqual({ linkError: expect.stringContaining("database unavailable") });
		expect(persist).toHaveBeenCalledWith({
			messenger: "max",
			userId: "canonical",
			contactId: "42",
		});
		expect(call).not.toHaveBeenCalled();
	});

	test("anonymous callers cannot retry linking", async () => {
		const persist = spyOn(queries, "upsertBitrixCrmLink").mockResolvedValue(
			undefined,
		);
		const anonymous = createRouterClient(
			{ retryClientPhoneLink },
			{ context: { ...context, bitrixSession: null } },
		);
		await expect(
			anonymous.retryClientPhoneLink({
				...input,
				contactId: "42",
				dealId: null,
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(persist).not.toHaveBeenCalled();
	});
});
