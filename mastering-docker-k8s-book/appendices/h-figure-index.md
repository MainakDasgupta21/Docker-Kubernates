# Appendix H — Figure Index

Every Mermaid diagram and analogy illustration in the book, listed by figure number. Mermaid figures render natively on GitHub; PNGs live under [`assets/`](../assets/).

---

## Technical diagrams (Mermaid)

| Figure | Caption | Chapter |
|--------|---------|---------|
| Figure 00.1 | A durable learning loop — understand why, practice how, then treat production checklists as the bar you ship against. | [00-preface.md](../00-preface.md) |
| Figure 00.2 | “Production” in this curriculum is a stack of operational habits, not a cloud vendor badge. | [00-preface.md](../00-preface.md) |
| Figure 00.3 | The book roadmap moves from Docker foundations through Kubernetes, production patterns, and advanced SRE topics. | [00-preface.md](../00-preface.md) |
| Figure 00.4 | The Task API running example threads through Chapters 04, 08, 14, and 24 so the same app deepens with each part. | [00-preface.md](../00-preface.md) |
| Figure 01.1 | Containers move dependency soup into a rebuildable image and leave only environment-specific knobs for runtime. | [01-docker-why-and-what.md](../01-docker-why-and-what.md) |
| Figure 01.2 | A VM stacks a guest OS under each app; a container isolates the process on a shared host kernel. | [01-docker-why-and-what.md](../01-docker-why-and-what.md) |
| Figure 01.3 | The core vocabulary — registries store images; the engine runs containers created from those images. | [01-docker-why-and-what.md](../01-docker-why-and-what.md) |
| Figure 01.4 | A first mental model of `docker run` — resolve the image, create the instance, start the process. | [01-docker-why-and-what.md](../01-docker-why-and-what.md) |
| Figure 01.5 | A quick fitness check before containerizing everything — packaging wins when environments repeat and the kernel matches. | [01-docker-why-and-what.md](../01-docker-why-and-what.md) |
| Figure 02.1 | Beginners usually pick Desktop on Windows/macOS or Engine on Linux — both end at the same verify step. | [02-docker-installation-and-architecture.md](../02-docker-installation-and-architecture.md) |
| Figure 02.2 | A `docker` request travels from the CLI through the Engine API, dockerd, containerd, and runc to the container process. | [02-docker-installation-and-architecture.md](../02-docker-installation-and-architecture.md) |
| Figure 02.3 | The `docker run hello-world` pipeline — pull if needed, start the process, optionally clean up. | [02-docker-installation-and-architecture.md](../02-docker-installation-and-architecture.md) |
| Figure 02.4 | On Desktop, the client runs on the host OS while containers run inside a managed Linux engine. | [02-docker-installation-and-architecture.md](../02-docker-installation-and-architecture.md) |
| Figure 03.1 | Read-only image layers stack under a thin writable container layer; multiple containers can share the same lower layers. | [03-docker-images-deep-dive.md](../03-docker-images-deep-dive.md) |
| Figure 03.2 | Tags are movable pointers; digests identify exact bytes you promote. | [03-docker-images-deep-dive.md](../03-docker-images-deep-dive.md) |
| Figure 03.3 | Put stable work early — a source edit should not rebuild dependency layers. | [03-docker-images-deep-dive.md](../03-docker-images-deep-dive.md) |
| Figure 03.4 | A multi-platform tag is an index that points at per-architecture manifests and their layers. | [03-docker-images-deep-dive.md](../03-docker-images-deep-dive.md) |
| Figure 04.1 | The build context is everything you hand the daemon — `.dockerignore` keeps junk and secrets out before `COPY` ever runs. | [04-dockerfiles-and-builds.md](../04-dockerfiles-and-builds.md) |
| Figure 04.2 | BuildKit separates ephemeral mounts (cache, secrets) from what gets committed into image layers. | [04-dockerfiles-and-builds.md](../04-dockerfiles-and-builds.md) |
| Figure 04.3 | Multi-stage builds compile or install in a heavy stage, then copy only runtime artifacts into a slim final image. | [04-dockerfiles-and-builds.md](../04-dockerfiles-and-builds.md) |
| Figure 04.4 | Prefer exec-form `ENTRYPOINT`/`CMD` so overrides stay predictable and signals reach the real process. | [04-dockerfiles-and-builds.md](../04-dockerfiles-and-builds.md) |
| Figure 05.1 | Container lifecycle states — create, run, pause, exit, restart, and remove. | [05-docker-containers-management.md](../05-docker-containers-management.md) |
| Figure 05.2 | Applications should log to stdout/stderr; the driver decides whether `docker logs` or an external platform is the reader. | [05-docker-containers-management.md](../05-docker-containers-management.md) |
| Figure 05.3 | Restart policies close the gap after exit — pair them with healthy images so you do not automate a crash loop. | [05-docker-containers-management.md](../05-docker-containers-management.md) |
| Figure 05.4 | A fixed debugging order prevents thrashing — status, logs, inspect, then controlled reproduce. | [05-docker-containers-management.md](../05-docker-containers-management.md) |
| Figure 06.1 | On the default bridge, containers connect through veth pairs to `docker0`; outbound traffic NATs via the host. | [06-docker-networking.md](../06-docker-networking.md) |
| Figure 06.2 | A driver decision path — start from multi-host and underlay needs, then fall back to bridge, host, or none. | [06-docker-networking.md](../06-docker-networking.md) |
| Figure 06.3 | Dual-network attachment — the API bridges trust zones while the database stays on the backend network only. | [06-docker-networking.md](../06-docker-networking.md) |
| Figure 06.4 | Publishing opens a host door; `EXPOSE` alone documents intent and does not forward traffic. | [06-docker-networking.md](../06-docker-networking.md) |
| Figure 07.1 | Stopping keeps the writable layer; removing the container deletes it — and any data that lived only there. | [07-docker-volumes-and-data.md](../07-docker-volumes-and-data.md) |
| Figure 07.2 | Three mount styles — Docker-managed volumes, host bind paths, and RAM-backed tmpfs. | [07-docker-volumes-and-data.md](../07-docker-volumes-and-data.md) |
| Figure 07.3 | Persist write-heavy data on volumes — leave copy-on-write for ephemeral container filesystem changes. | [07-docker-volumes-and-data.md](../07-docker-volumes-and-data.md) |
| Figure 07.4 | Backup and restore with a throwaway container — archive the volume to the host, then extract into a fresh volume. | [07-docker-volumes-and-data.md](../07-docker-volumes-and-data.md) |
| Figure 08.1 | Compose turns one declarative file into networks, services, and volumes — and tears them down as a unit. | [08-docker-compose.md](../08-docker-compose.md) |
| Figure 08.2 | A minimal Compose topology — API and database on a private network, volume on the database, published API port only. | [08-docker-compose.md](../08-docker-compose.md) |
| Figure 08.3 | Health-aware dependency ordering — the API waits until Postgres is healthy, not merely started. | [08-docker-compose.md](../08-docker-compose.md) |
| Figure 08.4 | Compose Watch maps path changes to sync, rebuild, or restart actions for a fast local loop. | [08-docker-compose.md](../08-docker-compose.md) |
| Figure 09.1 | Managers store desired state and schedule work; workers run the assigned tasks. | [09-docker-swarm-intro.md](../09-docker-swarm-intro.md) |
| Figure 09.2 | Swarm continuously reconciles declared replica counts with running tasks. | [09-docker-swarm-intro.md](../09-docker-swarm-intro.md) |
| Figure 09.3 | The routing mesh opens the published port on every node and forwards to healthy replicas wherever they run. | [09-docker-swarm-intro.md](../09-docker-swarm-intro.md) |
| Figure 09.4 | Secrets and configs inject files into tasks without baking content into the image. | [09-docker-swarm-intro.md](../09-docker-swarm-intro.md) |
| Figure 10.1 | Prefer baking non-root into the image; override at run time when you must consume someone else's image. | [10-docker-security-basics.md](../10-docker-security-basics.md) |
| Figure 10.2 | Drop everything, then add back only capabilities you can document. | [10-docker-security-basics.md](../10-docker-security-basics.md) |
| Figure 10.3 | Defense in depth — each layer independently shrinks what an attacker can do if an inner boundary fails. | [10-docker-security-basics.md](../10-docker-security-basics.md) |
| Figure 10.4 | Modern signing verifies provenance at promotion time — prefer cosign or Notation over deprecated DCT. | [10-docker-security-basics.md](../10-docker-security-basics.md) |
| Figure 10.5 | Scanning is a loop — remediate, rebuild, re-sign, and scan again as CVEs land. | [10-docker-security-basics.md](../10-docker-security-basics.md) |
| Figure 11.1 | Docker runs one command once; Kubernetes declares desired state and controllers converge the port continuously. | [11-kubernetes-introduction.md](../11-kubernetes-introduction.md) |
| Figure 11.2 | Every change flows through the API server; etcd holds truth while controllers and kubelets watch and act. | [11-kubernetes-introduction.md](../11-kubernetes-introduction.md) |
| Figure 11.3 | The reconciliation loop observes, compares, and acts until current state matches desired state. | [11-kubernetes-introduction.md](../11-kubernetes-introduction.md) |
| Figure 11.4 | Self-healing is reconciliation: a shortfall becomes one new Pod without a human restart command. | [11-kubernetes-introduction.md](../11-kubernetes-introduction.md) |
| Figure 11.5 | Every object shares the same grammar: identity in metadata, intent in spec, observation in status. | [11-kubernetes-introduction.md](../11-kubernetes-introduction.md) |
| Figure 12.1 | Control plane decides through the API server and etcd; nodes dial out via kubelet, runtime, and kube-proxy. | [12-k8s-architecture.md](../12-k8s-architecture.md) |
| Figure 12.2 | Everything goes through the API server; nodes initiate contact and run Pods under the kubelet. | [12-k8s-architecture.md](../12-k8s-architecture.md) |
| Figure 12.3 | Every API request walks authentication, authorization, admission, validation, then etcd. | [12-k8s-architecture.md](../12-k8s-architecture.md) |
| Figure 12.4 | A dead node's Lease goes stale, then Ready turns Unknown, then Pods evacuate after the taint toleration window. | [12-k8s-architecture.md](../12-k8s-architecture.md) |
| Figure 12.5 | A `kubectl apply` walks the API server, etcd, scheduler, kubelet, and runtime before status reports Ready. | [12-k8s-architecture.md](../12-k8s-architecture.md) |
| Figure 13.1 | Containers in a Pod share one network identity and declared volumes; the Pod is the schedulable unit. | [13-pods-the-fundamental-unit.md](../13-pods-the-fundamental-unit.md) |
| Figure 13.2 | Init containers run to completion in order before app containers start. | [13-pods-the-fundamental-unit.md](../13-pods-the-fundamental-unit.md) |
| Figure 13.3 | Startup gates other probes; readiness controls traffic; liveness triggers restarts; termination drains the Pod. | [13-pods-the-fundamental-unit.md](../13-pods-the-fundamental-unit.md) |
| Figure 13.4 | QoS class follows requests and limits; BestEffort Pods are first to go under pressure. | [13-pods-the-fundamental-unit.md](../13-pods-the-fundamental-unit.md) |
| Figure 13.5 | Termination removes the Pod from traffic, runs preStop, then SIGTERM, then SIGKILL after the grace period. | [13-pods-the-fundamental-unit.md](../13-pods-the-fundamental-unit.md) |
| Figure 14.1 | Controllers own Pods (or Jobs); each workload API keeps a different promise true. | [14-workloads-deployments-and-beyond.md](../14-workloads-deployments-and-beyond.md) |
| Figure 14.2 | During a rollout the Deployment owns both old and new ReplicaSets while Pods shift from old to new. | [14-workloads-deployments-and-beyond.md](../14-workloads-deployments-and-beyond.md) |
| Figure 14.3 | A RollingUpdate timeline surges new Pods, waits for readiness, then retires old ones within maxUnavailable. | [14-workloads-deployments-and-beyond.md](../14-workloads-deployments-and-beyond.md) |
| Figure 14.4 | StatefulSet ordinals get stable DNS via a headless Service and a PVC per Pod from volumeClaimTemplates. | [14-workloads-deployments-and-beyond.md](../14-workloads-deployments-and-beyond.md) |
| Figure 14.5 | HPA watches metrics and adjusts Deployment replicas so capacity tracks load. | [14-workloads-deployments-and-beyond.md](../14-workloads-deployments-and-beyond.md) |
| Figure 15.1 | Clients aim at a stable Service VIP; EndpointSlices list ready Pod IPs, so replacements do not change the VIP. | [15-k8s-services.md](../15-k8s-services.md) |
| Figure 15.2 | The EndpointSlice controller joins Service selectors with ready Pods so the dataplane can forward traffic. | [15-k8s-services.md](../15-k8s-services.md) |
| Figure 15.3 | NodePort and LoadBalancer expose the same Service forwarding path that ClusterIP uses inside the cluster. | [15-k8s-services.md](../15-k8s-services.md) |
| Figure 15.4 | CoreDNS answers short, cross-namespace, and FQDN Service names with the ClusterIP clients dial. | [15-k8s-services.md](../15-k8s-services.md) |
| Figure 15.5 | Cluster policy may cross nodes; Local and PreferClose keep traffic on the same node or closer topology when backends exist. | [15-k8s-services.md](../15-k8s-services.md) |
| Figure 16.1 | One edge VIP fans out by Host and Path to many ClusterIP Services and their Pods. | [16-ingress-and-gateway-api.md](../16-ingress-and-gateway-api.md) |
| Figure 16.2 | An Ingress object does nothing until a matching IngressClass controller programs a proxy. | [16-ingress-and-gateway-api.md](../16-ingress-and-gateway-api.md) |
| Figure 16.3 | TLS terminates at the edge using a Secret; backends often see plain HTTP on ClusterIP Services. | [16-ingress-and-gateway-api.md](../16-ingress-and-gateway-api.md) |
| Figure 16.4 | Platform owns GatewayClass and Gateway listeners; apps attach HTTPRoutes, with ReferenceGrant bridging namespaces when needed. | [16-ingress-and-gateway-api.md](../16-ingress-and-gateway-api.md) |
| Figure 16.5 | Whether you use Ingress or Gateway API, the Task API still sits behind the same ClusterIP Service. | [16-ingress-and-gateway-api.md](../16-ingress-and-gateway-api.md) |
| Figure 17.1 | Promote the same image across environments; only ConfigMaps and Secrets change. | [17-configuration-and-secrets.md](../17-configuration-and-secrets.md) |
| Figure 17.2 | ConfigMaps inject as environment variables or mounted files without rebuilding the image. | [17-configuration-and-secrets.md](../17-configuration-and-secrets.md) |
| Figure 17.3 | Secrets reach the app as env vars or files; file mounts leak less via process listings. | [17-configuration-and-secrets.md](../17-configuration-and-secrets.md) |
| Figure 17.4 | A projected volume merges ConfigMap, Secret, SA token, and Downward API sources into one directory. | [17-configuration-and-secrets.md](../17-configuration-and-secrets.md) |
| Figure 17.5 | External managers remain the system of record; ESO syncs Secrets or CSI mounts values straight into Pods. | [17-configuration-and-secrets.md](../17-configuration-and-secrets.md) |
| Figure 18.1 | `emptyDir` vanishes with the Pod; a PVC-backed volume survives recreate because the claim stays bound to the PV. | [18-k8s-storage.md](../18-k8s-storage.md) |
| Figure 18.2 | Pods mount claims; claims bind to volumes; StorageClasses drive dynamic provisioning. | [18-k8s-storage.md](../18-k8s-storage.md) |
| Figure 18.3 | Dynamic provisioning: PVC creation triggers CSI CreateVolume, PV bind, then kubelet NodeStage/NodePublish. | [18-k8s-storage.md](../18-k8s-storage.md) |
| Figure 18.4 | One shared RWO PVC strands Deployment replicas; StatefulSet templates give each ordinal its own claim. | [18-k8s-storage.md](../18-k8s-storage.md) |
| Figure 18.5 | Snapshot a PVC, then restore into a new claim with `dataSource` pointing at the VolumeSnapshot. | [18-k8s-storage.md](../18-k8s-storage.md) |
| Figure 19.1 | CNI choice is a trade-off among overlay simplicity, routing plus policy, eBPF performance, and cloud-native wiring. | [19-k8s-networking-cni-and-policies.md](../19-k8s-networking-cni-and-policies.md) |
| Figure 19.2 | Cross-node Pod traffic rides the CNI datapath—often via overlay encapsulation, sometimes via direct routes. | [19-k8s-networking-cni-and-policies.md](../19-k8s-networking-cni-and-policies.md) |
| Figure 19.3 | Apps resolve Service DNS names through CoreDNS to a stable ClusterIP, then to changing Pod endpoints. | [19-k8s-networking-cni-and-policies.md](../19-k8s-networking-cni-and-policies.md) |
| Figure 19.4 | Once a NetworkPolicy selects a Pod in a direction, unspecified traffic in that direction is denied. | [19-k8s-networking-cni-and-policies.md](../19-k8s-networking-cni-and-policies.md) |
| Figure 19.5 | Default-deny locks the namespace; explicit allows open frontend→task-api and DNS—everything else stays blocked. | [19-k8s-networking-cni-and-policies.md](../19-k8s-networking-cni-and-policies.md) |
| Figure 20.1 | The scheduler filters impossible nodes, scores the rest, then binds the Pod to the winner. | [20-scheduling-and-advanced-placement.md](../20-scheduling-and-advanced-placement.md) |
| Figure 20.2 | Topology spread keeps counts even across zones; soft anti-affinity prefers different hosts without stranding Pending Pods. | [20-scheduling-and-advanced-placement.md](../20-scheduling-and-advanced-placement.md) |
| Figure 20.3 | Taints repel ordinary Pods; matching tolerations (plus labels) let prepared workloads onto reserved nodes. | [20-scheduling-and-advanced-placement.md](../20-scheduling-and-advanced-placement.md) |
| Figure 20.4 | Preemption removes lower-priority Pods so a higher-priority Pod can bind when the cluster is full. | [20-scheduling-and-advanced-placement.md](../20-scheduling-and-advanced-placement.md) |
| Figure 20.5 | PDBs restrain voluntary API evictions; kubelet pressure eviction and direct deletes do not. | [20-scheduling-and-advanced-placement.md](../20-scheduling-and-advanced-placement.md) |
| Figure 21.1 | The kubelet mounts a projected ServiceAccount token; the API server authenticates the Pod, then RBAC decides authorization. | [21-rbac-and-security.md](../21-rbac-and-security.md) |
| Figure 21.2 | Subjects receive permissions through bindings that reference Roles; Roles list the API groups, resources, and verbs allowed. | [21-rbac-and-security.md](../21-rbac-and-security.md) |
| Figure 21.3 | Pod- and container-level security contexts constrain identity, privileges, filesystem writability, and capabilities. | [21-rbac-and-security.md](../21-rbac-and-security.md) |
| Figure 21.4 | Pod Security Standards tighten from privileged to restricted; roll out with warn/audit before enforce. | [21-rbac-and-security.md](../21-rbac-and-security.md) |
| Figure 21.5 | Layer RBAC, admission, NetworkPolicy, and audits—no single control contains every failure mode. | [21-rbac-and-security.md](../21-rbac-and-security.md) |
| Figure 22.1 | Metrics, logs, and traces form a triangle around workloads and the Kubernetes API—each answers different questions. | [22-observability.md](../22-observability.md) |
| Figure 22.2 | metrics-server scrapes kubelets and exposes the Metrics API used by `kubectl top` and CPU/memory HPA. | [22-observability.md](../22-observability.md) |
| Figure 22.3 | Node agents (DaemonSets) ship container logs centrally; sidecars help file-only apps; node log query reaches kubelet without SSH. | [22-observability.md](../22-observability.md) |
| Figure 22.4 | Prometheus scrapes workloads and cluster exporters; Grafana visualizes series and Alertmanager routes pages. | [22-observability.md](../22-observability.md) |
| Figure 22.5 | OpenTelemetry propagates context across hops; the Collector exports the span tree to a tracing backend. | [22-observability.md](../22-observability.md) |
| Figure 23.1 | A release is a versioned installation of a chart—install, upgrade, roll back, or uninstall as a unit. | [23-helm.md](../23-helm.md) |
| Figure 23.2 | A chart bundles metadata, default values, and Go templates that render into Kubernetes manifests. | [23-helm.md](../23-helm.md) |
| Figure 23.3 | Helm merges values with templates, renders Kubernetes objects, then installs or upgrades them as one release. | [23-helm.md](../23-helm.md) |
| Figure 23.4 | Later `-f` files and `--set` flags override earlier defaults—keep environment knobs in values files, not templates. | [23-helm.md](../23-helm.md) |
| Figure 23.5 | Subcharts are fetched as dependencies; hooks attach Jobs to install/upgrade phases—use both sparingly in GitOps flows. | [23-helm.md](../23-helm.md) |
| Figure 24.1 | ResourceQuota caps the namespace total; LimitRange sets per-container defaults and bounds so nothing arrives “unlimited.” | [24-production-best-practices.md](../24-production-best-practices.md) |
| Figure 24.2 | PDBs gate voluntary evictions such as drains; crashes and direct deletes ignore the budget. | [24-production-best-practices.md](../24-production-best-practices.md) |
| Figure 24.3 | When load rises, HPA adds replicas so average CPU utilization drops back toward the target. | [24-production-best-practices.md](../24-production-best-practices.md) |
| Figure 24.4 | Safe node maintenance is cordon → drain → work → uncordon so new Pods do not land mid-change. | [24-production-best-practices.md](../24-production-best-practices.md) |
| Figure 24.5 | Upgrade control plane first, then drain workers in waves so PDBs and capacity keep apps available. | [24-production-best-practices.md](../24-production-best-practices.md) |
| Figure 25.1 | Buildx dispatches one build definition to workers hosted by four different driver topologies. | [25-docker-build-deep-dive.md](../25-docker-build-deep-dive.md) |
| Figure 25.2 | Bake expands shared settings into parallel application targets and publishes their platform variants. | [25-docker-build-deep-dive.md](../25-docker-build-deep-dive.md) |
| Figure 25.3 | A release build publishes image bytes and attestations together so downstream policy can verify one immutable subject. | [25-docker-build-deep-dive.md](../25-docker-build-deep-dive.md) |
| Figure 26.1 | Trust accumulates through build, evidence, scan, test, signature, promotion, and admission gates. | [26-supply-chain-and-trusted-content.md](../26-supply-chain-and-trusted-content.md) |
| Figure 26.2 | SBOM, provenance, and signature answer different questions that policy combines into one decision. | [26-supply-chain-and-trusted-content.md](../26-supply-chain-and-trusted-content.md) |
| Figure 26.3 | Every release stage passes the same digest, preventing a mutable tag from changing between review and admission. | [26-supply-chain-and-trusted-content.md](../26-supply-chain-and-trusted-content.md) |
| Figure 27.1 | Engine 29 can expose either the containerd image store or the legacy overlay2 graph-driver layout while daemon data remains separate. | [27-docker-engine-operations.md](../27-docker-engine-operations.md) |
| Figure 27.2 | Logging-driver delivery settings determine whether a collector outage causes back pressure, buffering, or loss. | [27-docker-engine-operations.md](../27-docker-engine-operations.md) |
| Figure 27.3 | Rootless mode removes daemon root privilege, while userns-remap retains a rootful daemon and is incompatible with the Engine 29 containerd image store. | [27-docker-engine-operations.md](../27-docker-engine-operations.md) |
| Figure 28.1 | kubeadm bootstrap establishes the control plane before networking and worker joins make the cluster ready. | [28-cluster-lifecycle-kubeadm.md](../28-cluster-lifecycle-kubeadm.md) |
| Figure 28.2 | Stacked HA co-locates an etcd member with each control plane, whereas external-etcd HA separates the quorum onto dedicated hosts. | [28-cluster-lifecycle-kubeadm.md](../28-cluster-lifecycle-kubeadm.md) |
| Figure 28.3 | A kubeadm minor upgrade proceeds through backup, control planes, and one drained worker at a time with health gates. | [28-cluster-lifecycle-kubeadm.md](../28-cluster-lifecycle-kubeadm.md) |
| Figure 29.1 | A CRD stores desired state while an operator repeatedly reconciles child resources and reports status. | [29-extending-kubernetes.md](../29-extending-kubernetes.md) |
| Figure 29.2 | The aggregation layer keeps kube-apiserver as the front door while proxying selected API groups to an extension server. | [29-extending-kubernetes.md](../29-extending-kubernetes.md) |
| Figure 29.3 | Choose CRDs and operators for new declarative APIs, and choose CEL policies or webhooks for admission-time decisions. | [29-extending-kubernetes.md](../29-extending-kubernetes.md) |
| Figure 30.1 | Server-side apply records field-level ownership so GitOps, autoscalers, and controllers can share an object without silent overwrites. | [30-object-management-advanced.md](../30-object-management-advanced.md) |
| Figure 30.2 | Kustomize combines a reusable base with environment overlays before review and server-side apply. | [30-object-management-advanced.md](../30-object-management-advanced.md) |
| Figure 30.3 | The object-management loop renders an overlay, applies it with SSA, verifies the result, and enters a controlled debug path only when needed. | [30-object-management-advanced.md](../30-object-management-advanced.md) |
| Figure 31.1 | Tenancy is a spectrum of isolation strength, not a binary choice. | [31-multitenancy-policy-governance.md](../31-multitenancy-policy-governance.md) |
| Figure 31.2 | Multitenancy relies on layered authorization, admission, resource, network, and runtime controls rather than namespaces alone. | [31-multitenancy-policy-governance.md](../31-multitenancy-policy-governance.md) |
| Figure 31.3 | API Priority and Fairness classifies requests, protects concurrency, and rejects only after the matching queue fills. | [31-multitenancy-policy-governance.md](../31-multitenancy-policy-governance.md) |
| Figure 32.1 | A ClusterIP is a virtual IP realized by kernel DNAT; kube-proxy programs the rules from EndpointSlices. | [32-advanced-networking-traffic.md](../32-advanced-networking-traffic.md) |
| Figure 32.2 | CoreDNS answers Kubernetes service names from cluster state and forwards non-cluster names to upstream DNS. | [32-advanced-networking-traffic.md](../32-advanced-networking-traffic.md) |
| Figure 32.3 | Gateway API separates listener ownership from an HTTPRoute that progressively splits traffic between stable and canary backends. | [32-advanced-networking-traffic.md](../32-advanced-networking-traffic.md) |
| Figure 33.1 | The error budget is spent over the window; burn-rate alerts fire on the slope, not just the level. | [33-day2-operations-and-sre.md](../33-day2-operations-and-sre.md) |
| Figure 33.2 | DRA carries a ResourceClaim from advertised capacity through scheduling, driver preparation, and device injection. | [33-day2-operations-and-sre.md](../33-day2-operations-and-sre.md) |
| Figure 33.3 | RPO measures backward from the disaster to the last recoverable data, while RTO measures forward to restored service. | [33-day2-operations-and-sre.md](../33-day2-operations-and-sre.md) |

---

## Analogy illustrations and cover (PNG)

| Asset | Alt / role | Used in |
|-------|------------|---------|
| `assets/analogy-shipping-containers.png` | Shipping container yard with crane and stacked containers | [00-preface.md](../00-preface.md) |
| `assets/analogy-shipping-containers.png` | Shipping containers representing portable software packages | [01-docker-why-and-what.md](../01-docker-why-and-what.md) |
| `assets/analogy-restaurant-kitchen.png` | Restaurant kitchen stations representing Docker architecture roles | [02-docker-installation-and-architecture.md](../02-docker-installation-and-architecture.md) |
| `assets/analogy-skyscraper-layers.png` | Skyscraper cutaway showing stacked floors like image layers | [03-docker-images-deep-dive.md](../03-docker-images-deep-dive.md) |
| `assets/analogy-apartment-building.png` | Apartment building analogy for Docker networking isolation | [06-docker-networking.md](../06-docker-networking.md) |
| `assets/analogy-whiteboard-filing.png` | Whiteboard and filing cabinet for ephemeral versus persistent data | [07-docker-volumes-and-data.md](../07-docker-volumes-and-data.md) |
| `assets/analogy-orchestra.png` | Orchestra conductor coordinating multi-service applications | [08-docker-compose.md](../08-docker-compose.md) |
| `assets/analogy-restaurant-chain.png` | Restaurant chain headquarters and branches for Swarm orchestration | [09-docker-swarm-intro.md](../09-docker-swarm-intro.md) |
| `assets/analogy-hotel-room.png` | Hotel room keycard for least-privilege container security | [10-docker-security-basics.md](../10-docker-security-basics.md) |
| `assets/analogy-shipping-port.png` | Shipping port control tower for Kubernetes orchestration | [11-kubernetes-introduction.md](../11-kubernetes-introduction.md) |
| `assets/analogy-hotel-minibar.png` | Hotel mini-bar and basement inventory for persistent storage | [18-k8s-storage.md](../18-k8s-storage.md) |
| `assets/analogy-city-grid.png` | City street grid for cluster networking and policies | [19-k8s-networking-cni-and-policies.md](../19-k8s-networking-cni-and-policies.md) |
| `assets/analogy-concert-seating.png` | Concert seating chart for Kubernetes scheduling placement | [20-scheduling-and-advanced-placement.md](../20-scheduling-and-advanced-placement.md) |
| `assets/analogy-keys-badges.png` | Keys and badges for RBAC and cluster access control | [21-rbac-and-security.md](../21-rbac-and-security.md) |
| `assets/analogy-instrument-panel.png` | Aircraft instrument panel for metrics logs and traces | [22-observability.md](../22-observability.md) |
| `assets/analogy-flatpack-furniture.png` | Flat-pack furniture assembly for Helm charts and values | [23-helm.md](../23-helm.md) |
| `assets/analogy-airline-ops.png` | Airline operations center for production cluster operations | [24-production-best-practices.md](../24-production-best-practices.md) |
| `assets/cover-mastering-docker-k8s.png` | Book cover for Mastering Docker and Kubernetes | [README.md](../README.md) |

---

**Prev:** [Appendix G — Version Migration](g-version-migration.md) · **Next:** [Back to README](../README.md)

