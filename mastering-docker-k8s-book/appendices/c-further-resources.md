# Appendix C — Further Resources

> *Mastering Docker and Kubernetes: From Zero to Production*

This book is a starting line, not a finish. The container ecosystem moves fast, so the single most valuable skill is knowing **where the authoritative, maintained answer lives** and how to read it against *your* installed versions. This appendix prioritizes official primary sources, then a small set of high-quality secondary ones, and closes with a concrete plan for continuing to learn.

## How to use these resources (and stay version-aware)

- **Prefer primary sources.** Vendor and project docs are updated alongside releases; blog posts and answers age quickly. When a tutorial and the official docs disagree, the docs win.
- **Pin the docs to your version.** Docker and Kubernetes docs are versioned. Kubernetes docs at [kubernetes.io/docs](https://kubernetes.io/docs/home/) have a version selector — set it to your cluster's minor version (this book targets **1.36**). For Docker (**29.x**), the reference at [docs.docker.com/reference](https://docs.docker.com/reference/) tracks current releases.
- **Trust `--help` and `explain` over any web page.** `docker <cmd> --help`, `kubectl <cmd> --help`, and `kubectl explain <resource>.<field>` describe *exactly* the binary you have installed. Web docs describe a version that may differ.
- **Read release notes before upgrading.** APIs get promoted (beta → GA) and removed. The Kubernetes [deprecation guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) tells you which `apiVersion` values disappear in which release — check it before every cluster upgrade.

---

## Docker & containers — official

- **Docker documentation home** — the canonical reference for CLI, Compose, and Desktop: <https://docs.docker.com/>
- **Dockerfile reference** — every instruction, current syntax: <https://docs.docker.com/reference/dockerfile/>
- **`docker` CLI reference** — per-command flags: <https://docs.docker.com/reference/cli/docker/>
- **Compose specification** — the vendor-neutral spec behind `docker compose`: <https://docs.docker.com/reference/compose-file/> and <https://github.com/compose-spec/compose-spec>
- **BuildKit** — the modern build engine (cache mounts, build secrets, multi-arch): <https://docs.docker.com/build/buildkit/> and <https://github.com/moby/buildkit>
- **Docker Engine release notes** — what changed and when: <https://docs.docker.com/engine/release-notes/>
- **Docker security** — hardening guidance: <https://docs.docker.com/engine/security/>
- **Docker Official Images** — vetted, maintained base images: <https://hub.docker.com/search?image_filter=official>

- **Docker Scout** — image analysis and policy: <https://docs.docker.com/scout/>
- **Docker Hardened Images** — minimal, hardened base images: <https://docs.docker.com/dhi/>
- **containerd image store** — Engine 29 default for fresh installs: <https://docs.docker.com/engine/storage/containerd/>
- See also [Appendix F — Official Docs Map](f-official-docs-map.md) and [Appendix G — Version Migration](g-version-migration.md).

## Containers — standards & underlying tech

- **OCI (Open Container Initiative)** — the image, runtime, and distribution specs everything is built on: <https://opencontainers.org/> and <https://github.com/opencontainers>
- **containerd** — the runtime used by Docker and most Kubernetes clusters: <https://containerd.io/>
- **Moby project** — the upstream open-source project behind Docker Engine: <https://mobyproject.org/>

## Kubernetes — official

- **Kubernetes documentation** — concepts, tasks, and tutorials (set the version selector): <https://kubernetes.io/docs/home/>
- **API reference** — every object and field for a given version: <https://kubernetes.io/docs/reference/kubernetes-api/>
- **kubectl reference & cheat sheet** — official command reference and quick sheet: <https://kubernetes.io/docs/reference/kubectl/> and <https://kubernetes.io/docs/reference/kubectl/cheatsheet/>
- **Deprecated API migration guide** — essential before upgrades: <https://kubernetes.io/docs/reference/using-api/deprecation-guide/>
- **Release notes / changelog** — per-release detail: <https://kubernetes.io/releases/> and <https://github.com/kubernetes/kubernetes/tree/master/CHANGELOG>
- **Pod Security Standards** — baseline/restricted profiles for workloads: <https://kubernetes.io/docs/concepts/security/pod-security-standards/>
- **Gateway API** — the successor pattern to many Ingress use cases: <https://gateway-api.sigs.k8s.io/>

## Local clusters for practice

- **kind** (Kubernetes in Docker) — throwaway clusters in containers: <https://kind.sigs.k8s.io/>
- **minikube** — single-node local cluster with addons: <https://minikube.sigs.k8s.io/docs/>
- **k3s** — lightweight, production-capable distribution: <https://docs.k3s.io/>

## Ecosystem & governance

- **CNCF (Cloud Native Computing Foundation)** — home of Kubernetes and many adjacent projects; the landscape shows what's maintained: <https://www.cncf.io/> and <https://landscape.cncf.io/>
- **Helm** — the de facto Kubernetes package manager: <https://helm.sh/docs/>
- **Kustomize** — template-free config customization (built into kubectl): <https://kubectl.docs.kubernetes.io/>

## Security & supply chain (increasingly essential)

- **Trivy** — scan images and manifests for vulnerabilities and misconfig: <https://trivy.dev/>
- **Sigstore / cosign** — sign and verify container images: <https://www.sigstore.dev/>
- **SLSA** — supply-chain integrity framework: <https://slsa.dev/>
- **NSA/CISA Kubernetes Hardening Guidance** — authoritative hardening baseline: <https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF>
- **CIS Benchmarks** for Docker and Kubernetes — audited configuration baselines: <https://www.cisecurity.org/cis-benchmarks>

## Community & staying current

- **Kubernetes Slack** — active project channels: <https://slack.k8s.io/>
- **Kubernetes blog** — release announcements and deep dives: <https://kubernetes.io/blog/>
- **Docker blog** — product and engineering updates: <https://www.docker.com/blog/>
- **KubeCon + CloudNativeCon** — talks published free on the CNCF YouTube channel: <https://www.youtube.com/@cncf>

---

## A plan for continuing to learn

Reading docs cover-to-cover rarely sticks. Deliberate, hands-on practice does. A suggested path:

1. **Build muscle memory locally.** Spin up a `kind` or `minikube` cluster and re-implement the capstone (Appendix D) from scratch without copying. Break things on purpose — delete a pod, corrupt a Secret reference — and practice diagnosing with `describe`/`logs`.
2. **Read one primary source per week.** Pick a single concept (probes, resource limits, network policies, RBAC) and read *only* the official page for it, then apply it to your practice project the same day.
3. **Track releases deliberately.** Subscribe to the Docker and Kubernetes release notes. Each cycle, skim for deprecations and one new feature to try. This is how you avoid upgrade surprises.
4. **Level up on security and observability.** These are what separate "it runs" from "it runs in production." Add image scanning (Trivy) and image signing (cosign) to your build, and add readiness/liveness probes plus resource requests/limits to every workload.
5. **Pursue verifiable depth (optional).** The CNCF's vendor-neutral certifications — **KCNA** (entry), **CKAD** (developers), **CKA** (administrators), **CKS** (security) — are well-respected and their curricula double as excellent study syllabi: <https://www.cncf.io/training/certification/>
6. **Contribute back.** Filing a clear issue or improving docs on an open-source project teaches you the internals faster than any tutorial, and the ecosystem is famously welcoming to newcomers via [Kubernetes Contributor](https://www.kubernetes.dev/) resources.

The tools will keep changing. The habits — reach for primary sources, pin to your version, verify with `--help`/`explain`, and practice by breaking and fixing — will not.

---

**Prev:** [Appendix B — kubectl Cheatsheet](b-cheatsheet-kubectl.md) · **Next:** [Appendix D — Answers](d-answers.md)
