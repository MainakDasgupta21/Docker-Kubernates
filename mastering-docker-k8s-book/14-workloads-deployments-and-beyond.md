# Chapter 14 — Workloads — Deployments and Beyond

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain why controllers own Pods instead of leaving bare Pods in production
> - Deploy and roll out stateless apps with Deployments and ReplicaSets
> - Choose StatefulSets, DaemonSets, Jobs, and CronJobs for the right workload shapes
> - Configure rolling updates, rollbacks, and HorizontalPodAutoscaler targets
> - Avoid common replica, identity, and Job parallelism pitfalls

---

## 14.1 Why controllers, not bare Pods

### In plain terms

A bare Pod is a single plant in a pot. Knock it over and it stays down. A **controller** is a gardener with a planting plan: "always three roses in this bed." Controllers recreate, scale, and update Pods from a template.

### Under the hood

| Controller | Keeps this true |
|------------|-----------------|
| **ReplicaSet** | N identical Pods matching a selector |
| **Deployment** | Declarative updates + history over ReplicaSets |
| **StatefulSet** | Stable network identity + ordered Pods + PVC templates |
| **DaemonSet** | One Pod per eligible node |
| **Job** | Run N completions to success |
| **CronJob** | Schedule Jobs on a timetable |

```bash
$ kind create cluster --name workloads --image kindest/node:v1.36.0
```

All of these store desired state in the API and reconcile forever (or until Job completion).

### In production

Ban long-lived bare Pods via policy. Every app Pod should have an ownerReference to a controller. Exceptions (debug Pods) must be namespaced and TTL'd.

---

## 14.2 ReplicaSets: the count keeper

### In plain terms

A **ReplicaSet** only cares about arithmetic: enough Pods with the right labels? If not, create or delete.

### Under the hood

You rarely create ReplicaSets by hand—Deployments own them. Still, understand the shape:

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: task-api-rs
spec:
  replicas: 3
  selector:
    matchLabels:
      app: task-api
      version: "1.0"
  template:
    metadata:
      labels:
        app: task-api
        version: "1.0"
    spec:
      containers:
        - name: api
          image: ghcr.io/mastering-k8s/task-api:1.0
```

Selector labels must match the template labels. Mismatch is rejected or orphan-prone depending on how you got there—never "almost match."

### In production

Do not manage ReplicaSets directly when a Deployment exists—you will fight the Deployment controller. Use `kubectl rollout` against Deployments.

---

## 14.3 Deployments: the stateless workhorse

### In plain terms

A **Deployment** is how most HTTP APIs and workers ship: replica count, Pod template, and a strategy for replacing old Pods with new ones.

### Under the hood

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
  labels:
    app: task-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: task-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    metadata:
      labels:
        app: task-api
    spec:
      containers:
        - name: api
          image: ghcr.io/mastering-k8s/task-api:1.0
          ports:
            - containerPort: 8000
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8000
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
```

```bash
$ kubectl apply -f task-api-deploy.yaml
deployment.apps/task-api created
$ kubectl get deploy,rs,pods -l app=task-api
```

Change `image` to `:1.1` and re-apply—the Deployment creates a new ReplicaSet and rolls traffic as readiness passes.

<!-- VISUAL: Deployment owning RS-A and RS-B during rollout; Pods shifting from old to new -->

### In production

1. Always set readiness probes before relying on RollingUpdate.
2. Pin images by digest in regulated environments.
3. Record `app.kubernetes.io/*` labels on template and Deployment.
4. Use PodDisruptionBudgets so voluntary drains cannot take all replicas.

---

## 14.4 Rolling updates, rollbacks, and history

### In plain terms

Rollouts replace Pods gradually. If the new version is bad, **rollback** returns you to a previous ReplicaSet revision.

### Under the hood

```bash
$ kubectl set image deployment/task-api api=ghcr.io/mastering-k8s/task-api:1.1
$ kubectl rollout status deployment/task-api
$ kubectl rollout history deployment/task-api
$ kubectl rollout undo deployment/task-api
$ kubectl rollout undo deployment/task-api --to-revision=2
```

`maxSurge` allows extra Pods during the update; `maxUnavailable` limits how many may be down. `Recreate` strategy kills all old Pods first—simple but downtime-heavy; use for stubborn singleton locks, not public APIs.

```yaml
strategy:
  type: Recreate
```

Pause/resume for canary-style manual gates:

```bash
$ kubectl rollout pause deployment/task-api
$ kubectl rollout resume deployment/task-api
```

### In production

Alert on `ProgressDeadlineExceeded`. Keep `revisionHistoryLimit` high enough for undo, low enough not to clutter. Prefer progressive delivery tools (Argo Rollouts, Flagger) when you need true canaries—but master vanilla rollouts first.

> ⚠️ **Warning:** Without readiness probes, Kubernetes may roll "successfully" while serving errors. Probes are part of the rollout contract.

---

## 14.5 StatefulSets: stable identity and storage

### In plain terms

**StatefulSets** are for software that cares *who* it is: databases, queues, and consensus members that need stable DNS names and sticky disks.

### Under the hood

Pods get ordinal names (`task-db-0`, `task-db-1`) and stable network identities via a **headless Service**. `volumeClaimTemplates` create a PVC per ordinal.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: task-db
spec:
  clusterIP: None
  selector:
    app: task-db
  ports:
    - port: 5432
      name: pg
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: task-db
spec:
  serviceName: task-db
  replicas: 3
  selector:
    matchLabels:
      app: task-db
  template:
    metadata:
      labels:
        app: task-db
    spec:
      containers:
        - name: postgres
          image: postgres:16
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

DNS: `task-db-0.task-db.default.svc.cluster.local`. Updates and scaling are ordered by default (`OrderedReady`); `Parallel` policy trades safety for speed.

### In production

Do not use StatefulSets just because "it sounds serious." Prefer Deployments for truly stateless APIs. For databases, still run operators or proven charts when possible—StatefulSet gives primitives, not automatic Postgres HA. Understand PVC retention (`whenDeleted` / `whenScaled` policies) before scaling down.

---

## 14.6 DaemonSets: one Pod per node

### In plain terms

A **DaemonSet** plants a daemon on every (eligible) node—log agents, node exporters, CNI helpers, storage plugins.

### Under the hood

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      tolerations:
        - operator: Exists
      containers:
        - name: agent
          image: ghcr.io/mastering-k8s/node-agent:1.0
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
```

Tolerate control-plane taints if the agent must run everywhere. Use `nodeSelector` / affinity to limit to GPU nodes or bare-metal pools.

### In production

Budget DaemonSet resources carefully—they multiply by node count. Rolling update strategy (`RollingUpdate` vs `OnDelete`) matters for agents that must not vanish during upgrades. Prefer DaemonSets over static Pods for add-ons you manage via the API.

---

## 14.7 Jobs: run to completion

### In plain terms

A **Job** runs work until it succeeds (or hits backoff limits)—migrations, batch reports, one-shot transforms.

### Under the hood

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: task-migrate
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/mastering-k8s/task-api:1.1
          command: ["python", "migrate.py"]
```

```bash
$ kubectl apply -f task-migrate.yaml
$ kubectl wait --for=condition=complete job/task-migrate --timeout=120s
```

`completions` and `parallelism` control how many successful Pods you need and how many run at once. `ttlSecondsAfterFinished` cleans finished Jobs.

### In production

Make tasks idempotent—Jobs retry. Set active deadlines for runaway batches. Do not use Deployments for one-shot migrations; do not use Jobs for long-running servers.

---

## 14.8 CronJobs: scheduled Jobs

### In plain terms

A **CronJob** is the cluster's crontab: at this schedule, create a Job.

### Under the hood

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: task-nightly-report
spec:
  schedule: "15 2 * * *"
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: ghcr.io/mastering-k8s/task-api:1.1
              command: ["python", "report.py"]
```

`concurrencyPolicy`: `Allow`, `Forbid`, or `Replace`. Timezone fields exist on modern CronJobs—pin timezone explicitly in multi-region platforms.

### In production

Alert on missed schedules (`startingDeadlineSeconds`). Keep history limits finite. Remember suspended CronJobs (`spec.suspend: true`) during incidents.

---

## 14.9 HorizontalPodAutoscaler

### In plain terms

**HPA** watches metrics and turns the replica dial on a Deployment (or similar) so capacity tracks load.

### Under the hood

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: task-api
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

Requires metrics-server (or compatible metrics pipeline). Custom and external metrics unlock queue depth and business SLIs.

```bash
$ kubectl get hpa task-api -w
```

### In production

Set requests accurately—utilization is percent of request, not of limit. Pair with PodDisruptionBudgets. Prefer scale-down stabilization windows to avoid flapping. Vertical scaling (VPA / in-place resize) is complementary, not a drop-in replacement for HPA.

---

## 14.10 Choosing the right workload

| Need | Choose |
|------|--------|
| Stateless API / worker | Deployment |
| Stable identity + disk per instance | StatefulSet |
| Every node agent | DaemonSet |
| One-shot / batch | Job |
| Scheduled batch | CronJob |
| Autoscale replicas | HPA + Deployment/StatefulSet (with care) |

---

## 14.11 Common pitfalls

1. **Scaling Deployments that mount RWO volumes** → multi-attach Pending hell (Chapter 18).
2. **Using StatefulSet for stateless apps** → slower rollouts, needless PVC churn.
3. **Job `restartPolicy: Always`** → invalid; use `Never` or `OnFailure`.
4. **HPA without resource requests** → metrics nonsense and surprise scale decisions.
5. **Ignoring `concurrencyPolicy` on CronJobs** → overlapping Jobs stampede the database.
6. **Editing ReplicaSets under a Deployment** → Deployment overwrites your "fix."

> ⚠️ **Common Pitfall:** `kubectl delete pod` on a Deployment Pod is fine for bounce tests; deleting the ReplicaSet under a live Deployment is how you invent outages.

---

## 14.12 Hands-on exercises

1. Deploy Task API with three replicas on `kindest/node:v1.36.0`. Roll to `:1.1` and undo.
2. Break readiness on purpose; observe rollout stall / Service endpoints.
3. Create a Job that echoes and completes; add `ttlSecondsAfterFinished`.
4. Schedule a CronJob every minute in a lab namespace; set `Forbid`; watch overlaps fail to start.
5. Install metrics-server (kind instructions) and attach an HPA; generate CPU load and watch replicas.

---

## 14.13 Check Your Understanding

**Q1.** What does a Deployment add over a raw ReplicaSet?

<details>
<summary>Show answer</summary>

Declarative rollouts, revision history, and rollback across ReplicaSets—while still using ReplicaSets underneath to maintain counts.

</details>

**Q2.** When is a StatefulSet justified?

<details>
<summary>Show answer</summary>

When instances need stable network identities and/or dedicated persistent storage per ordinal—typical for clustered stateful software—not merely because the app is "important."

</details>

**Q3.** How does a DaemonSet differ from setting replicas equal to node count on a Deployment?

<details>
<summary>Show answer</summary>

DaemonSets schedule one Pod per eligible node automatically as nodes join/leave. A Deployment with a fixed replica count does not track node membership and may pack multiple Pods on one node.

</details>

**Q4.** Why must Job Pod templates avoid `restartPolicy: Always`?

<details>
<summary>Show answer</summary>

Jobs need finite completion semantics; `Always` is for long-running controllers. Jobs allow `Never` or `OnFailure` so completions can be counted.

</details>

**Q5.** What prerequisite makes CPU-based HPA meaningful?

<details>
<summary>Show answer</summary>

Accurate CPU **requests** (and a metrics pipeline such as metrics-server). Utilization is computed against requests; missing requests break the control loop's meaning.

</details>

---

## 14.14 Key takeaways

- Controllers reconcile Pod counts and lifecycles; bare Pods are demos.
- **Deployments** dominate stateless delivery—probes make rolling updates honest.
- **StatefulSets**, **DaemonSets**, **Jobs**, and **CronJobs** cover identity, per-node, and batch shapes.
- **HPA** scales replicas from metrics; requests and PDBs make it safe.
- Pick the workload API for the problem—do not stretch Deployments into databases or Jobs into servers.

---

## 14.15 Official documentation map

| Topic | Official page |
|-------|---------------|
| Deployments | [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) |
| ReplicaSet | [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/) |
| StatefulSets | [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/) |
| DaemonSet | [DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/) |
| Jobs | [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) |
| CronJob | [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) |
| Horizontal Pod Autoscaling | [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/) |
| Pod Disruption Budgets | [Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/) |

**Previous:** [Chapter 13 — Pods — The Fundamental Unit](13-pods-the-fundamental-unit.md) | **Next:** [Chapter 15 — Kubernetes Services](15-k8s-services.md)
