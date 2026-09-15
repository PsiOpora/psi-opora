"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ImSidebarCrm } from "./sidebar-client";

export default function ImSidebarPage() {
	return (
		<Suspense fallback={null}>
			<ImSidebarPageContent />
		</Suspense>
	);
}

function ImSidebarPageContent() {
	const searchParams = useSearchParams();
	return (
		<div className="p-4">
			<ImSidebarCrm dialogId={searchParams.get("dialogId") ?? ""} />
		</div>
	);
}
