"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { MaxPersonalConnectorClient } from "./max-personal-connector-client";

export default function MaxPersonalConnectorPage() {
	return (
		<Suspense fallback={null}>
			<PageContent />
		</Suspense>
	);
}

function PageContent() {
	const params = useSearchParams();
	return (
		<div className="p-2">
			<MaxPersonalConnectorClient
				lineId={params.get("line") ?? ""}
				connectorId={params.get("connector") ?? ""}
			/>
		</div>
	);
}
