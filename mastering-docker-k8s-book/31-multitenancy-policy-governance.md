# Chapter 31 — Multitenancy, Policy, and Governance

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Choose between namespace-based (soft) and cluster-based (hard) multitenancy for a given trust boundary
> - Design `ResourceQuota` and `LimitRange` so tenants share a cluster without starving one another
> - Enforce Pod Security Standards with Pod Security Admission, and know when to reach for a policy engine
> - Apply RBAC good practices that survive audits and staff turnover
> - Explain how API Priority and Fairness protects the API server from noisy clients
> - Turn on the audit log and read an audit event
> - Reason about feature gates, the Kubernetes deprecation policy, and safe API migration

---

## 31.1 One cluster, many tenants

Picture an apartment building. Some buildings are **converted houses**: thin interior walls, shared plumbing, and a landlord who trusts everyone to be reasonable. Other buildings are **poured-concrete high-rises**: fire-rated walls between units, separate meters, and a hard boundary that holds even when a neighbor is hostile. Both are "multi-unit housing." They differ in the *strength of the boundary* between residents.

A Kubernetes cluster is the building, and your teams, apps, and customers are the residents. **Multitenancy** is the practice of letting more than one of them share the cluster. The central question is never "how do I split the cluster?" but "**how much do these tenants trust one another, and what happens when one misbehaves?**" That answer drives every decision in this chapter: how you carve up namespaces, how you cap resource use, which security profile you enforce, and who is allowed to do what.

Sharing is attractive because clusters have real fixed costs: control-plane nodes, monitoring, the platform team's attention. Packing many tenants onto one cluster raises utilization and shrinks the number of clusters you operate. The risk is that Kubernetes namespaces are *soft* walls by default — thin drywall, not concrete. This chapter is about knowing which walls you have and reinforcing them deliberately.

> 💡 **Tip:** Write down your tenants and their trust relationship *before* touching YAML. "Three internal teams who trust each other" and "hostile customers running arbitrary code" lead to completely different architectures.

---

## 31.2 Tenancy models

### In plain terms

There are two honest answers to "how do I isolate tenants?"

- **Soft multitenancy (namespaces as tenants):** everyone lives in the same cluster, separated by namespaces, quotas, RBAC, and policy. Good when tenants are *cooperative* — teams inside one company. The kernel and control plane are shared, so a determined attacker who escapes a container could, in principle, reach a neighbor.
- **Hard multitenancy (clusters as tenants):** each tenant gets its own cluster (or a strongly isolated virtual control plane). Good when tenants are *untrusted* — external customers running arbitrary workloads. Stronger boundary, higher cost and operational overhead.

Most organizations end up somewhere in between: soft multitenancy for internal teams, and a full cluster (or a sandboxed runtime) for anything running untrusted code.

### Under the hood

The building block of soft multitenancy is the **namespace**. It is a scope for names and a hook for policy — it is *not* a security sandbox by itself. A namespace gives you:

- A place to attach `ResourceQuota` and `LimitRange`
- A subject boundary for `Role`/`RoleBinding` RBAC
- A label target for Pod Security Admission
- A DNS scope (`svc.<ns>.svc.cluster.local`) and a NetworkPolicy scope

```bash
$ kubectl create namespace team-payments
namespace/team-payments created

$ kubectl label namespace team-payments team=payments cost-center=fin-204
namespace/team-payments labeled
```

What a namespace does **not** give you: a separate kernel, a separate API server, node-level isolation, or protection from a container escape. Pods from different namespaces can land on the same node and share that node's kernel.

For stronger isolation without one-cluster-per-tenant, three techniques stack up:

| Technique | Boundary strengthened | Cost |
|---|---|---|
| Node isolation (taints + `nodeSelector`/affinity per tenant) | Tenants no longer share a kernel/node | Lower bin-packing efficiency |
| Sandboxed runtimes (gVisor, Kata Containers via `RuntimeClass`) | Container escape is contained by a user-space kernel or micro-VM | Some performance overhead |
| Virtual control planes (e.g. the vCluster pattern) | Each tenant gets an apparent API server and CRDs | Extra moving parts to operate |

<!-- VISUAL: A spectrum from "namespaces (soft)" on the left to "separate clusters (hard)" on the right, with node isolation, sandboxed runtimes, and virtual clusters plotted in between by isolation strength vs cost. -->
*Figure 31.1: Tenancy is a spectrum of isolation strength, not a binary choice.*

### In production

- **Match the boundary to the threat, not the org chart.** Internal teams who already share source code and secrets can safely share a cluster with namespaces + quotas + RBAC. Anyone running code you did not review belongs behind a hard boundary.
- **Never run untrusted code with only namespace isolation.** If customers can run arbitrary pods, use separate clusters or a sandboxed `RuntimeClass`. A shared kernel plus a hostile tenant is a breach waiting to happen.
- **Standardize tenant onboarding.** A new tenant should mean "apply a namespace template" — the namespace, a default-deny NetworkPolicy, a ResourceQuota, a LimitRange, PSA labels, and baseline RBAC — created together by automation, never hand-assembled.
- **Label everything for chargeback.** Cost-center and team labels on namespaces let you attribute spend later; retrofitting them across hundreds of namespaces is painful.

> ⚠️ **Common Pitfall:** Treating a namespace as a security boundary equivalent to a VM or a separate cluster. It is an *administrative and policy* boundary. Isolation comes from what you layer on top (RBAC, quotas, PSA, NetworkPolicy, and node/runtime isolation).

---

## 31.3 ResourceQuota: capping a tenant's share

### In plain terms

A `ResourceQuota` is the electricity meter and the fuse box for a namespace. It answers "how much of the cluster may everything in this namespace consume, in total?" — total CPU, total memory, total number of pods, total number of Services, and so on. Without it, one team's runaway Deployment can eat the whole cluster and evict everyone else.

### Under the hood

`ResourceQuota` is enforced by an admission controller. When a request would push a namespace over its quota, the API server rejects it at creation time.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-payments-quota
  namespace: team-payments
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    pods: "100"
    count/deployments.apps: "50"
    services.loadbalancers: "2"
    persistentvolumeclaims: "30"
    requests.storage: 500Gi
```

```bash
$ kubectl apply -f team-payments-quota.yaml
resourcequota/team-payments-quota created

$ kubectl get resourcequota -n team-payments
NAME                  AGE   REQUEST                                                          LIMIT
team-payments-quota   5s    pods: 12/100, requests.cpu: 6/20, requests.memory: 12Gi/40Gi    limits.cpu: 9/40, limits.memory: 20Gi/80Gi
```

Two categories of quota matter most:

- **Compute quotas** (`requests.cpu`, `limits.memory`, …) govern the sum of all containers' requests and limits. The catch: once *any* compute quota is set, every pod in the namespace **must** declare the matching request/limit or it is rejected. That is what `LimitRange` (next section) is for.
- **Object-count quotas** (`pods`, `services`, `count/<resource>.<group>`) cap how many of a kind can exist. The generic `count/deployments.apps` syntax works for almost any resource, including CRDs.

You can also scope a quota. A common pattern caps high-priority workloads separately using `scopeSelector`:

```yaml
spec:
  hard:
    pods: "10"
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values: ["high"]
```

### In production

- **Quota without LimitRange is a trap.** The moment you set a compute quota, pods lacking requests/limits fail admission with `must specify limits.cpu`. Always pair a compute `ResourceQuota` with a `LimitRange` that supplies defaults (next section).
- **Quota rejects at admission, not at runtime.** If a namespace is at its pod quota, the *controller* (Deployment/ReplicaSet) keeps retrying and surfaces `failed quota` events. Watch controller events, not just pod status, when scaling stalls.
- **Reserve headroom.** The sum of all namespace quotas can legitimately exceed cluster capacity (overcommit), but if it does, the *scheduler* — not quota — becomes the limiter, and pods sit `Pending`. Decide deliberately whether you are overcommitting.
- **Cap `services.loadbalancers` and `requests.storage`.** These map directly to cloud spend. One `type: LoadBalancer` Service per developer experiment adds up fast.

> ⚠️ **Common Pitfall:** Setting a memory *limit* quota but forgetting the *request* quota (or vice versa). Tenants can then game the uncapped dimension. Cap both `requests.*` and `limits.*`.

---

## 31.4 LimitRange: sane defaults and guardrails per object

### In plain terms

Where `ResourceQuota` caps the *namespace total*, a `LimitRange` sets rules for *each individual* pod, container, or PVC: a default request if you forgot one, a ceiling no single container may exceed, and a floor so nobody games the scheduler by requesting `1m` of CPU.

### Under the hood

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: team-payments-limits
  namespace: team-payments
spec:
  limits:
    - type: Container
      default:                 # applied as the limit if none set
        cpu: "500m"
        memory: 512Mi
      defaultRequest:          # applied as the request if none set
        cpu: "100m"
        memory: 128Mi
      max:                     # no container may exceed these
        cpu: "2"
        memory: 2Gi
      min:                     # no container may request less
        cpu: "50m"
        memory: 64Mi
    - type: PersistentVolumeClaim
      max:
        storage: 100Gi
      min:
        storage: 1Gi
```

The interaction with quota is the key insight. With the `LimitRange` above, a developer can submit a bare pod with no resource stanza:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: quick-test
  namespace: team-payments
spec:
  containers:
    - name: app
      image: ghcr.io/example/task-api:1.0.0
```

The `LimitRange` admission controller mutates it to carry `requests: {cpu: 100m, memory: 128Mi}` and `limits: {cpu: 500m, memory: 512Mi}`. *Now* the `ResourceQuota` can account for it, and the pod is admitted. Without the `LimitRange`, that same pod would be rejected by the quota for having no requests.

### In production

- **Every namespace with a compute quota needs a LimitRange.** Treat them as a pair in your namespace template.
- **Set `max` to catch fat-finger mistakes.** A developer copying a manifest that requests `memory: 512Gi` should be rejected loudly, not left `Pending` forever.
- **Keep `default` and `defaultRequest` close.** A large gap between request and limit invites CPU throttling surprises and lets pods overcommit memory (risking OOM kills under node pressure).
- **Remember LimitRange is per-object, not per-namespace.** Ten containers each at the `max` still need to fit under the namespace `ResourceQuota`.

---

## 31.5 Pod Security Standards, in depth

### In plain terms

**Pod Security Standards (PSS)** are three named security profiles — `privileged`, `baseline`, `restricted` — that describe *how hardened* a pod's spec must be. **Pod Security Admission (PSA)** is the built-in admission controller that enforces a chosen profile per namespace using labels. Think of PSS as the building code and PSA as the inspector at the door.

PSA replaced the removed PodSecurityPolicy (gone since 1.25) and is a stable, always-on part of Kubernetes 1.36.

### Under the hood

The three profiles form a ladder:

| Profile | What it allows | Typical use |
|---|---|---|
| `privileged` | Everything; no restrictions | System/infra namespaces (CNI, CSI, monitoring agents) that genuinely need host access |
| `baseline` | Blocks the well-known escapes: `privileged: true`, host namespaces, most `hostPath`, adding dangerous capabilities | Reasonable default for general apps |
| `restricted` | Everything in baseline **plus** must run non-root, drop `ALL` capabilities, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, restricted volume types | The target for anything you can harden |

PSA runs in three independent **modes**, each with its own label, so you can observe before you enforce:

- `enforce` — reject violating pods
- `audit` — allow, but record a violation in the audit log
- `warn` — allow, but return a warning to the client (`kubectl` prints it)

```bash
$ kubectl label namespace team-payments \
    pod-security.kubernetes.io/enforce=baseline \
    pod-security.kubernetes.io/enforce-version=v1.36 \
    pod-security.kubernetes.io/warn=restricted \
    pod-security.kubernetes.io/warn-version=v1.36 \
    pod-security.kubernetes.io/audit=restricted \
    pod-security.kubernetes.io/audit-version=v1.36 \
    --overwrite
namespace/team-payments labeled
```

This says: *enforce* `baseline` (reject the obviously dangerous), but *warn* and *audit* against `restricted` so you can see how far each workload is from the hardened target. Pinning `*-version` to `v1.36` (rather than `latest`) freezes the rule set, so a cluster upgrade cannot silently tighten enforcement and break running teams.

A pod that violates the enforced profile is rejected clearly:

```bash
$ kubectl apply -f privileged-pod.yaml
Error from server (Forbidden): error when creating "privileged-pod.yaml":
pods "snoop" is forbidden: violates PodSecurity "baseline:v1.36":
privileged (container "snoop" must not set securityContext.privileged=true)
```

Here is the shape of a pod that satisfies `restricted`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened
  namespace: team-payments
spec:
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: ghcr.io/example/task-api:1.0.0
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
        readOnlyRootFilesystem: true
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

### In production

- **Adopt in stages.** Start with `warn=baseline` + `audit=baseline` cluster-wide (PSA can be configured with cluster defaults via the `AdmissionConfiguration`), fix the noise, then raise `enforce=baseline`, then repeat the climb toward `restricted`.
- **Exempt system namespaces thoughtfully.** `kube-system`, CNI, and CSI namespaces often *need* `privileged`. Set them explicitly rather than leaving them unlabeled and forgotten.
- **Pin the version label.** Unversioned `latest` means a control-plane upgrade can change what "restricted" forbids. Pin to a release and bump deliberately.
- **PSA enforces at the pod template too — but only at pod creation.** Controllers (Deployments) surface violations in their events/status, and PSA's `warn` fires on the Deployment apply, which is friendlier than a silent ReplicaSet failure.
- **Know PSA's limits.** It only checks a fixed set of pod-security fields. It cannot enforce "images must come from our registry," "every pod needs a `team` label," or "no `NodePort` Services." That is the job of a policy engine.

> 📘 **Deep Dive (optional):** For rules beyond PSS, use a validating/mutating policy engine — **Kyverno** or **OPA Gatekeeper** — or the built-in **ValidatingAdmissionPolicy** (CEL-based, GA since 1.30) and **MutatingAdmissionPolicy** (advancing in 1.36). In-tree CEL policies avoid running a separate webhook and are attractive for simple org-wide rules; Kyverno/Gatekeeper offer richer libraries and reporting.

---

## 31.6 RBAC good practices

### In plain terms

RBAC (covered mechanically in Chapter 21) decides *who may call which verb on which resource*. This section is about the *habits* that keep RBAC safe as the number of humans, CI systems, and controllers grows — the difference between a policy that passes an audit and one that quietly grants `cluster-admin` to a leaked CI token.

### Under the hood

The good practices that matter most in a multi-tenant cluster:

1. **Prefer `Role` + `RoleBinding` over cluster-wide grants.** Namespaced permissions keep a tenant's blast radius inside their namespace. Reach for `ClusterRole`/`ClusterRoleBinding` only for genuinely cluster-scoped needs (nodes, PVs, CRDs).

2. **Bind a `ClusterRole` with a namespaced `RoleBinding` to reuse rules safely.** This is the idiomatic way to grant a common permission set (like a reusable "logs reader") in just one namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-viewers
  namespace: team-payments
subjects:
  - kind: Group
    name: payments-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole          # reuse the built-in "view" role...
  name: view                 # ...but only inside team-payments
  apiGroup: rbac.authorization.k8s.io
```

3. **Separate identities by function.** A human admin, the CI deployer, and the running workload's ServiceAccount should be three different subjects with three different permission sets. When the CI token leaks, it should not also be your break-glass admin.

4. **Avoid wildcards.** `verbs: ["*"]` or `resources: ["*"]` grants tomorrow's new resource types too. Enumerate what you mean.

5. **Never bind `cluster-admin` "just for now."** It is the single most common way clusters get compromised. If someone needs broad power temporarily, use a time-boxed break-glass procedure and audit it.

6. **Verify with `kubectl auth can-i`** — as the *subject*, not as yourself:

```bash
$ kubectl auth can-i delete pods -n team-payments \
    --as=system:serviceaccount:team-payments:ci-deployer
no

$ kubectl auth can-i --list \
    --as=system:serviceaccount:team-payments:ci-deployer -n team-payments
Resources        Non-Resource URLs   Resource Names   Verbs
deployments.apps  []                 []               [get list create update patch]
pods              []                 []               [get list watch]
```

7. **Watch out for privilege escalation via `escalate`/`bind`.** A subject who can create `RoleBindings` in a namespace can grant themselves any permission that exists there unless restricted. Kubernetes guards this: to create a binding to a role, you must already hold those permissions (or hold the `escalate` verb). Do not hand out `escalate`.

8. **Aggregate carefully.** ClusterRoles can aggregate others via `aggregationRule` and label selectors — powerful for platform roles, but it means adding a labeled ClusterRole silently expands an aggregated role. Review label selectors when auditing.

### In production

- **Review the four built-in user-facing ClusterRoles before cloning them:** `view` (read-most, no secrets), `edit` (read/write most, no RBAC), `admin` (namespace admin including RBAC within the namespace), and `cluster-admin` (superuser). Most app teams want `edit` scoped to their namespace, not a hand-rolled role.
- **Prefer groups over individual users in bindings.** Bind to `payments-team` (from your OIDC/IdP) so onboarding/offboarding is a change in the identity provider, not a cluster edit.
- **Run periodic access reviews.** Export bindings (`kubectl get rolebindings,clusterrolebindings -A -o yaml`) and diff against the intended state in Git. RBAC belongs in version control like any other manifest.
- **ServiceAccount tokens are bearer tokens.** Projected, audience-bound, short-lived tokens (the default for pods) are far safer than long-lived Secret-based tokens. Do not create long-lived token Secrets unless an external system truly needs one, and rotate them.

> ⚠️ **Common Pitfall:** Testing permissions as your own highly privileged user and concluding "it works." A workload runs as *its* ServiceAccount. Always test with `--as=system:serviceaccount:<ns>:<name>`.

---

## 31.7 API Priority and Fairness

### In plain terms

The API server is the front door to the whole cluster, and it can only process so many requests at once. **API Priority and Fairness (APF)** is the bouncer-and-queues system that decides, when the door is crowded, *whose* requests get served and whose wait — so that one runaway controller listing every pod every second cannot lock out `kubelet` heartbeats or your `kubectl`. APF is stable and on by default in Kubernetes 1.36.

### Under the hood

APF replaces a crude global `--max-requests-inflight` limit with fair queuing across categories of traffic. Two object types configure it:

- **`FlowSchema`** — matches incoming requests (by user, ServiceAccount, verb, resource) and assigns them to a priority level, plus a "flow distinguisher" (e.g. by user) so one noisy client does not crowd out its peers *within* the same priority level.
- **`PriorityLevelConfiguration`** — defines a priority level's share of the server's concurrency and its queuing behavior.

Kubernetes ships sensible defaults. Critical traffic (leader election, kubelet, system components) is protected in high-priority levels; a catch-all `global-default` handles everyday requests; and there is a special exempt level for the most critical system calls.

```bash
$ kubectl get flowschemas
NAME                           PRIORITYLEVEL     MATCHINGPRECEDENCE   AGE
exempt                         exempt            1                    40d
system-leader-election         leader-election   100                  40d
kube-controller-manager        workload-high     800                  40d
service-accounts               workload-low      9000                 40d
global-default                 global-default    9900                 40d

$ kubectl get prioritylevelconfigurations
NAME              TYPE      NOMINALCONCURRENCYSHARES   QUEUES   AGE
exempt            Exempt    <none>                     <none>   40d
workload-high     Limited   98                         128      40d
workload-low      Limited   98                         128      40d
global-default    Limited   20                         128      40d
```

When a priority level is saturated, excess requests are **queued** (up to a limit) and then rejected with **HTTP 429 (Too Many Requests)** and a `Retry-After`. Well-behaved clients back off and retry. You can see rejections and waits in the API server's `apiserver_flowcontrol_*` metrics.

A custom `FlowSchema` is useful to *isolate* a badly behaved integration into its own low-priority level so it cannot harm anyone else:

```yaml
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: PriorityLevelConfiguration
metadata:
  name: batch-low
spec:
  type: Limited
  limited:
    nominalConcurrencyShares: 5
    limitResponse:
      type: Queue
      queuing:
        queues: 64
        queueLengthLimit: 50
        handSize: 6
---
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: FlowSchema
metadata:
  name: batch-jobs
spec:
  priorityLevelConfiguration:
    name: batch-low
  matchingPrecedence: 1000
  distinguisherMethod:
    type: ByUser
  rules:
    - subjects:
        - kind: ServiceAccount
          serviceAccount:
            name: batch-runner
            namespace: analytics
      resourceRules:
        - verbs: ["list", "get", "watch"]
          apiGroups: [""]
          resources: ["pods"]
          namespaces: ["*"]
```

### In production

- **Diagnose 429s before "scaling the API server."** A flood of `429`s in controller logs usually means a client is over-polling. APF is doing its job — throttling the offender to protect the cluster. Find the caller in `apiserver_flowcontrol_rejected_requests_total` (labeled by `flow_schema` and `priority_level`).
- **Use informers/watches, not tight `list` loops.** The classic APF-triggering bug is a custom controller that `LIST`s all pods on a timer instead of using a shared informer cache. Fix the client, not the limits.
- **Isolate risky integrations** into their own low-priority `FlowSchema` so their bad day is contained.
- **Do not disable APF.** Turning it off removes the protection that keeps leader election and kubelet heartbeats alive under load — exactly when you need them.

> 💡 **Tip:** `kubectl` requests you make by hand ride in a low-priority level and may be throttled during an incident. If your own `kubectl` feels slow while the cluster is on fire, that is APF protecting the control plane — not necessarily a broken API server.

---

## 31.8 Auditing

### In plain terms

The **audit log** is the cluster's security camera: a structured record of *who* did *what*, *to which object*, *when*, and *whether it was allowed*. When something goes wrong — a deleted namespace, a leaked token, a surprise `cluster-admin` binding — the audit log is how you reconstruct the story.

### Under the hood

Auditing is configured on the **API server** (not via a cluster object), because the API server is where all mutations flow. You provide an **audit policy** file and a backend (log file or webhook):

```yaml
# audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
omitStages:
  - RequestReceived
rules:
  # Don't log noisy, low-value reads
  - level: None
    resources:
      - group: ""
        resources: ["events"]
  # Log secret access at Metadata level (never log the secret body)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets", "configmaps"]
  # Log RBAC changes with full request/response bodies
  - level: RequestResponse
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["roles", "clusterroles", "rolebindings", "clusterrolebindings"]
  # Everything else: metadata only
  - level: Metadata
```

The four audit **levels** control how much is captured per rule:

| Level | Captures |
|---|---|
| `None` | Nothing (use to drop noise) |
| `Metadata` | Who/what/when/verb/response code — no bodies |
| `Request` | Metadata + the request body |
| `RequestResponse` | Metadata + request and response bodies |

On a self-managed control plane you wire it into the API server:

```text
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-log-path=/var/log/kubernetes/audit.log
--audit-log-maxage=30
--audit-log-maxbackup=10
--audit-log-maxsize=100
```

A single event looks like this (trimmed):

```json
{
  "kind": "Event",
  "level": "RequestResponse",
  "verb": "create",
  "user": { "username": "alice@example.com", "groups": ["payments-team"] },
  "objectRef": {
    "resource": "rolebindings",
    "namespace": "team-payments",
    "name": "payments-admin"
  },
  "responseStatus": { "code": 201 },
  "requestReceivedTimestamp": "2026-07-25T18:04:11Z",
  "stageTimestamp":         "2026-07-25T18:04:11Z"
}
```

### In production

- **Log Secret and RBAC operations at higher fidelity, everything else lean.** Full `RequestResponse` on every read will bury you in gigabytes and can *leak* sensitive data into logs. Use `Metadata` for Secrets — you want to know *that* a secret was read, not its contents.
- **Ship audit logs off the node.** Use the webhook backend or a log agent to forward to a SIEM. Logs stored only on a control-plane node vanish if that node dies (or is wiped by an attacker).
- **On managed Kubernetes, you usually enable audit via the provider** (EKS/GKE/AKS control-plane logging) rather than editing API-server flags you cannot reach. Know your platform's knob.
- **Alert on high-signal events:** `cluster-admin` bindings created, `exec`/`attach` into pods, secret reads by unexpected identities, and deletes of namespaces or CRDs.

> ⚠️ **Common Pitfall:** Setting `level: RequestResponse` globally. It generates enormous volume and can record secret payloads in plaintext. Be selective.

---

## 31.9 Feature gates, deprecation, and API migration

### In plain terms

Kubernetes evolves fast, and it makes two promises that let you keep up without chaos: **feature gates** let a feature graduate through Alpha → Beta → GA so you can opt in early or wait for maturity; and the **deprecation policy** guarantees that an API you depend on will not vanish overnight. Governance is not only about tenants *today* — it is about surviving the cluster's own upgrades.

### Under the hood

**Feature gates** are named booleans passed to control-plane components and the kubelet:

| Stage | Default | Meaning |
|---|---|---|
| Alpha | off | Experimental; may change or be removed; not for production |
| Beta | on (by default) | Well-tested; enabled by default but still evolving |
| GA (Stable) | on, locked | Generally available; the gate becomes a no-op and is later removed |

You can inspect and (on self-managed clusters) set them:

```text
--feature-gates=MutatingAdmissionPolicy=true,SomeAlphaThing=false
```

A concrete 1.36 example from this book's stack: **DRA admin access** (`DRAAdminAccess`) went **Alpha in 1.33, Beta in 1.34, and GA in 1.36** — you will meet it again in Chapter 33. Once GA, the gate is on and locked; eventually the flag itself is removed.

**The deprecation policy** is the contract that makes upgrades safe:

- **Stable (GA) API versions** (`v1`) may be deprecated but are supported for a long window — a deprecated GA API element is supported for **no fewer than 12 months or 3 releases**, whichever is longer — before removal.
- **Beta** versions are supported for 3 releases (or 9 months) after deprecation.
- **Alpha** versions may change or disappear in any release.

A key rule: **the same object is reachable through all its served API versions.** A resource created via `apps/v1beta1` is readable via `apps/v1` — Kubernetes converts between versions internally through a common storage version. That is what makes migration a *relabel*, not a *rewrite*.

**Detecting deprecated API use** before an upgrade removes it:

```bash
# Warnings are emitted automatically by newer clients:
$ kubectl apply -f old-ingress.yaml
Warning: extensions/v1beta1 Ingress is deprecated in v1.14+, unavailable in v1.22+;
use networking.k8s.io/v1 Ingress

# Audit-annotation metric on the API server counts deprecated requests:
apiserver_requested_deprecated_apis
```

Tools like **`kubent` (kube-no-trouble)** and **Pluto** scan live objects and manifests for APIs that a target version will remove.

### In production

- **Read the release notes' "Urgent Upgrade Notes" before every minor bump.** That section lists removed APIs and behavioral changes. Skipping it is how a `kubectl apply` in CI suddenly fails after an upgrade.
- **Migrate manifests ahead of the removal, not during the outage.** When a beta API is deprecated, change your YAML to the stable version now; the cluster serves both, so you can migrate calmly while the old version still works.
- **Do not enable Alpha gates in production.** They lack upgrade/rollback guarantees and can be removed with no migration path. Beta features are the earliest you should consider for real workloads, and even then read the caveats.
- **Pin PSA and other version labels** (as in §31.5) so a control-plane upgrade does not change enforcement semantics under you.
- **Keep manifests in Git and lint them in CI** with a deprecation scanner. Governance that lives only in a running cluster rots; governance in version control gets reviewed.

> 📘 **Deep Dive (optional):** Because every version of an object shares one **storage version**, a cluster upgrade that drops a served version does not lose data — but it *can* leave objects stored under an old version. The **`StorageVersionMigration`** API (graduating through recent releases) lets you rewrite stored objects to the current storage version so an old served version can be safely removed.

---

## 31.10 Common pitfalls

> ⚠️ **Common Pitfall:** Treating namespaces as hard security boundaries. They isolate names and policy, not kernels. Untrusted code needs separate clusters or a sandboxed runtime.

> ⚠️ **Common Pitfall:** Setting a `ResourceQuota` without a matching `LimitRange`. Pods without explicit requests/limits are then rejected, and developers blame "the cluster."

> ⚠️ **Common Pitfall:** Jumping straight to `enforce=restricted` on a busy namespace. Roll out `warn`/`audit` first, fix workloads, then enforce.

> ⚠️ **Common Pitfall:** Granting `cluster-admin` to CI. A leaked pipeline token then owns the cluster. Scope CI to exactly the namespaces and verbs it needs.

> ⚠️ **Common Pitfall:** Reading `429`s from the API server as "too small a control plane." Usually it is one client over-polling; APF is protecting everyone else.

> ⚠️ **Common Pitfall:** Discovering a removed API *after* upgrading. Scan with `kubent`/Pluto and read Urgent Upgrade Notes first.

---

## 31.11 Hands-on exercises

1. **Tenancy design.** For each scenario, decide soft vs hard multitenancy and justify it in two sentences: (a) three internal microservice teams; (b) a SaaS running customer-supplied container images; (c) a data-science group needing GPUs. 
2. **Quota + LimitRange pair.** Create a namespace `lab`, apply a `ResourceQuota` (`requests.cpu: 4`, `pods: 10`) and a matching `LimitRange` with defaults. Deploy a pod with *no* resource stanza and confirm it is admitted and mutated. Then remove the `LimitRange`, delete and recreate the pod, and observe the rejection.
3. **PSA ladder.** Label `lab` with `warn=restricted` and `enforce=baseline` (pin to `v1.36`). Apply a pod that runs as root and note the warning but successful creation. Then set `enforce=restricted` and confirm the same pod is now rejected. Fix the pod to satisfy `restricted`.
4. **RBAC least privilege.** Create a ServiceAccount `ci-deployer` in `lab`, bind the built-in `edit` ClusterRole via a namespaced RoleBinding, and prove with `kubectl auth can-i --as=...` that it can create Deployments but cannot edit RBAC or read cluster-scoped nodes.
5. **APF isolation.** Inspect the default `flowschemas` and `prioritylevelconfigurations`. Write a low-share `PriorityLevelConfiguration` + `FlowSchema` that would corral a `batch-runner` ServiceAccount's `list pods` calls. Explain what a client sees when the level saturates.
6. **Deprecation scan.** Point `kubent` (or Pluto) at a manifest that uses a deprecated API version and produce the report. Rewrite the manifest to the stable version and confirm the scan is clean.

---

## 31.12 Check Your Understanding

**Q1.** Why is a namespace not a sufficient boundary for running untrusted, customer-supplied code?

<details>
<summary>Show answer</summary>

A namespace isolates names, RBAC scope, quotas, and policy — but pods across namespaces still share the node's kernel and control plane. A container escape or kernel exploit can cross a namespace boundary. Untrusted code needs a stronger boundary: separate clusters, node isolation, or a sandboxed `RuntimeClass` (gVisor/Kata).

</details>

**Q2.** You set a compute `ResourceQuota` on a namespace and suddenly plain pods are rejected with "must specify limits.cpu." What is missing and why?

<details>
<summary>Show answer</summary>

A `LimitRange`. Once any compute quota exists, every pod must declare the matching request/limit so quota can account for it. A `LimitRange` with `default`/`defaultRequest` fills those in automatically for pods that omit them.

</details>

**Q3.** What is the difference between the `enforce`, `audit`, and `warn` modes of Pod Security Admission?

<details>
<summary>Show answer</summary>

`enforce` rejects violating pods; `audit` allows them but records a violation in the audit log; `warn` allows them but returns a warning to the client. They are independent, so you can `enforce=baseline` while `warn=restricted`/`audit=restricted` to see how far workloads are from a stricter target before tightening.

</details>

**Q4.** A controller you wrote is causing HTTP 429s from the API server. Is enlarging the API server the right first move? What does APF want you to do?

<details>
<summary>Show answer</summary>

No — the `429`s mean APF is throttling your client to protect the cluster, which is working as designed. The fix is usually on the client: stop tight `list` loops and use a shared informer/watch cache, or isolate the integration into its own low-share `FlowSchema` so it cannot harm others. Only after fixing the client behavior would you consider control-plane capacity.

</details>

**Q5.** A beta API you use is deprecated in the next release but not yet removed. When and how should you migrate?

<details>
<summary>Show answer</summary>

Migrate *now*, while both versions are still served. Because every version of an object is reachable through all served API versions (backed by a common storage version), you can safely update your manifests to the stable version and re-apply — the same objects remain accessible. Do it ahead of the removal release, not during an upgrade outage, and scan with `kubent`/Pluto to confirm nothing still uses the old version.

</details>

---

## 31.13 Key takeaways

- Tenancy is a spectrum: namespaces + quotas + RBAC + PSA for *cooperative* tenants; separate clusters or sandboxed runtimes for *untrusted* code. Match the boundary to the threat.
- `ResourceQuota` caps a namespace's total consumption; `LimitRange` sets per-object defaults and guardrails. A compute quota without a `LimitRange` rejects plain pods — always deploy them as a pair.
- Pod Security Standards (`privileged`/`baseline`/`restricted`) are enforced per namespace by Pod Security Admission in `enforce`/`audit`/`warn` modes; adopt gradually and pin the version label.
- RBAC good practices — namespaced roles, separated identities, no wildcards, no casual `cluster-admin`, verify with `auth can-i`, keep it in Git — matter more than the mechanics.
- API Priority and Fairness fair-queues API traffic so no single client starves the control plane; `429`s point you at a misbehaving client, not a small API server.
- Auditing records who did what; log Secrets/RBAC at higher fidelity and ship logs off-node.
- Feature gates (Alpha→Beta→GA) and the deprecation policy make upgrades safe — migrate deprecated APIs early and read Urgent Upgrade Notes before every bump.

---

## 31.14 Official documentation map

| Topic | Official page |
|-------|---------------|
| Multi-tenancy overview | [Multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/) |
| Namespaces | [Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) |
| Resource quotas | [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) |
| Limit ranges | [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/) |
| Pod Security Standards | [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) |
| Pod Security Admission | [Enforce Pod Security Standards with Namespace Labels](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/) |
| RBAC | [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) |
| API Priority and Fairness | [API Priority and Fairness](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/) |
| Auditing | [Auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) |
| Feature gates | [Feature Gates](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/) |
| Deprecation policy | [Kubernetes Deprecation Policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/) |
| Deprecated API migration | [Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) |

---

**Previous:** [Chapter 30 — Advanced Object Management](30-object-management-advanced.md) | **Next:** [Chapter 32 — Advanced Networking and Traffic](32-advanced-networking-traffic.md)