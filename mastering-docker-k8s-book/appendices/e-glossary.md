# Appendix E — Glossary

Concise definitions used throughout *Mastering Docker and Kubernetes*. Prefer these spellings and capitalizations in the main text.

---

## A–C

**Admission controller** — API-server plugin that validates or mutates objects before they are persisted. Includes built-ins (Pod Security Admission) and extension points (webhooks, Validating/MutatingAdmissionPolicy).

**API Priority and Fairness (APF)** — Kubernetes control-plane mechanism that classifies and queues API requests so one noisy client cannot starve the API server.

**BuildKit** — Docker’s modern build engine. Powers `docker build` and `docker buildx` on Engine 29.x.

**buildx** — CLI that drives BuildKit builders, including multi-platform and Bake workflows.

**ClusterIP** — Default Service type: a virtual IP reachable only inside the cluster.

**CNI** — Container Network Interface; plugins that wire Pod networking on nodes.

**ConfigMap** — Object that holds non-secret configuration as keys and values.

**containerd** — Container runtime used by Docker Engine and by Kubernetes via the CRI. Engine 29 uses the **containerd image store** by default on fresh installs.

**CRI** — Container Runtime Interface between kubelet and a runtime (containerd, CRI-O).

**CRD** — CustomResourceDefinition; extends the Kubernetes API with new resource types.

**CSI** — Container Storage Interface; drivers that provision and attach volumes.

---

## D–I

**DaemonSet** — Workload that runs a Pod on (usually) every node.

**Deployment** — Workload controller for stateless Pods with rolling updates and rollbacks.

**Digest** — Content-addressed image identifier (`sha256:…`), stronger than a mutable tag.

**Downward API** — Mechanism to expose Pod metadata and resource fields into the container environment or files.

**DRA** — Dynamic Resource Allocation; API for requesting devices (GPUs, NICs) via ResourceClaims.

**EndpointSlice** — Scalable replacement for Endpoints; lists ready backends for a Service.

**Ephemeral container** — Temporary debug container attached to a running Pod (`kubectl debug`).

**etcd** — Consistent key-value store that holds Kubernetes cluster state.

**Gateway API** — Next-generation Kubernetes traffic routing APIs (GatewayClass, Gateway, HTTPRoute, …).

**Helm** — Package manager for Kubernetes; charts, values, and releases.

**HPA** — HorizontalPodAutoscaler; scales replica counts from metrics.

**Image** — Immutable filesystem + metadata used to start containers.

**Ingress** — Classic HTTP(S) routing resource; requires an Ingress controller.

---

## J–P

**Job / CronJob** — Run-to-completion workloads; CronJob schedules Jobs.

**kube-proxy** — Node component that implements Service virtual IPs (iptables, IPVS, or nftables modes depending on configuration).

**kubeadm** — Official tool to bootstrap and upgrade Kubernetes clusters.

**kubectl** — Official Kubernetes CLI.

**Kustomize** — Declarative overlay tool (`kubectl kustomize` / `kubectl apply -k`).

**Layer** — Diff in a container image; stacked via a union/snapshotter filesystem.

**LimitRange** — Namespace policy that sets default/min/max resources for Pods/containers.

**MutatingAdmissionPolicy** — Native CEL-based mutating admission (GA in Kubernetes 1.36).

**Namespace** — Scope for names and many policies inside a cluster.

**NetworkPolicy** — Pod-level firewall rules enforced by a CNI that supports them.

**NodePort** — Service type that opens a port on every node to reach the Service.

**Overlay network** — Multi-host Docker network (Swarm); also a general networking term.

**PDB** — PodDisruptionBudget; limits voluntary disruptions during drains and upgrades.

**Pod** — Smallest deployable unit in Kubernetes; one or more containers sharing network/storage.

**Pod Security Standards / Admission** — Privileged, Baseline, Restricted profiles enforced by labels/admission.

**PriorityClass** — Assigns scheduling priority; enables preemption of lower-priority Pods.

**Projected volume** — Volume that projects multiple sources (Secrets, ConfigMaps, Downward API, SA token) into one directory.

**PersistentVolume / Claim** — Cluster storage (PV) requested by a workload (PVC).

---

## Q–Z

**QoS class** — Guaranteed, Burstable, or BestEffort based on requests/limits; affects eviction order.

**RBAC** — Role-Based Access Control (Role, ClusterRole, bindings).

**ReplicaSet** — Ensures a count of identical Pods; usually owned by a Deployment.

**ResourceQuota** — Namespace cap on aggregate resource usage and object counts.

**RuntimeClass** — Selects a container runtime configuration (for example, a sandboxed runtime).

**SBOM** — Software Bill of Materials; inventory of packages in an image (often built as an attestation).

**Secret** — Object for sensitive data; still base64 in etcd unless encryption-at-rest is configured.

**Server-Side Apply** — Declarative apply that tracks field managers on the API server.

**ServiceAccount** — Identity for processes running in Pods.

**Sidecar** — Helper container in a Pod; native sidecars use `restartPolicy: Always` init containers.

**StatefulSet** — Workload with stable identity and ordered storage.

**StorageClass** — Template for dynamic volume provisioning.

**Taint / Toleration** — Node repulsion and Pod opt-in for scheduling.

**VolumeSnapshot / VolumeGroupSnapshot** — Point-in-time volume copies; group snapshots are crash-consistent across multiple PVCs (GA in 1.36).

**VPA** — VerticalPodAutoscaler; suggests or applies CPU/memory requests (usually an add-on).

---

**Prev:** [Appendix D — Answers and Capstone](d-answers.md) · **Next:** [Appendix F — Official Docs Map](f-official-docs-map.md)
