# k3s access

The k3s cluster (`prochub.mott.ai`) has no external access to services like Postgres — it was closed on 2026-07-30 (removed the `postgres-external` NodePort and the `0.0.0.0/0` NetworkPolicy rule in [k3s/postgres.yaml](k3s/postgres.yaml)).

To manage the cluster (Claude and Codex both), use the kubeconfig committed at [k3s/k3s.yml](k3s/k3s.yml):

```bash
export KUBECONFIG=k3s/k3s.yml
kubectl get pods -n psi-opora
```

For direct DB access, use `kubectl exec` into the postgres pod or `kubectl port-forward svc/postgres 5432:5432 -n psi-opora` — there is no NodePort/LoadBalancer for Postgres anymore.
