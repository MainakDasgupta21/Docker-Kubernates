# Mastering Docker and Kubernetes: From Zero to Production

A self-contained textbook that takes you from first principles of containers to production-ready Kubernetes and day-2 operations. Every major concept is taught in **three tiers**—plain English, technical detail, and production DevOps guidance—grounded in the official [Docker](https://docs.docker.com/) and [Kubernetes](https://kubernetes.io/docs/home/) documentation.

**Assumed versions:** Docker Engine **29.x** · Kubernetes **1.36** (supported window often discussed as 1.33–1.36)  
**Audience:** Beginners through early-career DevOps/SRE engineers who want a clear path from laptop demos to production habits.

> Authoring conventions for contributors live in [STYLE-GUIDE.md](STYLE-GUIDE.md).

---

## Prerequisites

Before Chapter 01, you should be comfortable with:

- Basic command-line use (changing directories, editing a file, reading command output)
- A text editor (VS Code, Cursor, Vim, or similar)
- Rough familiarity with HTTP (request/response, ports) and a programming language at a beginner level (Python examples appear from Chapter 04)

You do **not** need prior Docker or Kubernetes experience. Linux basics help but are not required—Windows and macOS paths are covered where they differ.

**Hardware recommendations:**

| Resource | Minimum | Comfortable |
|----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB free | 40 GB free |
| OS | Windows 10/11, macOS 12+, or a current Linux distro | Same, with virtualization enabled |

---

## Reading paths

| Path | Chapters | Outcome |
|------|----------|---------|
| **Beginner** | Preface + 01–10, skim 11 | Solid Docker foundation |
| **Technical** | 01–24 | Containerize and deploy apps on Kubernetes |
| **DevOps / SRE** | Full book 01–33 + appendices | Build, secure, operate, and extend clusters |
| **Reference** | Appendices A–G | Daily CLI lookup and docs map |

Suggested pace: 1–2 chapters per sitting for the technical track; budget extra time for Part IV labs.

---

## Version Assumptions

Commands and YAML in this book target:

- **Docker Engine / Docker Desktop 29.x** (BuildKit and buildx by default; Compose V2)
- **Docker Compose V2** (`docker compose`, not the legacy `docker-compose` binary)
- **Kubernetes 1.36** (GA APIs; see Appendix G if you are still on 1.32–1.35)
- **kubectl** matching your cluster minor version whenever possible

If your tooling is older, most ideas still apply; defaults (especially the containerd image store on fresh Engine 29 installs) may differ. Prefer upgrading before fighting cryptic errors. Migration notes: [Appendix G](appendices/g-version-migration.md).

---

## Table of Contents

### Front Matter

| # | Chapter | Description | Est. time |
|---|---------|-------------|-----------|
| — | [Preface](00-preface.md) | How to use this book, three-tier learning, and what “production” means | ~20 min |
| — | [Style Guide](STYLE-GUIDE.md) | Authoring conventions (for contributors) | — |

### Part I — Docker Foundations

| # | Chapter | Description | Est. time |
|---|---------|-------------|-----------|
| 01 | [Docker: Why and What](01-docker-why-and-what.md) | Problems containers solve; containers vs VMs; core vocabulary | ~40 min |
| 02 | [Installation and Architecture](02-docker-installation-and-architecture.md) | Install Engine/Desktop; client, daemon, containerd, contexts | ~45 min |
| 03 | [Images Deep Dive](03-docker-images-deep-dive.md) | Layers, tags, digests, registries, multi-architecture images | ~50 min |
| 04 | [Dockerfiles and Builds](04-dockerfiles-and-builds.md) | Dockerfile instructions, BuildKit, build secrets, Task API | ~70 min |
| 05 | [Container Management](05-docker-containers-management.md) | Lifecycle, logs, exec, debug, limits, restart policies, logging drivers | ~55 min |
| 06 | [Docker Networking](06-docker-networking.md) | Bridge/host/none/overlay, macvlan/ipvlan, DNS, publishing ports | ~55 min |
| 07 | [Volumes and Data](07-docker-volumes-and-data.md) | Bind/named/tmpfs, containerd image store vs overlay2, backup | ~50 min |
| 08 | [Docker Compose](08-docker-compose.md) | Multi-service apps, profiles, health checks, Compose watch | ~60 min |
| 09 | [Introduction to Docker Swarm](09-docker-swarm-intro.md) | Managers/workers, services, stacks, configs/secrets, routing mesh | ~45 min |
| 10 | [Docker Security Basics](10-docker-security-basics.md) | Non-root, capabilities, seccomp/AppArmor, signing, scanning | ~50 min |

### Part II — Kubernetes Foundations

| # | Chapter | Description | Est. time |
|---|---------|-------------|-----------|
| 11 | [Introduction to Kubernetes](11-kubernetes-introduction.md) | Why orchestration; declarative model; local clusters | ~40 min |
| 12 | [Kubernetes Architecture](12-k8s-architecture.md) | Control plane, nodes, CRI, leases, CCM, request flow | ~55 min |
| 13 | [Pods: The Fundamental Unit](13-pods-the-fundamental-unit.md) | Probes, QoS, sidecars, Downward API, user namespaces, resize | ~70 min |
| 14 | [Workloads: Deployments and Beyond](14-workloads-deployments-and-beyond.md) | Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, HPA | ~70 min |
| 15 | [Kubernetes Services](15-k8s-services.md) | Service types, EndpointSlices, dual-stack, traffic policies | ~55 min |
| 16 | [Ingress and the Gateway API](16-ingress-and-gateway-api.md) | Path/host routing, TLS, Ingress controllers, Gateway API | ~60 min |
| 17 | [Configuration and Secrets](17-configuration-and-secrets.md) | ConfigMaps, Secrets, projected volumes, encryption, ESO | ~55 min |

### Part III — Toward Production

| # | Chapter | Description | Est. time |
|---|---------|-------------|-----------|
| 18 | [Kubernetes Storage](18-k8s-storage.md) | PV/PVC/StorageClass, CSI, snapshots, VolumeAttributesClass | ~55 min |
| 19 | [Networking — CNI and Policies](19-k8s-networking-cni-and-policies.md) | CNI plugins, packet flow, NetworkPolicy | ~55 min |
| 20 | [Scheduling and Placement](20-scheduling-and-advanced-placement.md) | Affinity, taints, topology spread, priority, eviction | ~60 min |
| 21 | [RBAC and Security](21-rbac-and-security.md) | RBAC, PSA, security contexts, auditing basics | ~55 min |
| 22 | [Observability](22-observability.md) | Metrics, logs, traces, PSI, node log query | ~55 min |
| 23 | [Helm](23-helm.md) | Charts, templates, values, releases | ~50 min |
| 24 | [Production Best Practices](24-production-best-practices.md) | Quotas, PDBs, autoscaling, etcd, upgrades, GC, HA | ~65 min |

### Part IV — Advanced Docker, Cluster Ops, and SRE

| # | Chapter | Description | Est. time |
|---|---------|-------------|-----------|
| 25 | [Docker Build Deep Dive](25-docker-build-deep-dive.md) | buildx, Bake, multi-platform, cache, SBOM/provenance | ~60 min |
| 26 | [Supply Chain and Trusted Content](26-supply-chain-and-trusted-content.md) | Scout, Hardened Images, signing, registry gates | ~55 min |
| 27 | [Docker Engine Operations](27-docker-engine-operations.md) | Image store, logging, rootless, daemon.json, nftables | ~60 min |
| 28 | [Cluster Lifecycle with kubeadm](28-cluster-lifecycle-kubeadm.md) | Bootstrap, HA, PKI, upgrades, etcd, node lifecycle | ~70 min |
| 29 | [Extending Kubernetes](29-extending-kubernetes.md) | CRDs, operators, aggregation, admission policies (CEL) | ~65 min |
| 30 | [Advanced Object Management](30-object-management-advanced.md) | SSA, Kustomize, JSONPath, KYAML, kuberc, kubectl debug | ~55 min |
| 31 | [Multi-tenancy and Governance](31-multitenancy-policy-governance.md) | Tenancy, quotas, PSS, APF, audit, feature gates | ~60 min |
| 32 | [Advanced Networking and Traffic](32-advanced-networking-traffic.md) | kube-proxy, DNS, dual-stack, Gateway API advanced, mesh boundary | ~60 min |
| 33 | [Day-2 Operations and SRE](33-day2-operations-and-sre.md) | SLOs, DRA/GPU, capacity, DR, incident runbooks | ~65 min |

### Appendices

| ID | Appendix | Description | Est. time |
|----|----------|-------------|-----------|
| A | [Docker Cheatsheet](appendices/a-cheatsheet-docker.md) | High-frequency `docker` / buildx commands | reference |
| B | [kubectl Cheatsheet](appendices/b-cheatsheet-kubectl.md) | High-frequency `kubectl` patterns, SSA, debug | reference |
| C | [Further Resources](appendices/c-further-resources.md) | Official docs and continued learning | reference |
| D | [Answers and Capstone](appendices/d-answers.md) | Inline answers note + Task API deploy walkthrough | ~30 min |
| E | [Glossary](appendices/e-glossary.md) | Precise definitions | reference |
| F | [Official Docs Map](appendices/f-official-docs-map.md) | Chapter → docs.docker.com / kubernetes.io index | reference |
| G | [Version Migration](appendices/g-version-migration.md) | Docker 27/28→29 and Kubernetes 1.32→1.36 | ~25 min |

**Total estimated reading time (main text):** roughly **28–36 hours**, plus exercise time.

---

## How Chapters Are Structured

1. **Learning objectives** — what you will be able to do afterward  
2. **Opening story or analogy** — intuition before jargon  
3. **Three-tier explanation** — *In plain terms* → *Under the hood* → *In production*  
4. **Pitfalls** — mistakes that waste hours in the real world  
5. **Hands-on exercises** — numbered, runnable steps  
6. **Check Your Understanding** — questions with expandable answers  
7. **Key takeaways** — compact recap  
8. **Official documentation map** — links into Docker and Kubernetes docs  
9. **Navigation links** — previous and next chapters  

Code blocks are tagged (`bash`, `dockerfile`, `yaml`, `python`, …). Shell examples use a `$` prompt for commands you type; sample output appears without that prompt.

---

## Conventions

| Convention | Meaning |
|------------|---------|
| `$ command` | Run this in your shell |
| Output below a command | Realistic sample; your IDs and timestamps will differ |
| `<!-- VISUAL: ... -->` | Placeholder for a figure you can sketch or add under `assets/` |
| Callout blocks | Tip / Warning / Common Pitfall / Deep Dive |
| American English | Spelling and phrasing throughout |

---

## Getting Started

1. Read the [Preface](00-preface.md).  
2. Install and verify Docker using [Chapter 02](02-docker-installation-and-architecture.md).  
3. Keep [Appendix A](appendices/a-cheatsheet-docker.md) and [Appendix F](appendices/f-official-docs-map.md) open as you work.

Welcome aboard—from zero to production, one clear chapter at a time.
