# Appendix F — Official Documentation Map

Use this index to jump from book chapters to the canonical pages on [Docker Docs](https://docs.docker.com/) and [Kubernetes Docs](https://kubernetes.io/docs/home/). Prefer the version of the Kubernetes docs that matches your cluster (this book targets **1.36**).

---

## Docker (docs.docker.com)

| Book chapter | Start here |
|--------------|------------|
| 01–02 | [Docker overview](https://docs.docker.com/get-started/docker-overview/), [Install Engine](https://docs.docker.com/engine/install/), [Desktop](https://docs.docker.com/desktop/) |
| 03–04, 25 | [Images](https://docs.docker.com/get-started/docker-concepts/building-images/), [Dockerfile reference](https://docs.docker.com/reference/dockerfile/), [Build](https://docs.docker.com/build/), [buildx](https://docs.docker.com/build/building/multi-platform/), [Bake](https://docs.docker.com/build/bake/) |
| 05, 27 | [Containers](https://docs.docker.com/get-started/docker-concepts/running-containers/), [Logging drivers](https://docs.docker.com/engine/logging/), [containerd image store](https://docs.docker.com/engine/storage/containerd/), [daemon config](https://docs.docker.com/engine/daemon/) |
| 06 | [Networking](https://docs.docker.com/engine/network/), [network drivers](https://docs.docker.com/engine/network/drivers/) |
| 07 | [Storage](https://docs.docker.com/engine/storage/), [Volumes](https://docs.docker.com/engine/storage/volumes/) |
| 08 | [Compose](https://docs.docker.com/compose/), [Compose file](https://docs.docker.com/reference/compose-file/), [Watch](https://docs.docker.com/compose/file-watch/) |
| 09 | [Swarm mode](https://docs.docker.com/engine/swarm/) |
| 10, 26 | [Security](https://docs.docker.com/engine/security/), [Scout](https://docs.docker.com/scout/), [Hardened Images](https://docs.docker.com/dhi/), [Content trust](https://docs.docker.com/engine/security/trust/) |
| CLI / API | [CLI reference](https://docs.docker.com/reference/), [Engine API](https://docs.docker.com/reference/api/engine/) |

---

## Kubernetes (kubernetes.io/docs)

| Book chapter | Start here |
|--------------|------------|
| 11–12 | [Concepts overview](https://kubernetes.io/docs/concepts/), [Components](https://kubernetes.io/docs/concepts/overview/components/), [Objects](https://kubernetes.io/docs/concepts/overview/working-with-objects/) |
| 13 | [Pods](https://kubernetes.io/docs/concepts/workloads/pods/), [Probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes), [User namespaces](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/) |
| 14 | [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/), [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) |
| 15, 32 | [Service](https://kubernetes.io/docs/concepts/services-networking/service/), [DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/), [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) |
| 16 | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/), [Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/) |
| 17 | [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/), [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/), [Projected volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/) |
| 18 | [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/), [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/), [Volume snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) |
| 19 | [Cluster networking](https://kubernetes.io/docs/concepts/cluster-administration/networking/), [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) |
| 20 | [Scheduling](https://kubernetes.io/docs/concepts/scheduling-eviction/), [Taints](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/), [Priority and preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) |
| 21, 31 | [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/), [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/), [Auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) |
| 22 | [Logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/), [Metrics](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) |
| 23 | [Helm docs](https://helm.sh/docs/) (external but standard) |
| 24, 28, 33 | [Production environment](https://kubernetes.io/docs/setup/production-environment/), [kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/), [Operating etcd](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) |
| 29 | [Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/), [Dynamic admission](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/), [Validating Admission Policy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/) |
| 30 | [Declarative management](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/), [Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/), [Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) |
| Reference | [kubectl Quick Reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/), [API reference](https://kubernetes.io/docs/reference/kubernetes-api/), [Glossary](https://kubernetes.io/docs/reference/glossary/) |

---

## How to stay current

1. Pin doc URLs to your installed minor version when reading API details.
2. Prefer `kubectl explain <resource>` and `docker <cmd> --help` over blog posts for flag truth.
3. Read the project deprecation guides before upgrades (see Appendix G).

**Prev:** [Appendix E — Glossary](e-glossary.md) · **Next:** [Appendix G — Version Migration](g-version-migration.md)
