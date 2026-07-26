# Chapter 20 — Scheduling and Advanced Placement

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain how the kube-scheduler filters, scores, and binds Pods to nodes
> - Use `nodeSelector`, node affinity, and Pod affinity/anti-affinity
> - Apply taints and tolerations to reserve or isolate nodes
> - Spread replicas with topology spread constraints
> - Configure PriorityClass and reason about preemption
> - Distinguish node-pressure eviction from API-initiated eviction
> - Diagnose Pending Pods caused by placement rules without over-constraining the cluster

---

## 20.1 The concert seating chart

A touring band’s road manager does not seat musicians randomly. Drummers need space near power. Backup singers should not all sit in the same collapsing row. VIPs get a roped-off section. Some seats are broken and marked “do not use.” When the venue is full, lower-priority guests may be asked to leave so headliners can perform.

The **kube-scheduler** is that road manager for Pods. Every new Pod without a `nodeName` enters the scheduling queue. The scheduler **filters** nodes that cannot run the Pod, **scores** the remaining nodes, and binds the Pod to the winner. **Priority** and **preemption** decide who yields when capacity is tight. Your job is to express constraints clearly—without over-constraining so nothing can schedule.

---

## 20.2 How scheduling works

### In plain terms

Scheduling is a matchmaking problem: find a node that *can* run this Pod, then pick the *best* among those that can. If nobody qualifies, the Pod stays **Pending** and Events explain why.

### Under the hood

1. **Filtering (predicates):** Enough CPU/memory? Match selectors? Tolerate taints? Volume zone OK? Priority preemption candidates?
2. **Scoring (priorities):** Prefer less loaded nodes, honor soft affinity, spread where asked
3. **Binding:** Write `nodeName` via the API; kubelet on that node starts the Pod

```bash
$ kubectl get pods -o wide
NAME                        READY   STATUS    NODE       IP
task-api-6d7f8c9b5d-xk2m9   1/1     Running   worker-2   10.244.2.17
```

```bash
$ kubectl describe pod task-api-6d7f8c9b5d-aaaaa
Events:
  Type     Reason            Message
  ----     ------            -------
  Warning  FailedScheduling  0/3 nodes are available: 1 node(s) had untolerated taint..., 2 Insufficient cpu.
```

<!-- VISUAL: Flowchart Filter → Score → Bind with example constraints under Filter -->

### In production

1. Always set resource **requests**—without them, the filter stage cannot place fairly.
2. Read Pending Events before adding more affinity rules.
3. Keep a little spare capacity so drains and preemptions have somewhere to land.

---

## 20.3 Labels, nodeSelector, and node affinity

### In plain terms

Nodes wear nametags (`disktype=ssd`, `topology.kubernetes.io/zone=us-east-1a`). Pods say which nametags they require or prefer. `nodeSelector` is the simple hard pin; **node affinity** adds operators and soft preferences.

### Under the hood

```bash
$ kubectl get nodes --show-labels
$ kubectl label nodes worker-3 disktype=ssd --overwrite
```

**nodeSelector:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: task-api
  template:
    metadata:
      labels:
        app: task-api
    spec:
      nodeSelector:
        disktype: ssd
      containers:
        - name: api
          image: ghcr.io/mastering-k8s/task-api:1.1
          ports:
            - containerPort: 8000
```

**Node affinity** (hard + soft):

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: topology.kubernetes.io/zone
              operator: In
              values:
                - us-east-1a
                - us-east-1b
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 80
        preference:
          matchExpressions:
            - key: disktype
              operator: In
              values:
                - ssd
```

| Operator | Meaning |
|----------|---------|
| `In` / `NotIn` | Label value in / not in list |
| `Exists` / `DoesNotExist` | Label key present / absent |
| `Gt` / `Lt` | Numeric comparison (specialized cases) |

“IgnoredDuringExecution” means if labels change later, the scheduler does not automatically evict running Pods.

> 💡 **Tip:** Start with `nodeSelector` for simple “must run on X” rules. Graduate to affinity when you need operators or soft preferences.

### In production

1. Prefer soft preferences for non-critical hardware affinity so partial outages stay schedulable.
2. Standardize label taxonomies across node pools; typos silently Pending Pods.
3. Remember affinity changes need a rolling restart to reshuffle already-running Pods.

---

## 20.4 Pod affinity, anti-affinity, and topology spread

### In plain terms

Sometimes placement depends on **other Pods**: keep a cache near the API, or keep replicas off the same host and spread across zones. **Topology spread** is the modern, expressive way to keep counts even across failure domains.

### Under the hood

Hard Pod anti-affinity (no two `app=task-api` Pods on the same node):

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: task-api
        topologyKey: kubernetes.io/hostname
```

With 3 replicas and only 2 nodes, one Pod stays Pending. Soft anti-affinity is usually safer:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: task-api
          topologyKey: kubernetes.io/hostname
```

**Topology spread:**

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: task-api
```

| Field | Role |
|-------|------|
| `maxSkew` | Allowed difference in Pod counts across topologies |
| `topologyKey` | Domain label (zone, hostname, …) |
| `whenUnsatisfiable` | `DoNotSchedule` (hard) or `ScheduleAnyway` (soft) |
| `labelSelector` | Which Pods count toward the spread |

You can stack spreads (zone *and* hostname) for stronger resilience.

> ⚠️ **Common Pitfall:** Hard Pod anti-affinity with `topologyKey: kubernetes.io/hostname` and more replicas than nodes guarantees Pending Pods.

### In production

1. Prefer topology spread + soft anti-affinity for general web apps.
2. Reserve hard anti-affinity for true single-instance-per-node requirements.
3. Combine with PDBs ([Chapter 24](24-production-best-practices.md)) so voluntary drains respect availability.

---

## 20.5 Taints and tolerations

### In plain terms

**Taints** mark nodes so ordinary Pods are *repelled* unless they **tolerate** the taint. Control-plane nodes typically wear `node-role.kubernetes.io/control-plane:NoSchedule`. GPU pools often use a dedicated taint so only prepared workloads land there.

### Under the hood

| Effect | Behavior |
|--------|----------|
| `NoSchedule` | New Pods without matching toleration will not schedule here |
| `PreferNoSchedule` | Soft avoidance |
| `NoExecute` | New Pods blocked; existing non-tolerating Pods may be evicted |

```bash
$ kubectl taint nodes worker-gpu dedicated=gpu:NoSchedule
$ kubectl taint nodes worker-gpu dedicated=gpu:NoSchedule-
```

```yaml
tolerations:
  - key: dedicated
    operator: Equal
    value: gpu
    effect: NoSchedule
nodeSelector:
  accelerator: nvidia
```

<!-- VISUAL: Node with tainted rope barrier; Pods with matching toleration badges pass -->

> 📘 **Deep Dive (optional):** Combine taint + label for defense in depth. Taints reserve capacity without relying on every team remembering a nodeSelector.

### In production

1. Document every custom taint in the platform runbook.
2. Use `NoExecute` with care—it can evict production Pods when applied to busy nodes.
3. Do not sprinkle tolerations on all workloads “just in case”; that defeats reservation.

---

## 20.6 PriorityClass and preemption

### In plain terms

When the venue is full, who gets a seat? A **PriorityClass** assigns an integer priority to Pods. Higher-priority Pods can **preempt** (evict) lower-priority Pods so they can schedule—like asking standby guests to leave for the headliner. Without priorities, everyone competes equally and critical control-plane-adjacent workloads can starve.

### Under the hood

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: task-api-high
value: 100000
globalDefault: false
description: "High priority for user-facing Task API"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: batch-low
value: 1000
globalDefault: false
description: "Best-effort batch jobs"
```

Reference from a Pod template:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: task-api
  template:
    metadata:
      labels:
        app: task-api
    spec:
      priorityClassName: task-api-high
      containers:
        - name: api
          image: ghcr.io/mastering-k8s/task-api:1.1
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
```

System PriorityClasses such as `system-cluster-critical` and `system-node-critical` already protect essential components—do not reuse them for ordinary apps.

Preemption flow (simplified):

1. High-priority Pod fails to schedule due to insufficient resources
2. Scheduler considers lower-priority victims on candidate nodes
3. Victims are deleted (gracefully when possible); the high-priority Pod retries scheduling

```bash
$ kubectl get priorityclass
NAME                      VALUE        GLOBAL-DEFAULT   AGE
system-cluster-critical   2000000000   false            30d
system-node-critical      2000001000   false            30d
task-api-high             100000       false            5m
batch-low                 1000         false            5m
```

### In production

1. Define a small, documented priority ladder (platform critical → user-facing → batch)—not dozens of one-off values.
2. Expect preemption to interact with PDBs and graceful shutdown; victims still get termination grace when possible.
3. Never make every workload “high”—preemption only helps when priorities differ.
4. Test starvation scenarios in staging: fill the cluster with low-priority Jobs, then schedule a high-priority Deployment.

---

## 20.7 Node-pressure eviction and API-initiated eviction

### In plain terms

Two different “please leave” mechanisms exist. **Node-pressure eviction** is the kubelet acting as a firefighter when the node is out of memory or disk—it may kill Pods based on QoS and consumption to save the node. **API-initiated eviction** is a polite request through the Eviction API (what `kubectl drain` and many autoscalers use)—it respects PodDisruptionBudgets. Confusing them leads to false confidence in PDBs during OOM storms.

### Under the hood

#### Node-pressure (kubelet) eviction

The kubelet monitors signals such as `memory.available`, `nodefs.available`, and `imagefs.available`. Soft thresholds can trigger eviction after a grace period; hard thresholds evict immediately. Pods are ranked roughly by QoS (**Guaranteed** > **Burstable** > **BestEffort**) and how far they exceed requests.

```bash
$ kubectl describe node worker-2
Conditions:
  Type                 Status  Reason
  ----                 ------  ------
  MemoryPressure       False   KubeletHasSufficientMemory
  DiskPressure         False   KubeletHasNoDiskPressure
  PIDPressure          False   KubeletHasSufficientPID
  Ready                True    KubeletReady
```

Configure thresholds via kubelet config (distro-specific); understand your platform defaults before an incident.

#### API-initiated eviction

```bash
$ kubectl drain worker-2 --ignore-daemonsets --delete-emptydir-data
```

Drain creates Eviction objects for each Pod. The API server honors **PodDisruptionBudgets** for voluntary disruptions. A blocked PDB can stall the drain—by design.

You can also POST an Eviction subresource:

```bash
$ kubectl create -f - <<'EOF'
apiVersion: policy/v1
kind: Eviction
metadata:
  name: task-api-6d7f8c9b5d-xk2m9
  namespace: tasks
EOF
```

| Mechanism | Who triggers | Honors PDB? | Typical cause |
|-----------|--------------|-------------|----------------|
| Node-pressure eviction | kubelet | No | Memory/disk/PID pressure |
| API eviction | drain, autoscaler, operators, `kubectl` | Yes (voluntary) | Maintenance, scale-down |
| `kubectl delete pod` | User/controller | No | Direct deletion |

> ⚠️ **Common Pitfall:** Believing a PDB will save you from node MemoryPressure. PDBs do not restrain kubelet pressure eviction.

### In production

1. Set requests/limits so Guaranteed or well-sized Burstable Pods are less likely victims under pressure.
2. Alert on `MemoryPressure` / `DiskPressure` node conditions—evictions are a symptom, not the root cause.
3. Use drain + PDB for planned maintenance; treat pressure eviction as a capacity and hygiene problem.
4. Cross-link with Chapter 24 for PDB design and Chapter 22 for saturation signals (including PSI on cgroup v2).

---

## 20.8 Putting tools together

| Goal | Tool |
|------|------|
| Must run on SSD nodes | `nodeSelector` or required node affinity |
| Prefer SSD but allow others | Preferred node affinity |
| Keep replicas off the same host | Soft Pod anti-affinity or topology spread |
| Even spread across zones | Topology spread constraints |
| Reserve GPU nodes | Taint + toleration (+ label) |
| Protect user-facing vs batch | PriorityClass + preemption |
| Planned node maintenance | API eviction / drain + PDB |
| Node out of memory | Node-pressure eviction (prevent with capacity) |

Example Task API placement:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
spec:
  replicas: 4
  selector:
    matchLabels:
      app: task-api
  template:
    metadata:
      labels:
        app: task-api
    spec:
      priorityClassName: task-api-high
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: task-api
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: task-api
                topologyKey: kubernetes.io/hostname
      containers:
        - name: api
          image: ghcr.io/mastering-k8s/task-api:1.1
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

---

## 20.9 Diagnosing Pending Pods

```bash
$ kubectl get pods --field-selector=status.phase=Pending
$ kubectl describe pod <pending-pod>
$ kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

Ask:

- Are resource requests larger than any node’s allocatable?
- Did required affinity eliminate all nodes?
- Is there an untolerated taint?
- Is a PVC stuck Pending (volume binding)?
- Are hard anti-affinity + replica count impossible?
- Is a higher-priority Pod waiting on preemption that never finds victims?

---

## 20.10 Common pitfalls

> ⚠️ **Common Pitfall:** Overusing *required* rules. Soft preferences keep the cluster schedulable during partial outages.

> ⚠️ **Common Pitfall:** Assuming affinity changes move running Pods—schedule-time only; roll to reshuffle.

> ⚠️ **Common Pitfall:** Giving every Deployment a high PriorityClass, which nullifies preemption benefits.

> ⚠️ **Common Pitfall:** Ignoring resource requests so the scheduler cannot protect Guaranteed workloads under pressure.

---

## 20.11 Hands-on exercises

1. **Label and select.** Label one node `workshop=true`. Deploy with matching `nodeSelector`. Confirm placement.
2. **Taint a node.** Apply `NoSchedule`, show Pending, add a toleration, watch it schedule.
3. **PriorityClass.** Create low and high PriorityClasses. Fill a node with low-priority Pods, then schedule a high-priority Pod and observe preemption (lab cluster only).
4. **Topology spread.** Apply `maxSkew: 1` across zones or simulated labels; describe distribution.
5. **Eviction contrast.** Drain a node with a PDB in place (API eviction). Separately, read kubelet eviction docs for your distro and identify MemoryPressure signals—do not force OOM on shared hardware.

---

## 20.12 Check Your Understanding

**Q1.** What are the two main phases before the scheduler binds a Pod?

<details>
<summary>Show answer</summary>

**Filtering** (eliminate impossible nodes) and **scoring** (rank remaining nodes).

</details>

**Q2.** How does preferred node affinity differ from required node affinity?

<details>
<summary>Show answer</summary>

Preferred is a soft preference (Pod can still schedule elsewhere); required is a hard filter (Pod Pending if unmet).

</details>

**Q3.** What does a `NoExecute` taint do that `NoSchedule` does not?

<details>
<summary>Show answer</summary>

`NoExecute` can **evict** already-running Pods that do not tolerate the taint; `NoSchedule` only affects new scheduling.

</details>

**Q4.** What is PriorityClass used for, and what is preemption?

<details>
<summary>Show answer</summary>

**PriorityClass** assigns a numeric priority to Pods. **Preemption** lets the scheduler remove lower-priority Pods so a higher-priority Pod can schedule when resources are scarce.

</details>

**Q5.** Do PodDisruptionBudgets restrain kubelet node-pressure eviction?

<details>
<summary>Show answer</summary>

**No.** PDBs apply to **API-initiated / voluntary** evictions (such as drain). Node-pressure eviction is local to the kubelet and can still kill Pods under MemoryPressure or DiskPressure.

</details>

---

## 20.13 Key takeaways

- The scheduler filters, scores, then binds; Pending Events are your primary debugging tool.
- Use `nodeSelector` for simple pins; affinity and topology spread for richer hard/soft placement.
- Taints and tolerations reserve or isolate nodes without trusting every workload author to opt out.
- PriorityClass and preemption protect critical workloads when the cluster is full—keep the priority ladder small and intentional.
- Node-pressure eviction and API eviction are different tools; PDBs help with the latter, not the former.

---

## 20.14 Official documentation map

| Topic | Official page |
|-------|---------------|
| Scheduling | [Scheduling Framework](https://kubernetes.io/docs/concepts/scheduling-eviction/scheduling-framework/) |
| Assigning Pods to Nodes | [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) |
| Taints and Tolerations | [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) |
| Pod Topology Spread | [Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/) |
| Pod Priority and Preemption | [Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) |
| Node-pressure Eviction | [Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/) |
| API-initiated Eviction | [API-initiated Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/) |

**Previous:** [Chapter 19 — Networking — CNI and Policies](19-k8s-networking-cni-and-policies.md) | **Next:** [Chapter 21 — RBAC and Security](21-rbac-and-security.md)
