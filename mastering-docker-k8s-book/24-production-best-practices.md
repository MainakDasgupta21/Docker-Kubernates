# Chapter 24 — Production Best Practices

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Apply ResourceQuotas and LimitRanges to protect namespaces
> - Configure PodDisruptionBudgets with correct expectations about voluntary vs involuntary disruptions
> - Use Horizontal Pod Autoscaling and understand Vertical Pod Autoscaling’s role
> - Explain garbage collection via owner references, and how Leases support leader election and heartbeats
> - Describe the cloud controller manager’s role on managed and self-managed clouds
> - Plan node maintenance, etcd backup/restore, cluster upgrades, and HA patterns
> - Walk a practical production readiness checklist

---

## 24.1 From lab cluster to airline operations

A weekend lab cluster is like a bicycle: if it breaks, you walk. A production cluster is like an airline: schedules, redundancy, maintenance windows, black boxes, and checklists. The Kubernetes API is the same; the **operational discipline** is not.

This chapter gathers the controls you reach for when real users depend on you: quotas, disruption budgets, autoscaling, garbage collection, leases, cloud integration, backups, upgrades, and HA. None of these replace good application design—but without them, even great apps fail messily.

---

## 24.2 Guardrails: ResourceQuota and LimitRange

### In plain terms

**ResourceQuota** is a shared apartment’s breaker panel—no single roommate can pull enough amps to black out the building. **LimitRange** is the rule that every appliance must declare a sane default wattage so nothing plugs in as “unlimited.”

### Under the hood

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: tasks-quota
  namespace: tasks
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "40"
    persistentvolumeclaims: "10"
    services.loadbalancers: "2"
```

```bash
$ kubectl apply -f quota-tasks.yaml
$ kubectl describe quota -n tasks
Name:                   tasks-quota
Resource                Used  Hard
--------                ----  ----
limits.cpu              1     8
pods                    4     40
requests.cpu            400m  4
```

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: tasks-limits
  namespace: tasks
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 256Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "2"
        memory: 2Gi
      min:
        cpu: 50m
        memory: 64Mi
```

> 💡 **Tip:** Quotas that enforce `requests.cpu`/`requests.memory` only work well if every container specifies requests—LimitRange defaults help enforce that culture.

### In production

1. Align HPA `maxReplicas` with namespace quotas so scale-up does not fail mysteriously.
2. Separate quotas per team namespace; avoid one giant “default” bucket.
3. Review unused quota as carefully as exhausted quota—ghost capacity hides bad packing.

---

## 24.3 PodDisruptionBudgets (PDBs)

### In plain terms

A **PodDisruptionBudget** limits *voluntary* disruptions—actions that politely evict Pods through the Eviction API—such as `kubectl drain`, cluster autoscaler scale-down, and many upgrade tools. It does **not** stop node crashes, power loss, or `kubectl delete pod`.

### Under the hood

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: task-api
  namespace: tasks
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: task-api
```

Alternatively use `maxUnavailable: 1`.

```bash
$ kubectl apply -f pdb-task-api.yaml
$ kubectl get pdb -n tasks
NAME       MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
task-api   2               N/A               1                     10s
```

> ⚠️ **Common Pitfall:** A PDB does **not** protect against **involuntary** disruptions. You still need replicas across failure domains ([Chapter 20](20-scheduling-and-advanced-placement.md)) and application retries. If `ALLOWED DISRUPTIONS` is 0, drains may block until you scale up or temporarily adjust the PDB—by design.

### In production

1. Never set `minAvailable` equal to total replicas without spare capacity—drains stall forever.
2. Pair PDBs with topology spread so voluntary *and* involuntary failures have somewhere else to run.
3. Remember API eviction honors PDBs; kubelet node-pressure eviction does not (Chapter 20).

---

## 24.4 Horizontal and Vertical Pod Autoscaling

### In plain terms

**HPA** adds or removes *replicas* when load changes—hire more cashiers when the line grows. **VPA** recommends or adjusts *CPU/memory requests* so each cashier has the right-sized station. They solve different problems; combining them carelessly on the same metric fights itself.

### Under the hood

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: task-api
  namespace: tasks
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: task-api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

```bash
$ kubectl apply -f hpa-task-api.yaml
$ kubectl get hpa -n tasks
NAME       REFERENCE             TARGETS     MINPODS   MAXPODS   REPLICAS
task-api   Deployment/task-api   22%/70%     2         10        2
```

> ⚠️ **Common Pitfall:** Resource metrics require a working **metrics-server** (or equivalent). If `kubectl top` fails, HPA resource metrics will not function. Utilization is relative to **requests**, not limits.

**VPA** is typically installed separately (community components or cloud add-ons). Modes commonly discussed: Off (recommendations only), Initial, Auto (often via recreate). Prefer HPA for replica scaling on custom metrics while VPA rightsizes requests—or use one dimension carefully. Read current VPA docs before combining.

<!-- VISUAL: Graph of CPU rising → HPA increasing replicas → CPU per Pod falling -->

### In production

1. Treat VPA as an optimization after stable SLIs—not day-one magic.
2. Use custom/external metrics (Prometheus Adapter) when CPU is a poor proxy for user load.
3. Watch PSI and saturation ([Chapter 22](22-observability.md)) so you do not scale on misleading utilization alone.

---

## 24.5 Garbage collection and owner references

### In plain terms

Kubernetes cleans up dependent objects the way a theater removes stage props when the show closes—**if** those props are tagged as belonging to the show. **Owner references** link children to parents. When you delete a Deployment, its ReplicaSets and Pods go too (cascading garbage collection). Orphaned objects without owners linger until someone deletes them by hand.

### Under the hood

```bash
$ kubectl get pod task-api-6d7f8c9b5d-xk2m9 -o yaml | findstr /C:"ownerReferences" /C:"name:" /C:"kind:"
# On Unix: kubectl get pod … -o jsonpath='{.metadata.ownerReferences}'
```

Typical chain:

```text
Deployment → ReplicaSet → Pod
```

Each child carries `metadata.ownerReferences` pointing at its controller. The garbage collector deletes dependents when the owner disappears, honoring `propagationPolicy`:

| Policy | Behavior |
|--------|----------|
| `Foreground` | Owner blocked from full deletion until dependents are gone |
| `Background` | Owner deleted; dependents cleaned asynchronously (common default) |
| `Orphan` | Owner deleted; dependents left behind without owner refs |

```bash
$ kubectl delete deployment task-api --cascade=orphan
```

Finalizers on objects delay deletion until a controller clears them (for example, cleaning cloud resources). Stuck deletions often mean a finalizer waiting on a dead controller.

Custom controllers should set owner references on objects they create so namespace teardown and owner deletion do not leave junk.

### In production

1. Prefer letting controllers own children—do not hand-create Pods that should belong to a Deployment.
2. When debugging “terminating forever,” inspect `finalizers` and controller health.
3. Use `kubectl delete --cascade=orphan` only when you *intentionally* keep dependents.
4. Periodic hygiene: find orphaned ReplicaSets, unused PVCs, and abandoned Endpoints after botched cleanups.

---

## 24.6 Leases: heartbeats and leader election

### In plain terms

A **Lease** is a short-lived “talking stick” in etcd. Controllers and kubelets use leases to say “I am still alive” or “I am the active leader.” Without leases, leader election and node heartbeats would be noisier and harder to reason about.

### Under the hood

```bash
$ kubectl get leases -n kube-node-lease
NAME       HOLDER                     AGE
worker-1   worker-1                   30d
worker-2   worker-2                   30d

$ kubectl get lease -n kube-system kube-controller-manager -o yaml
```

Common uses:

- **Node heartbeats** — each node renews a Lease in `kube-node-lease`; stale leases feed node NotReady logic
- **Leader election** — high-availability control-plane components (controller-manager, scheduler) and many operators compete for a Lease; only the holder runs active loops
- **Custom operators** — client-go leader election libraries create Leases so only one replica reconciles

```yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: task-api-operator
  namespace: tasks
spec:
  holderIdentity: task-api-operator-7d8f9c-xk2m9
  leaseDurationSeconds: 15
  renewTime: "2026-07-25T18:00:00.000000Z"
```

You rarely create Leases by hand for apps; you configure operator replicas and election identities correctly.

### In production

1. Run critical operators with leader election enabled and ≥2 replicas across zones.
2. Alert on prolonged leader flapping—often a symptom of API server or etcd latency.
3. Do not delete `kube-node-lease` objects casually; you can confuse node health detection.
4. When nodes stick NotReady, inspect both node conditions and their Leases.

---

## 24.7 Cloud controller manager

### In plain terms

On cloud clusters, someone must translate Kubernetes wishes into cloud API calls: create a load balancer for a Service, attach the right routes, label nodes with zone information, delete cloud disks when told. The **cloud controller manager (CCM)** is that translator. It moved *out* of the core `kube-controller-manager` so cloud logic can evolve with the provider.

### Under the hood

Typical CCM responsibilities:

- **Service / LoadBalancer** controller — provision and reconcile cloud LBs
- **Node** controller — sync cloud VM lifecycle with Node objects (and related taints)
- **Route** controller — ensure Pod CIDR routes exist in the VPC (when applicable)
- Cloud-specific cleanups tied to Kubernetes object deletion

```bash
$ kubectl get pods -n kube-system | findstr cloud
# Examples: cloud-controller-manager, or provider-specific controllers on managed offerings
```

On **managed Kubernetes** (EKS, GKE, AKS), the provider runs equivalent control loops for you—you still need to understand which annotations and Service fields map to which cloud resources. On **self-managed** clusters (kubeadm on cloud VMs), you install and operate the provider’s CCM explicitly.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: task-api
  annotations:
    # Provider-specific — example shape only; use your cloud’s current docs
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
spec:
  type: LoadBalancer
  selector:
    app: task-api
  ports:
    - port: 80
      targetPort: 8000
```

### In production

1. Know whether CCM (or the managed equivalent) is healthy before debugging stuck LoadBalancers or Node objects.
2. Prefer official provider annotations and CSI drivers over legacy in-tree assumptions.
3. Deleting a Service of type LoadBalancer should release cloud LB cost—verify in the cloud console after uninstalls.
4. Separate failure domains: API server issues versus cloud API rate limits versus CCM bugs present differently.

---

## 24.8 Node maintenance

Safe worker maintenance loop:

```bash
$ kubectl cordon worker-2
node/worker-2 cordoned

$ kubectl drain worker-2 --ignore-daemonsets --delete-emptydir-data
node/worker-2 drained

# perform OS patch / reboot / hardware work

$ kubectl uncordon worker-2
node/worker-2 uncordoned
```

- **cordon** — mark unschedulable (no new Pods)
- **drain** — evict Pods respectfully (honors PDBs)
- **uncordon** — re-enable scheduling

Never reboot nodes under load without drain unless you accept involuntary-style disruption.

---

## 24.9 etcd backup and restore

### In plain terms

**etcd** holds cluster state. Lose etcd without a backup and you may rebuild from scratch. Application data (databases on PVs) is a separate backup story—etcd restore brings back object definitions, not necessarily every byte on every volume.

### Under the hood

```bash
$ ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key \
    snapshot save /var/backups/etcd/snapshot-$(date +%F).db

$ ETCDCTL_API=3 etcdctl snapshot status /var/backups/etcd/snapshot-2026-07-25.db --write-out=table
```

Restore is a careful, version-sensitive procedure (stop API servers, restore snapshot, reintroduce members). Practice on a non-production clone.

On **managed Kubernetes**, the provider usually backs up the control plane—verify RPO/RTO in writing. You still back up **application data** (databases, object storage, PV snapshots—[Chapter 18](18-k8s-storage.md)) yourself.

> ⚠️ **Common Pitfall:** Backing up etcd but never testing restore. Untested backups are fiction.

---

## 24.10 Cluster upgrade strategies

Typical goals: stay within the supported version window (**1.33–1.36** for this book’s baseline era), minimize downtime, avoid surprise API removals.

Common approaches:

1. **Surges / rolling node pools** — add new nodes on target version, drain old, delete
2. **In-place upgrades** — upgrade control plane first, then workers in batches
3. **Blue/green clusters** — stand up a new cluster, migrate workloads, switch DNS/traffic

Always:

- Read the release notes for removed APIs
- Run manifests against the target version in staging
- Upgrade control plane before workers (kubeadm-style) unless your platform documents otherwise
- Keep PDBs and capacity headroom so drains succeed
- Backup etcd (self-managed) before control-plane upgrades

```bash
$ kubectl version
$ kubectl get nodes
```

<!-- VISUAL: Timeline control plane upgrade → worker wave 1 → worker wave 2 with PDB-aware drains -->

---

## 24.11 High availability patterns

### Control plane

Production self-managed clusters typically run **odd-sized etcd** (3 or 5) and multiple API server instances behind a load balancer. Managed services provide multi-AZ control planes as a product feature—still verify the SLA. Leader election via **Leases** keeps controllers active on one member at a time.

### Workloads

- Run ≥2 replicas for anything user-facing
- Spread across zones (topology spread / anti-affinity)
- Use PDBs for voluntary maintenance
- Prefer stateless apps; for stateful, use StatefulSets + tested backup/restore
- Put critical dependencies (databases) on HA services with their own failover story

### Cluster essentials

- Multiple healthy worker nodes (and spare capacity for drains)
- NetworkPolicy + RBAC least privilege (Chapters 19 and 21)
- Observability and alerts (Chapter 22)
- GitOps or controlled Helm releases (Chapter 23)—no snowflake kubectl on prod
- Healthy CCM / cloud integration for LoadBalancers and node lifecycle

---

## 24.12 Production readiness checklist

**Application**

- [ ] Health probes configured (startup/liveness/readiness as appropriate)
- [ ] Resource requests and limits set; QoS understood
- [ ] Non-root security context; PSA baseline/restricted where possible
- [ ] 12-factor config via ConfigMaps/Secrets; no secrets in images
- [ ] Graceful shutdown (`terminationGracePeriodSeconds`, SIGTERM handling)

**Kubernetes**

- [ ] ≥2 replicas; topology spread across failure domains
- [ ] PDB for voluntary disruptions
- [ ] HPA (if load varies) with working metrics-server
- [ ] NetworkPolicies default-deny + explicit allows
- [ ] Dedicated ServiceAccount + least-privilege RBAC
- [ ] Quota/LimitRange in the namespace
- [ ] Owner references correct for custom resources; no stuck finalizers in steady state

**Operations**

- [ ] Dashboards *and* alerts on latency, errors, saturation (and PSI where available)
- [ ] Log shipping with retention; audit logs enabled
- [ ] Documented drain/upgrade runbooks
- [ ] etcd or control-plane backup story verified (self-managed or provider)
- [ ] Application data backup/restore tested (snapshots / dumps)
- [ ] Dependency versions pinned; image digests preferred for prod
- [ ] Staging environment that mirrors prod networking and policies
- [ ] Cloud LoadBalancers and disks accounted for in cost and teardown runbooks

---

## 24.13 Bringing the Task API home

A production-minded Task API release might include:

1. Helm chart with resources, probes, securityContext, PDB, HPA
2. Namespace quotas and LimitRanges
3. NetworkPolicies and PSA labels
4. Prometheus metrics + Grafana alerts on error rate
5. Runbooks for drain, rollback (`helm rollback`), and incident response
6. Verified backups for any persistent state

You now have the vocabulary and controls to operate—not just deploy. The next chapter deepens how production images themselves are built.

---

## 24.14 Common pitfalls

> ⚠️ **Common Pitfall:** Setting `minAvailable` on a PDB equal to total replicas with no spare capacity—drains block forever.

> ⚠️ **Common Pitfall:** HPA maxReplicas high enough to exceed ResourceQuota—scale events fail mysteriously.

> ⚠️ **Common Pitfall:** Assuming managed Kubernetes means zero homework. You still own workloads, IAM, data, and often node upgrades.

> ⚠️ **Common Pitfall:** Leaving orphaned objects after `--cascade=orphan` experiments and wondering why capacity disappeared.

> ⚠️ **Common Pitfall:** Ignoring cloud controller / LB annotations until a Service sits `<pending>` external IP for hours.

---

## 24.15 Hands-on exercises

1. **Quota.** Apply a ResourceQuota with a low Pod count; deploy until admission fails; raise the quota and retry.
2. **LimitRange.** Create a LimitRange with defaults; deploy a container without resources and confirm defaults were injected.
3. **PDB + drain.** Create a 3-replica Deployment with `minAvailable: 2`. Cordon/drain a node and observe disruptions stay within budget.
4. **Owner references.** Inspect a Pod’s `ownerReferences`, delete its Deployment, and watch cascading cleanup. Repeat with `--cascade=orphan` in a scratch namespace and clean up manually.
5. **Leases.** List `kube-node-lease` Leases and correlate `HOLDER` / renew times with node Ready status.
6. **Checklist audit.** Score Task API against the production checklist; fix the top three gaps.

---

## 24.16 Check Your Understanding

**Q1.** What is the difference between a ResourceQuota and a LimitRange?

<details>
<summary>Show answer</summary>

**ResourceQuota** caps *aggregate* namespace usage; **LimitRange** sets *per-Pod/container* defaults and min/max.

</details>

**Q2.** Do PodDisruptionBudgets protect against node power failures?

<details>
<summary>Show answer</summary>

**No.** PDBs constrain **voluntary** disruptions (drains/API evictions). Involuntary failures can still remove Pods.

</details>

**Q3.** What do owner references enable in Kubernetes?

<details>
<summary>Show answer</summary>

They link dependent objects to an owner so **garbage collection** can cascade deletes (for example, Deployment → ReplicaSet → Pod) according to the deletion propagation policy.

</details>

**Q4.** Name two common uses of Lease objects.

<details>
<summary>Show answer</summary>

**Node heartbeats** (leases in `kube-node-lease`) and **leader election** for HA controllers and operators.

</details>

**Q5.** What is the cloud controller manager responsible for?

<details>
<summary>Show answer</summary>

Provider-specific control loops such as provisioning **LoadBalancers** for Services, syncing **Node** lifecycle with cloud VMs, and managing cloud **routes**/related resources—so Kubernetes objects stay reconciled with the cloud API.

</details>

---

## 24.17 Key takeaways

- Quotas and LimitRanges keep multi-tenant clusters fair and predictable.
- PDBs make planned maintenance safer; they do not stop crashes or deletes.
- HPA scales replicas; VPA rightsizes requests and is usually an add-on.
- Owner references drive garbage collection; Leases power heartbeats and leader election.
- The cloud controller manager (or managed equivalent) bridges Kubernetes objects and cloud APIs.
- Drain/cordon, etcd backups, and staged upgrades are non-negotiable for self-managed clusters.
- HA is topology + replicas + backups + runbooks, not a single YAML object.

---

## 24.18 Official documentation map

| Topic | Official page |
|-------|---------------|
| Resource Quotas | [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) |
| Limit Ranges | [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/) |
| Pod Disruption Budgets | [Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) |
| Horizontal Pod Autoscaler | [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) |
| Garbage Collection | [Garbage Collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) |
| Owners and Dependents | [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) |
| Lease | [Lease](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/lease-v1/) |
| Cloud Controller Manager | [Cloud Controller Manager](https://kubernetes.io/docs/concepts/architecture/cloud-controller/) |
| Operating etcd | [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) |
| Cluster Upgrade | [Upgrading kubeadm clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/) |

**Previous:** [Chapter 23 — Helm](23-helm.md) | **Next:** [Chapter 25 — Docker Build Deep Dive](25-docker-build-deep-dive.md)
