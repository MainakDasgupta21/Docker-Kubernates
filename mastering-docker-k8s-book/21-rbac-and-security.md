# Chapter 21 — RBAC and Security

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain ServiceAccounts and how Pods authenticate to the API
> - Create Roles, ClusterRoles, and bindings with least privilege
> - Apply security contexts to Pods and containers
> - Configure Pod Security Admission (PSS) at namespace level
> - Attach image pull secrets for private registries
> - Enable and reason about cluster audit logging basics
> - Combine RBAC, admission, NetworkPolicy, and auditing into layered defense

---

## 21.1 Keys, badges, and building codes

A modern office building does not hand every contractor a master key. Receptionists get lobby access. Electricians get badge access to utility floors. Fire codes dictate where walls and sprinklers must exist—rules that apply even if someone has a badge. Security cameras record who walked where, so incidents are reconstructable.

Kubernetes security works the same way:

- **RBAC** is the badge system (who may call which API verbs on which resources)
- **ServiceAccounts** are machine identities for Pods
- **Security contexts** and **Pod Security Admission** are building codes for how processes run
- **Audit logging** is the camera system for the API server
- **NetworkPolicies** ([Chapter 19](19-k8s-networking-cni-and-policies.md)) and **Secrets** ([Chapter 17](17-configuration-and-secrets.md)) close remaining gaps

Default clusters are often too open for production. This chapter tightens the bolts without locking you out of learning.

---

## 21.2 ServiceAccounts: identity for workloads

### In plain terms

Humans authenticate with kubeconfigs and cloud IAM. Pods need their own badges: **ServiceAccounts**. Every namespace has a `default` ServiceAccount; production apps should use a dedicated one with minimal rights.

### Under the hood

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: task-api
  namespace: tasks
```

```yaml
spec:
  serviceAccountName: task-api
  containers:
    - name: api
      image: ghcr.io/mastering-k8s/task-api:1.1
```

The kubelet mounts a projected, audience-bound, time-limited token so the Pod can call the API server—**if** RBAC allows it.

```bash
$ kubectl apply -f serviceaccount.yaml
serviceaccount/task-api created

$ kubectl get sa -n tasks
NAME       SECRETS   AGE
default    0         2d
task-api   0         5s
```

> 💡 **Tip:** Create a dedicated ServiceAccount per app (or per permission set). Never grant broad rights to `default`.

> ⚠️ **Common Pitfall:** Assuming “no API calls in my app” means the ServiceAccount does not matter. Sidecars, operators, and opportunistic tooling still inherit that identity.

### In production

1. Disable automounting the token when a Pod never calls the API (`automountServiceAccountToken: false`).
2. Prefer short-lived projected tokens over long-lived Secret-based tokens (legacy).
3. Rotate credentials and review RoleBindings in CI as part of change control.

---

## 21.3 RBAC building blocks

### In plain terms

RBAC answers: *may this identity perform this verb on this resource in this scope?* Roles are permission menus; bindings hand those menus to subjects (Users, Groups, ServiceAccounts).

### Under the hood

| Object | Scope | Purpose |
|--------|-------|---------|
| **Role** | Namespace | Permissions inside one namespace |
| **ClusterRole** | Cluster | Cluster-wide resources or reusable permission sets |
| **RoleBinding** | Namespace | Grants a Role (or ClusterRole) to subjects in a namespace |
| **ClusterRoleBinding** | Cluster | Grants a ClusterRole cluster-wide |

Common verbs: `get`, `list`, `watch`, `create`, `update`, `patch`, `delete`, `deletecollection`.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: tasks
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: task-api-read-pods
  namespace: tasks
subjects:
  - kind: ServiceAccount
    name: task-api
    namespace: tasks
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pod-reader
```

```bash
$ kubectl apply -f role-pod-reader.yaml
$ kubectl auth can-i list pods -n tasks --as=system:serviceaccount:tasks:task-api
yes
$ kubectl auth can-i delete pods -n tasks --as=system:serviceaccount:tasks:task-api
no
```

Cluster-scoped example:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: pv-reader
rules:
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list"]
```

<!-- VISUAL: Subject → RoleBinding → Role → rules on apiGroups/resources/verbs -->

### In production

1. Prefer **Role** + **RoleBinding** over cluster-wide grants.
2. Grant only required verbs and resources—avoid `*` on app identities.
3. Split CI deployer, runtime ServiceAccount, and human admin identities.
4. Review built-in roles (`view`, `edit`, `admin`, `cluster-admin`) before cloning them onto apps.
5. Re-check with `kubectl auth can-i --list`.

> ⚠️ **Common Pitfall:** Binding `cluster-admin` to a CI ServiceAccount “just for now.” Tokens leak; blast radius becomes the entire cluster.

---

## 21.4 Security contexts

### In plain terms

A **security context** constrains *how* the process runs inside the container: which user ID, whether it can gain privileges, whether the root filesystem is writable, which Linux capabilities remain. RBAC never sees this—NetworkPolicy never sees this—yet a root container with all capabilities is a gift to an attacker who escapes the app.

### Under the hood

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
  namespace: tasks
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
      serviceAccountName: task-api
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: ghcr.io/mastering-k8s/task-api:1.1
          ports:
            - containerPort: 8000
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
      volumes:
        - name: tmp
          emptyDir: {}
```

| Field | Intent |
|-------|--------|
| `runAsNonRoot` / `runAsUser` | Do not run as UID 0 |
| `allowPrivilegeEscalation: false` | Block privilege escalation |
| `readOnlyRootFilesystem: true` | Force writable paths onto volumes |
| `capabilities.drop: ["ALL"]` | Remove Linux capabilities; add back only if required |
| `seccompProfile: RuntimeDefault` | Apply default syscall filter |

> 💡 **Tip:** Images must be built to support non-root (file ownership, listening on non-privileged ports). The Task API should listen on 8000 as a non-root user.

### In production

1. Make hardened securityContext the chart default ([Chapter 23](23-helm.md)).
2. Exempt only system DaemonSets that truly need host access—document each exemption.
3. Combine with read-only root and explicit emptyDir mounts for `/tmp` and caches.

---

## 21.5 Pod Security Admission (PSA)

### In plain terms

**Pod Security Admission** enforces **Pod Security Standards** at the namespace level—like a building inspector who rejects plans that violate fire code before construction starts. Labels on the namespace choose the standard and mode.

### Under the hood

| Standard | Strictness | Summary |
|----------|------------|---------|
| **privileged** | Least | Unrestricted (legacy, admin-only workloads) |
| **baseline** | Medium | Blocks known privilege escalations; reasonable default |
| **restricted** | Most | Hardened: non-root, drop caps, restrict volumes, and more |

Modes: `enforce` (reject), `audit` (allow + audit), `warn` (allow + client warning).

```bash
$ kubectl label namespace tasks \
    pod-security.kubernetes.io/enforce=baseline \
    pod-security.kubernetes.io/enforce-version=latest \
    pod-security.kubernetes.io/warn=restricted \
    pod-security.kubernetes.io/warn-version=latest \
    --overwrite
```

Roll out carefully: `warn`/`audit` first, fix workloads, then raise `enforce`.

> 📘 **Deep Dive (optional):** PSA replaced PodSecurityPolicy (removed since Kubernetes 1.25). On 1.36, PSA is the built-in path; Kyverno or OPA Gatekeeper add richer custom rules on top.

### In production

1. Aim for `baseline` enforce everywhere practical; drive user namespaces toward `restricted`.
2. Keep `kube-system` and ingress controller namespaces on appropriate exemptions—do not blindly enforce `restricted` cluster-wide overnight.
3. Version-pin PSA labels in GitOps so “latest” does not surprise you mid-upgrade.

---

## 21.6 Image pull secrets

### In plain terms

Private registries need credentials. Create a `kubernetes.io/dockerconfigjson` Secret and attach it to the Pod or ServiceAccount—never paste registry passwords into Deployment env vars.

### Under the hood

```bash
$ kubectl create secret docker-registry regcred \
    --docker-server=ghcr.io \
    --docker-username=YOUR_USER \
    --docker-password=YOUR_TOKEN \
    --docker-email=you@example.com \
    -n tasks
```

```yaml
spec:
  serviceAccountName: task-api
  imagePullSecrets:
    - name: regcred
  containers:
    - name: api
      image: ghcr.io/example/task-api:1.1
```

Or patch the ServiceAccount:

```bash
$ kubectl patch serviceaccount task-api -n tasks \
  -p '{"imagePullSecrets":[{"name":"regcred"}]}'
```

### In production

1. Prefer cloud node or workload identity integrations when available—fewer long-lived pull secrets.
2. Scope pull secrets per namespace; rotate on a schedule.
3. Pin production images by digest when you can.

---

## 21.7 Cluster auditing basics

### In plain terms

Auditing answers: *who did what to which object, when, and from where?* When a Deployment disappears at 2 a.m., RBAC tells you what *was allowed*; the audit log tells you what *happened*. Without audits, incident response is guesswork.

### Under the hood

The API server evaluates an **audit policy** that selects requests by users, verbs, resources, and namespaces, and assigns levels:

| Level | What is recorded |
|-------|------------------|
| `None` | Do not log |
| `Metadata` | Request metadata (user, resource, verb)—not the object body |
| `Request` | Metadata + request body (for non-resource-sensitive cases) |
| `RequestResponse` | Metadata + request and response bodies |

Conceptual policy snippet (actual file path and flags are distro-specific):

```yaml
apiVersion: audit.k8s.io/v1
kind: Policy
omitStages:
  - RequestReceived
rules:
  - level: None
    users: ["system:kube-proxy"]
  - level: RequestResponse
    verbs: ["create", "update", "patch", "delete"]
    resources:
      - group: ""
        resources: ["secrets"]
  - level: Metadata
    resources:
      - group: ""
        resources: ["pods", "configmaps"]
  - level: Metadata
    omitStages:
      - RequestReceived
```

API server flags (illustrative—follow your distribution):

```text
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-log-path=/var/log/kubernetes/audit/audit.log
--audit-log-maxage=30
--audit-log-maxbackup=10
--audit-log-maxsize=100
```

Managed Kubernetes (EKS, GKE, AKS) often exposes audit logs through the cloud logging product instead of a raw file on the control plane. Enable and ship them the same way you ship application logs ([Chapter 22](22-observability.md)).

What to watch for in reviews:

- Unexpected `create`/`delete` on Roles, ClusterRoleBindings, Secrets
- `exec` / `portforward` / `proxy` subresources
- Anonymous or unusual user agents against sensitive APIs

### In production

1. Start with Metadata for most resources; raise to Request/RequestResponse only where bodies are needed and retention/PII risk is acceptable.
2. Ship audit logs off the control plane promptly; protect them like security telemetry (immutable storage, limited access).
3. Alert on binding changes to `cluster-admin` and on Secret deletes in production namespaces.
4. Pair audits with RBAC reviews—logs without least privilege still leave a large blast radius.

> ⚠️ **Common Pitfall:** Logging `RequestResponse` for every object at massive scale. Audit volume and sensitive data (Secret bodies) can overwhelm storage and create a second breach surface. Prefer selective rules.

---

## 21.8 NetworkPolicy as a security control

RBAC does not stop Pod A from TCP-connecting to Pod B. Pair this chapter with Chapter 19:

1. Default-deny ingress/egress in sensitive namespaces
2. Allow only required peers and DNS
3. Keep ServiceAccounts from needing network paths they should not use

Defense in depth: stolen token + open network is worse than either alone.

---

## 21.9 Hardened Task API checklist

- [ ] Dedicated ServiceAccount with no extra RoleBindings beyond need
- [ ] Non-root securityContext; drop capabilities; read-only root FS where possible
- [ ] Namespace PSA at least `baseline` enforce; aim for `restricted`
- [ ] Image from trusted registry; pull secret if private; pin tags or digests
- [ ] Resource requests/limits set
- [ ] NetworkPolicies restrict ingress/egress
- [ ] Secrets via native Secret objects or external secret manager—not baked into images
- [ ] Audit logging enabled and shipped; alerts on privileged RBAC changes

---

## 21.10 Common pitfalls

> ⚠️ **Common Pitfall:** RoleBinding `roleRef` must match an existing Role/ClusterRole name and kind exactly; typos leave subjects with no permissions.

> ⚠️ **Common Pitfall:** Testing as yourself (`kubectl`) proves nothing about the Pod’s ServiceAccount. Always test with `--as=system:serviceaccount:ns:name`.

> ⚠️ **Common Pitfall:** Enforcing `restricted` suddenly breaks DaemonSets that need hostPath—exempt system namespaces thoughtfully.

> ⚠️ **Common Pitfall:** Enabling audits but never reading them—wire alerts and periodic reviews.

---

## 21.11 Hands-on exercises

1. **ServiceAccount.** Create `task-api` SA and configure a Deployment to use it. Confirm the mounted token path exists.
2. **Least privilege.** Bind a Role that can only `get/list` ConfigMaps. Verify with `kubectl auth can-i` as that SA.
3. **Security context.** Deploy with `runAsNonRoot`, `allowPrivilegeEscalation: false`, and `capabilities.drop: ["ALL"]`.
4. **PSA.** Label a scratch namespace with `enforce=baseline`. Try deploying a privileged Pod and observe rejection.
5. **Audit awareness.** On your platform, locate where API audit logs are delivered (file, CloudWatch, Cloud Logging, and so on). Find one Secret or RoleBinding change event from a known action you perform.

---

## 21.12 Check Your Understanding

**Q1.** What identity do Pods use when calling the Kubernetes API?

<details>
<summary>Show answer</summary>

Their **ServiceAccount** (default or named), via a mounted API token.

</details>

**Q2.** What is the difference between a Role and a ClusterRole?

<details>
<summary>Show answer</summary>

A **Role** is namespaced; a **ClusterRole** is cluster-scoped (or a reusable set of rules). Bindings determine where those rules apply.

</details>

**Q3.** Does RBAC control Pod-to-Pod network traffic?

<details>
<summary>Show answer</summary>

**No.** RBAC authorizes API requests. Use **NetworkPolicy** for traffic control.

</details>

**Q4.** Name the three Pod Security Standards levels.

<details>
<summary>Show answer</summary>

**privileged**, **baseline**, and **restricted**.

</details>

**Q5.** What problem does API audit logging solve that RBAC alone does not?

<details>
<summary>Show answer</summary>

RBAC defines what is *allowed*. **Audit logs** record what *actually happened* (who, what, when), which is essential for detection, forensics, and proving compliance.

</details>

---

## 21.13 Key takeaways

- ServiceAccounts are workload identities; give each app its own and bind minimal RBAC.
- Roles/ClusterRoles define verbs on resources; bindings grant them to subjects—verify with `auth can-i`.
- Security contexts and Pod Security Admission harden *how* containers run.
- Image pull secrets unlock private registries without embedding passwords in Pod specs.
- Cluster auditing records API activity; ship, protect, and alert on privileged changes.
- Layer RBAC, PSA, Secrets hygiene, NetworkPolicy, and audits—no single control is enough.

---

## 21.14 Official documentation map

| Topic | Official page |
|-------|---------------|
| RBAC | [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) |
| Service Accounts | [Managing Service Accounts](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/) |
| Configure Service Accounts for Pods | [Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/) |
| Pod Security Standards | [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) |
| Pod Security Admission | [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) |
| Security Context | [Configure a Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) |
| Auditing | [Auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) |

**Previous:** [Chapter 20 — Scheduling and Advanced Placement](20-scheduling-and-advanced-placement.md) | **Next:** [Chapter 22 — Observability](22-observability.md)
