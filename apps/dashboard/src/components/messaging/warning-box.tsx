export function WarningBox({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
			⚠️ {children}
		</div>
	);
}
