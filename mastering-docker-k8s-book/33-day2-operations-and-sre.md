# Chapter 33 — Day-2 Operations and SRE

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Define SLIs, SLOs, and error budgets, and use them to make operational decisions
> - Schedule GPUs and other specialized hardware with Dynamic Resource Allocation, including admin access (GA in 1.36)
> - Do capacity planning that balances cost, headroom, and autoscaling
> - Design a disaster-recovery strategy: etcd backups, restore drills, and RTO/RPO targets
> - Write an incident runbook that a tired on-call engineer can actually follow

---

## 33.1 The day after launch

There is a myth that shipping is the finish line. In reality, the day you go to production is **day one**. Everything after — keeping the service healthy, fast, and affordable while the world throws traffic, hardware failures, and 3 a.m. pages at it — is **day two**, and it never ends. This is the domain of **Site Reliability Engineering (SRE)**: treating operations as an engineering problem, with measurable goals and error budgets instead of heroics and hope.

Think of a restaurant. Opening night (day one) is exciting: the menu is set, the doors open. But the restaurant's *reputation* is built on day two and every day after — consistent food, predictable wait times, a plan for when the walk-in freezer dies on a Saturday night, and a calm response when it does. A great kitchen isn't one that never has problems; it's one that has *rehearsed* its problems.

This chapter is about running the kitchen. We start with how you *measure* reliability (SLOs), then handle the specialized hardware modern workloads demand (GPUs via DRA), then plan capacity, prepare for disaster, and finally write the runbooks that turn a chaotic incident into a checklist.

---

## 33.2 SLIs, SLOs, and error budgets

### In plain terms

You cannot manage what you do not measure, and "is the site up?" is too crude to be useful. SRE gives three precise tools:

- **SLI (Service Level Indicator):** a *measurement* of how good the service is right now — e.g. "the fraction of requests served in under 300 ms," or "the fraction of requests that succeed."
- **SLO (Service Level Objective):** the *target* for an SLI over a window — e.g. "99.9% of requests succeed over 30 days."
- **Error budget:** the *allowance* for failure that the SLO implies — 99.9% success means you may fail 0.1% of requests. That leftover 0.1% is a budget you get to *spend*.

The error budget is the quiet genius of SRE. It turns "should we ship this risky change?" from an argument into arithmetic: if you have budget left, ship; if you've burned it, freeze features and fix reliability.

SLIs measure user happiness; SLOs set targets; error budgets decide how much change risk you can afford. You might think 100% SLO is professional—it freezes change and ignores reality.

> ⚠️ **Common Pitfall:** Burning budget with endless risky deploys while paging on vanity metrics.

### Under the hood

Common SLIs, expressed as ratios of good events to valid events:

| SLI | Definition |
|---|---|
| Availability | successful requests ÷ total valid requests |
| Latency | requests faster than threshold ÷ total requests |
| Correctness | responses with correct data ÷ total responses |
| Freshness | records updated within target window ÷ total records |

An SLO turns an SLI into a target over a window. Given a 99.9% availability SLO over 30 days, the error budget is concrete:

```text
30 days              = 43,200 minutes
Allowed downtime     = 0.1% × 43,200 = 43.2 minutes / 30 days
```

A quick reference for availability targets ("the nines"):

| SLO | Allowed unavailability / 30 days |
|---|---|
| 99%    | ~7.2 hours |
| 99.9%  | ~43 minutes |
| 99.95% | ~21.6 minutes |
| 99.99% | ~4.3 minutes |

In Kubernetes, you measure SLIs from metrics (Chapter 22). A Prometheus availability SLI for the Task API, and an alert that fires when you're **burning** the budget fast:

```yaml
# Availability SLI: success ratio over 30 days
- record: sli:task_api_availability:ratio30d
  expr: |
    sum(rate(http_requests_total{job="task-api",code!~"5.."}[30d]))
    /
    sum(rate(http_requests_total{job="task-api"}[30d]))

# Multi-window burn-rate alert: fast burn (page now)
- alert: TaskApiErrorBudgetFastBurn
  expr: |
    (
      sum(rate(http_requests_total{job="task-api",code=~"5.."}[5m]))
      / sum(rate(http_requests_total{job="task-api"}[5m]))
    ) > (14.4 * 0.001)
    and
    (
      sum(rate(http_requests_total{job="task-api",code=~"5.."}[1h]))
      / sum(rate(http_requests_total{job="task-api"}[1h]))
    ) > (14.4 * 0.001)
  for: 2m
  labels: { severity: page }
  annotations:
    summary: "Task API is burning error budget 14.4x too fast"
```

The `14.4` multiplier is the classic "consume 2% of a 30-day budget in 1 hour" fast-burn threshold; pairing a short and a long window suppresses flapping. Slow-burn alerts (lower multiplier, longer windows) page less urgently.

```mermaid
flowchart LR
  windowStart["Day 0: full error budget"] --> normalBurn["Normal burn: actual consumption below budget path"]
  normalBurn --> fastBurn["Fast-burn segment: steep consumption slope"]
  fastBurn --> page["Multi-window burn-rate page"]
  page --> mitigate{"Mitigation restores SLI?"}
  mitigate -->|Yes| remaining["Continue with remaining budget"]
  mitigate -->|No| exhausted["Budget exhausted before day 30"]
  exhausted --> freeze["Feature freeze and reliability work"]
  remaining --> windowEnd["Day 30: reset rolling-window evaluation"]
```

*Figure 33.1: The error budget is spent over the window; burn-rate alerts fire on the slope, not just the level.*

### In production

**Ownership:** Service owners own SLOs/budgets; platform provides measurement. Incident evidence includes budget burn charts.

**Failure mode:** Ignored budgets → chronic outages. Detect with burn-rate alerts. Mitigate by freezing risky changes when budget is exhausted.

| Do | Don't |
|----|-------|
| User-facing SLIs | CPU as the only SLO |
| Budget-driven change freeze | 100% targets with no budget |

**Before you leave this section**

- **Understand:** Error budgets connect reliability to change safety.
- **Try:** Write one SLI/SLO/budget for Task API availability.
- **Watch in prod:** Deploying through exhausted budgets.

> 🏭 **Production floor:** **Error budgets** gate change: when budget is exhausted, only risk-reducing changes ship. Paste burn rate, remaining budget, and decision (ship/freeze) into the change ticket and incident timeline.


---

## 33.3 Dynamic Resource Allocation for AI/GPU

### In plain terms

Classic Kubernetes resources are simple counters: "this pod wants 2 CPUs and 4 GiB of memory." That model breaks down for modern accelerators. A GPU isn't just "one unit" — it has a model, a memory size, a driver version, sharing modes (time-slicing, MIG partitions), and topology constraints. **Dynamic Resource Allocation (DRA)** is the framework that lets workloads *describe* the hardware they need in rich detail, and lets specialized drivers *allocate* it intelligently — instead of pretending a GPU is just another integer in `resources.limits`.

DRA is the way Kubernetes now does AI/GPU scheduling: the core DRA APIs are **stable** (GA) in the 1.34–1.35 window and remain the baseline in **1.36**, where the **DRA admin access** feature itself reached **GA** — giving cluster admins a secure, permanent way to reach devices already in use by other workloads for monitoring and maintenance.

DRA models specialized resources (GPUs) more flexibly than classical Device Plugins alone—follow your 1.36 platform support. You might think requesting `nvidia.com/gpu: 1` is the whole story—drivers, isolation, and scheduling still matter.

> ⚠️ **Common Pitfall:** Mixing classical GPU requests and DRA without a platform standard.

### Under the hood

DRA introduces a small vocabulary of objects in the `resource.k8s.io/v1` API:

| Object | Role |
|---|---|
| `DeviceClass` | A category of devices (e.g. "NVIDIA GPUs"), defined by the driver/admin |
| `ResourceClaim` | A request for one or more devices, made by/for a workload |
| `ResourceClaimTemplate` | A stamp that generates a per-Pod `ResourceClaim` (like a PVC template) |
| `ResourceSlice` | Published by the driver; advertises the devices a node actually has |

A workload requests hardware through a template, and the Pod references the claim by name:

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: single-gpu
  namespace: ml
spec:
  spec:
    devices:
      requests:
        - name: gpu
          exactly:
            deviceClassName: gpu.example.com
---
apiVersion: v1
kind: Pod
metadata:
  name: trainer
  namespace: ml
spec:
  containers:
    - name: train
      image: ghcr.io/example/trainer:1.0.0
      resources:
        claims:
          - name: gpu
  resourceClaims:
    - name: gpu
      resourceClaimTemplateName: single-gpu
```

The scheduler, the DRA driver, and the kubelet cooperate: the driver publishes a `ResourceSlice` per node describing available devices; the scheduler picks a node whose devices satisfy the claim; the driver allocates the specific device and prepares it; the kubelet injects it into the container.

```mermaid
sequenceDiagram
  participant driver as DRA driver
  participant apiServer as Kubernetes API
  participant pod as Pod and ResourceClaim
  participant scheduler as Scheduler
  participant kubelet as Kubelet
  participant device as Selected device
  driver->>apiServer: Publish ResourceSlices
  pod->>apiServer: Create claim-backed workload
  apiServer->>scheduler: Present pending Pod and claim
  scheduler->>apiServer: Select node and allocate matching device
  apiServer->>driver: Prepare allocated device
  driver->>device: Configure access
  apiServer->>kubelet: Bind Pod to selected node
  kubelet->>device: Inject device into container
  kubelet-->>apiServer: Report Pod running
```

*Figure 33.2: DRA carries a ResourceClaim from advertised capacity through scheduling, driver preparation, and device injection.*

**Admin access (GA in 1.36).** Operators sometimes need to reach a device that a tenant's workload is *already using* — to check health, read telemetry, or run maintenance — without disrupting it. DRA admin access provides exactly this, guarded so tenants cannot abuse it:

```yaml
apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata:
  name: gpu-admin-monitor
  namespace: gpu-admin        # namespace must carry the admin-access label
spec:
  spec:
    devices:
      requests:
        - name: all-gpus
          exactly:
            deviceClassName: gpu.example.com
            allocationMode: All
            adminAccess: true   # privileged: reach in-use devices
```

The critical guardrail: `adminAccess: true` is only honored when the object lives in a namespace explicitly labeled for it, so ordinary tenants cannot set the flag and grab everyone else's GPUs:

```bash
$ kubectl label namespace gpu-admin resource.kubernetes.io/admin-access=true
namespace/gpu-admin labeled
```

Without that label (case-sensitive), the API server refuses the privileged request. This is what "GA" means in 1.36: the mechanism and its authorization model are now stable and enabled by default.

### In production

**Ownership:** Platform owns GPU/DRA enablement and node pools; ML app teams consume the published API.

**Failure mode:** Fragmentation → Pending GPU jobs. Detect with GPU free/allocated metrics. Mitigate with pooling and clear request APIs.

| Do | Don't |
|----|-------|
| One platform standard for GPU requests | Snowflake GPU YAML per team |
| Monitor fragmentation | Overcommit GPUs silently |

**Before you leave this section**

- **Understand:** DRA/GPU needs a platform contract and fragmentation monitoring.
- **Try:** Read whether your cluster exposes DRA/GPU resources.
- **Watch in prod:** Pending GPU work from fragmentation.


---

## 33.4 Capacity planning

### In plain terms

Capacity planning is answering three questions before your users answer them for you: *How much do we need? How much headroom for spikes and failures? How do we grow without overpaying?* Too little capacity means outages and throttling; too much means burning money on idle nodes. The art is deliberate headroom, not guesswork.

Capacity is requests, limits, headroom for drains, and dependency limits—not only node count. You might think cluster autoscaler removes planning—you still plan quotas and max surge.

> ⚠️ **Common Pitfall:** Autoscaling nodes while the database is the real bottleneck.

### Under the hood

Kubernetes gives you three autoscaling axes, and they work together:

| Autoscaler | Scales | Reacts to |
|---|---|---|
| **HPA** (Horizontal Pod Autoscaler) | Pod *replicas* | CPU/memory or custom/external metrics |
| **VPA** (Vertical Pod Autoscaler) | Pod *requests/limits* | Historical usage |
| **Cluster Autoscaler / Karpenter** | *Nodes* | Pending pods that don't fit |

A representative HPA driving replicas from a latency-correlated metric:

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
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300   # avoid flapping
```

The chain that keeps things sized correctly:

```text
Traffic up → pods hit 60% CPU → HPA adds replicas → pods don't fit →
Cluster Autoscaler adds a node → replicas schedule → latency recovers
```

Requests and limits are the foundation of all of it: the scheduler bin-packs by **requests**, so requests that are too high waste capacity (pods reserve more than they use) and requests too low overcommit the node (noisy-neighbor CPU throttling and OOM kills). VPA (in recommendation mode) helps you find the right numbers from real usage.

### In production

**Ownership:** Platform owns cluster headroom; app teams own workload forecasts and dependency caps.

**Failure mode:** Surprise saturation → SLO burn. Detect with allocation vs allocatable and queue depth. Mitigate with seasonal forecasts and load tests.

| Do | Don't |
|----|-------|
| Plan drain headroom | 100% allocatable committed |
| Load-test dependencies | Scale apps past DB capacity |

**Before you leave this section**

- **Understand:** Capacity planning includes headroom and dependencies.
- **Try:** Compute % allocatable committed on a node pool.
- **Watch in prod:** Autoscaler storms that overload DBs.


---

## 33.5 Disaster recovery

### In plain terms

Disaster recovery (DR) is your answer to "the cluster (or region) is *gone* — now what?" It rests on two numbers you must choose *before* the disaster: **RTO (Recovery Time Objective)**, how long you can be down, and **RPO (Recovery Point Objective)**, how much data you can afford to lose. A backup you have never restored is not a backup; it's a hope. DR is the rehearsed ability to get back.

DR is etcd + app data + registry artifacts + runbooks with tested RTO/RPO. You might think multi-AZ equals DR—regional loss needs a story.

> ⚠️ **Common Pitfall:** etcd backups without app datastore restores.

### Under the hood

Kubernetes DR has two distinct concerns, and people conflate them at their peril:

1. **Cluster state** lives in **etcd** — every object (Deployments, Services, Secrets, RBAC, CRDs). Losing etcd loses the *desired state* of everything.
2. **Application data** lives in **PersistentVolumes** — databases, uploads, queues. Losing PVs loses *user data*.

**Backing up etcd** (self-managed control plane):

```bash
$ ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%F).db \
    --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key
Snapshot saved at /backup/etcd-2026-07-25.db

$ etcdctl snapshot status /backup/etcd-2026-07-25.db --write-out=table
+----------+----------+------------+------------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
+----------+----------+------------+------------+
| a1b2c3d4 |  4821004 |      18342 |     52 MB  |
+----------+----------+------------+------------+
```

**Restoring** initializes a new data dir from the snapshot; you then point the etcd member at it and bring the control plane back:

```bash
$ etcdctl snapshot restore /backup/etcd-2026-07-25.db \
    --data-dir=/var/lib/etcd-restored
```

**Application-level backup** with **Velero** captures Kubernetes objects *and* snapshots PersistentVolumes to object storage — the standard tool, and the right layer on *managed* clusters where you can't touch etcd:

```bash
$ velero backup create nightly-tasks \
    --include-namespaces tasks,team-payments \
    --snapshot-volumes
Backup request "nightly-tasks" submitted successfully.

$ velero restore create --from-backup nightly-tasks
```

Choosing targets:

| Strategy | RTO | RPO | Cost |
|---|---|---|---|
| Nightly etcd + Velero to object storage | Hours | Up to 24 h | Low |
| Frequent snapshots + PV snapshots | ~1 h | Minutes–1 h | Medium |
| Warm standby cluster (GitOps + replicated data) | Minutes | Seconds–minutes | High |
| Active-active multi-region | ~0 | ~0 | Highest |

```mermaid
flowchart LR
  lastRecoveryPoint["Last recoverable copy"] -->|RPO: acceptable data-loss interval| disaster["Disaster occurs"]
  disaster --> detection["Detect and declare disaster"]
  detection --> restore["Restore cluster state and application data"]
  restore --> validation["Validate workloads and data"]
  validation --> recovered["Service recovered"]
  disaster -->|RTO: maximum recovery interval| recovered
```

*Figure 33.3: RPO measures backward from the disaster to the last recoverable data, while RTO measures forward to restored service.*

### In production

**Ownership:** Platform owns control-plane DR; app teams own data-plane RPO/RTO drills.

**Failure mode:** Untested DR → extended outage. Detect with drill cadence metrics. Mitigate with scheduled game days.

| Do | Don't |
|----|-------|
| Game-day restores | Paper-only DR plans |
| Separate etcd vs app data | Single-region hope as DR |

**Before you leave this section**

- **Understand:** DR requires tested restores for control plane and app data.
- **Try:** List RTO/RPO for Task API and last drill dates.
- **Watch in prod:** Backups never restored.

> 🏭 **Production floor:** Tie DR to **etcd backup tested restores** plus application snapshot/restore evidence. Game days produce timestamps and owners in the ticket—not slideware.


---

## 33.6 Incident runbooks

### In plain terms

At 3 a.m., a paged engineer has adrenaline, not genius. A **runbook** is a pre-written, step-by-step guide for a specific alert or failure so the response is a *checklist*, not an improvisation. Good runbooks convert institutional knowledge (usually stuck in one senior engineer's head) into something anyone on-call can execute.

Runbooks encode detect→mitigate→evidence. They name owners, blast radius, and first commands. You might think tribal knowledge is faster—until the primary is on a flight.

> ⚠️ **Common Pitfall:** Runbooks that say “fix it” without commands, owners, or rollback.

### Under the hood

A useful runbook is short, specific, and action-first. A template:

```text
# Runbook: Task API — High 5xx Error Rate

## Alert
TaskApiErrorBudgetFastBurn (severity: page)

## Impact
Users see failed requests on /tasks. Error budget burning ~14x.

## Quick triage (first 5 minutes)
1. Confirm scope:
   kubectl -n tasks get deploy,pods -l app=task-api
   kubectl -n tasks logs -l app=task-api --tail=100 | grep -i error
2. Check recent changes:
   kubectl -n tasks rollout history deploy/task-api
3. Check dependencies (DB, cache) dashboards.

## Likely causes & actions
- Bad deploy? -> Roll back:
    kubectl -n tasks rollout undo deploy/task-api
- DB saturated? -> Check connections; scale read replicas.
- Traffic spike? -> Confirm HPA scaled; check node capacity/Pending pods.
- Dependency outage? -> Enable degraded mode / circuit breaker.

## Escalation
If not mitigated in 15 min, page secondary + DB on-call (#sev-tasks).

## Verify recovery
- 5xx ratio < 0.1% for 10 min; burn-rate alert cleared.

## After
Open incident doc; schedule blameless postmortem within 48h.
```

The incident lifecycle the runbook plugs into:

```text
Detect (alert) → Triage (scope/severity) → Mitigate (stop the bleeding) →
Resolve (fix root cause) → Postmortem (learn, blamelessly)
```

Note the order: **mitigate before you diagnose**. Rolling back a bad deploy to restore users *now* beats a 40-minute root-cause investigation while customers suffer. Root cause is for the postmortem.

### In production

**Ownership:** Service owners maintain runbooks; platform maintains cluster-level ones. Link from alerts.

**Failure mode:** Missing runbook → slow MTTR. Detect with postmortems citing missing docs. Mitigate with alert→runbook URLs and quarterly reviews.

| Do | Don't |
|----|-------|
| Alert links to runbook | Orphan alerts without owners |
| Paste evidence templates | Heroics without timelines |

**Before you leave this section**

- **Understand:** Runbooks make detect→mitigate repeatable with evidence.
- **Try:** Write a one-page runbook for Task API 5xx burn.
- **Watch in prod:** Alerts without runbook links.


---

## 33.7 Common pitfalls

> ⚠️ **Common Pitfall:** Targeting 100% availability. It's infinitely expensive and leaves no error budget for shipping or maintenance. Pick the lowest SLO users won't notice.

> ⚠️ **Common Pitfall:** Alerting on raw error *counts* or CPU spikes. Alert on **burn rate** against the error budget so humans are paged only when the SLO is truly at risk.

> ⚠️ **Common Pitfall:** Requesting GPUs via the legacy integer counter when you need partitions, specific memory, or topology. Use DRA, which expresses those; and never set `adminAccess: true` outside a label-gated namespace.

> ⚠️ **Common Pitfall:** `minReplicas: 1` on a user-facing HPA. One restart is a full outage. Use ≥ 2–3 and add a PodDisruptionBudget.

> ⚠️ **Common Pitfall:** Backups you've never restored. Untested DR fails when it matters. Schedule restore drills; store backups off-cluster and encrypted (they contain Secrets).

> ⚠️ **Common Pitfall:** Diagnosing root cause during a live incident while users suffer. Mitigate first (roll back, scale, flag off); root-cause in the postmortem.

---

## 33.8 Hands-on exercises

1. **Define an SLO.** For the Task API, write one availability SLO and one latency SLO from the *user's* perspective. Compute the 30-day error budget in minutes for each and state what happens when it's exhausted.
2. **Burn-rate alert.** Using the Prometheus metrics from Chapter 22, write a multi-window fast-burn alert for your availability SLO. Explain why two windows reduce false pages.
3. **DRA claim.** On a GPU-capable cluster (or by reading the DRA docs), write a `ResourceClaimTemplate` + Pod that requests one GPU via a `DeviceClass`. Then write an admin-access claim and explain the namespace label it requires and why.
4. **Autoscaling chain.** Configure an HPA (min 3, max 20, 60% CPU) and a PodDisruptionBudget (`minAvailable: 2`) for the Task API. Load-test it and describe the HPA → Cluster Autoscaler chain you observe.
5. **DR drill.** Take an etcd snapshot (or a Velero backup of the `tasks` namespace). Delete a resource, then restore it. Record the RTO you actually achieved and compare to your target.
6. **Runbook.** Write a one-page runbook for "Task API high 5xx" following §33.6: alert, impact, 5-minute triage, likely causes/actions, escalation, verify, after. Have a teammate execute it cold and note where it was unclear.

---

## 33.9 Check Your Understanding

**Q1.** What is an error budget, and how does it change the "should we ship this?" conversation?

<details>
<summary>Show answer</summary>

An error budget is the allowed amount of failure implied by an SLO (e.g. 99.9% → 0.1% of requests may fail). It turns risk decisions into arithmetic: if budget remains, teams ship features; if it's exhausted, they freeze features and prioritize reliability until it recovers — aligning dev and ops without blame.

</details>

**Q2.** Why is Dynamic Resource Allocation better than the legacy `nvidia.com/gpu: 1` counter for AI workloads, and what changed in Kubernetes 1.36?

<details>
<summary>Show answer</summary>

DRA lets workloads describe hardware richly (model, memory, partitions/MIG, sharing, topology) and lets drivers allocate it intelligently, rather than treating a GPU as an opaque integer. In 1.36, DRA **admin access** reached GA, giving admins a stable, authorization-gated way to reach in-use devices for monitoring and maintenance.

</details>

**Q3.** What guardrail prevents a normal tenant from abusing DRA `adminAccess: true`?

<details>
<summary>Show answer</summary>

The API server only honors `adminAccess: true` for ResourceClaims/Templates created in a namespace labeled `resource.kubernetes.io/admin-access: "true"` (case-sensitive). Without that label, the privileged request is rejected, so tenants can't grab devices others are using.

</details>

**Q4.** What do RTO and RPO mean, and why must you set them before a disaster?

<details>
<summary>Show answer</summary>

RTO (Recovery Time Objective) is how long you can be down; RPO (Recovery Point Objective) is how much data loss is acceptable. They must be chosen up front because they dictate your backup frequency, DR architecture (nightly backups vs warm standby vs active-active), and cost — you can't design the recovery after the disaster starts.

</details>

**Q5.** During a live incident with users failing, should you first find the root cause or mitigate? Why?

<details>
<summary>Show answer</summary>

Mitigate first — roll back, scale out, disable a feature flag, or shed load to restore service now. Root-causing while users suffer prolongs the outage. Diagnosis belongs in the blameless postmortem after service is restored.

</details>

---

## 33.10 Key takeaways

- SRE measures reliability with **SLIs**, targets it with **SLOs**, and manages risk with the **error budget**; alert on **burn rate**, and never chase 100%.
- **Dynamic Resource Allocation** is how Kubernetes schedules AI/GPU hardware with real detail; core DRA is stable, and **admin access is GA in 1.36**, gated by the `resource.kubernetes.io/admin-access` namespace label.
- **Capacity planning** combines right-sized requests, HPA/VPA, Cluster Autoscaler/Karpenter, and PodDisruptionBudgets, with deliberate N+1 headroom and cost tracking.
- **Disaster recovery** means chosen **RTO/RPO**, etcd *and* PersistentVolume backups (Velero + GitOps), and — above all — **tested restores**; backups contain Secrets, so encrypt them.
- **Incident runbooks** turn 3 a.m. chaos into a checklist: detect → triage → **mitigate first** → resolve → blameless postmortem; link every page to a runbook and rehearse with game days.

---

## 33.11 Official documentation map

| Topic | Official page |
|-------|---------------|
| Dynamic Resource Allocation | [Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/) |
| DRA admin access | [DRA — Admin access](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/#admin-access) |
| Set up DRA | [Set Up DRA in a Cluster](https://kubernetes.io/docs/tasks/configure-pod-container/assign-resources/set-up-dra-cluster/) |
| Allocate devices with DRA | [Allocate Devices to Workloads with DRA](https://kubernetes.io/docs/tasks/configure-pod-container/assign-resources/allocate-devices-dra/) |
| DRA hardening | [Hardening Guide - Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/security/hardening-guide/dynamic-resource-allocation/) |
| Horizontal Pod Autoscaling | [Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) |
| Vertical Pod Autoscaling | [Vertical Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/vertical-pod-autoscale/) |
| Node autoscaling | [Node Autoscaling](https://kubernetes.io/docs/concepts/cluster-administration/node-autoscaling/) |
| Pod Disruption Budgets | [Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) |
| Backing up etcd | [Operating etcd — Backing up](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/#backing-up-an-etcd-cluster) |
| Encryption at rest (Secrets) | [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) |
| Velero (backup/restore) | [Velero documentation](https://velero.io/docs/) |
| SRE / SLOs (Google SRE book) | [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) |

---

**Previous:** [Chapter 32 — Advanced Networking and Traffic](32-advanced-networking-traffic.md) | **Next:** [Appendix A — Docker Cheatsheet](appendices/a-cheatsheet-docker.md)
