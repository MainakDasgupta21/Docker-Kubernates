# Appendix G — Version Migration

This book targets **Docker Engine 29.x** and **Kubernetes 1.36**. Use this guide if you are upgrading from the older baselines (Docker 27/28, Kubernetes 1.32–1.35) that many tutorials still mention.

---

## G.1 Docker Engine 27/28 → 29.x

### What changed that you will feel

| Area | What to expect |
|------|----------------|
| Image store | **Fresh installs** of Engine 29 default to the **containerd image store**. Upgrades keep the legacy graph driver until you migrate. Graph drivers are deprecated. |
| Data paths | With the containerd store, image/content data often lives under `/var/lib/containerd` as well as Docker’s directories. |
| userns-remap | Incompatible with the containerd image store; the store stays disabled when userns remapping is configured. |
| API clients | Engine 29 raises the minimum Engine API version; upgrade old SDKs and automation clients. |
| Firewall | Experimental `firewall-backend: nftables` exists; test carefully before enabling in production. |
| Build | BuildKit/buildx remain the default path; lean into attestations (`--sbom`, `--provenance`) for supply chain. |

### Practical migration checklist

1. Inventory hosts: `docker version` and `docker info --format '{{.Driver}}'`.
2. Decide per host: stay on legacy overlay2 until a maintenance window, or migrate intentionally.
3. Before enabling the containerd image store on an upgraded host, **push** critical images to a registry or `docker save` them—switching backends can hide local images.
4. Update CI images and agents to CLI/Engine 29.x together.
5. Re-test Compose projects (`docker compose version`) and any tools that parse `docker inspect` JSON.

Official starting points: [Engine release notes](https://docs.docker.com/engine/release-notes/), [containerd image store](https://docs.docker.com/engine/storage/containerd/).

---

## G.2 Kubernetes 1.32 → 1.36

Kubernetes supports the current release plus the previous three minor versions. Moving from 1.32 to 1.36 is a multi-hop journey: **upgrade one minor at a time** (1.32→1.33→…→1.36), never skip minors on control planes.

### Themes across these releases (high level)

- **Security defaults tighten** — prefer Restricted Pod Security where possible; review user namespaces (GA in 1.36).
- **Admission** — ValidatingAdmissionPolicy matured earlier; **MutatingAdmissionPolicy** reaches GA in 1.36 for CEL-based mutation without a custom webhook.
- **Storage** — Volume group snapshots and related CSI features mature; prefer CSI over any remaining in-tree patterns.
- **Devices / AI** — Dynamic Resource Allocation (DRA) continues to graduate pieces (admin access and prioritization features).
- **Observability** — PSI metrics and node log query improvements based on cgroup v2.

Always read the official release notes for each hop: [Kubernetes blog / releases](https://kubernetes.io/blog/).

### Cluster upgrade checklist

1. Backup etcd (or rely on your managed-control-plane snapshot story) before each control-plane bump.
2. Drain nodes with PodDisruptionBudgets in mind; verify PDBs cannot block forever.
3. Upgrade kubectl to match the cluster (±1 minor) after or with the control plane.
4. Scan manifests for removed APIs: `kubectl get --raw /apis` and the [Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/).
5. Re-validate Ingress/Gateway controllers, CNI, and CSI drivers against the new minor **before** production traffic.
6. Run smoke tests: Deployments roll, Services resolve DNS, PVCs bind, NetworkPolicies still enforce.

### Local learning clusters

```bash
$ kind create cluster --name book --image kindest/node:v1.36.0
$ kubectl version --short
```

If a feature is alpha/beta on your exact patch, check feature gates before teaching it as “always on.”

---

## G.3 Documentation hygiene

- Book chapters link to current stable URLs; when in doubt, open the docs version selector for **your** minor.
- Appendix F maps chapters to official sections.
- Prefer project docs over vendor blogs when the two disagree about defaults.

**Prev:** [Appendix F — Official Docs Map](f-official-docs-map.md) · **Next:** [Back to README](../README.md)
