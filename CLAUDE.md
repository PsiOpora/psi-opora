# k3s access

The k3s cluster (`prochub.mott.ai`) has no external access to services like Postgres — it was closed on 2026-07-30 (removed the `postgres-external` NodePort and the `0.0.0.0/0` NetworkPolicy rule, formerly in `k3s/postgres.yaml`).

The entire `k3s/` directory (including the committed kubeconfig) was removed from the repo on 2026-09-10. There is currently no kubeconfig checked in — cluster access needs to be re-established another way before `kubectl` commands will work.

For direct DB access, use `kubectl exec` into the postgres pod or `kubectl port-forward svc/postgres 5432:5432 -n psi-opora` — there is no NodePort/LoadBalancer for Postgres anymore.
