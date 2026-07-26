# Chapter 29 — Extending Kubernetes

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Define CustomResourceDefinitions (CRDs) and use custom resources like built-in types
> - Explain the operator pattern and when a controller earns its keep
> - Describe the API aggregation layer and how extension API servers plug in
> - Configure validating and mutating admission webhooks responsibly
> - Write **ValidatingAdmissionPolicy** and **MutatingAdmissionPolicy** (GA in Kubernetes 1.36) with CEL
> - Choose between webhooks, in-process CEL policies, and operators for a given extension need

---

## 29.1 Opening story: the platform that grew rooms

Kubernetes ships a useful apartment building: Pods, Deployments, Services, Jobs. Real platforms need extra rooms—databases as APIs, certificates as APIs, tenant quotas as APIs. The project anticipated that. Instead of forking the apiserver for every idea, Kubernetes gives you **extension points**: new resource types (CRDs), reconcilers that drive them (operators), optional aggregated APIs, and admission hooks that enforce house rules when objects enter the building.

On Kubernetes **1.36**, declarative admission took a major step forward: **MutatingAdmissionPolicy** joined **ValidatingAdmissionPolicy** as stable, CEL-powered, in-process policies. Many “tiny webhook” use cases can now live entirely inside the apiserver.

---

## 29.2 CustomResourceDefinitions

### In plain terms

A **CustomResourceDefinition** teaches the API server a new noun. After you apply a CRD for `BackupSchedule`, `kubectl get backupschedules` works like `kubectl get pods`. The API stores your objects in etcd; it does not automatically *do* anything with them until a controller watches and reconciles.

### Under the hood

Minimal CRD for a namespaced `TaskBatch` in group `tasks.example.com`:

```yaml
# crd-taskbatch.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: taskbatches.tasks.example.com
spec:
  group: tasks.example.com
  scope: Namespaced
  names:
    plural: taskbatches
    singular: taskbatch
    kind: TaskBatch
    shortNames:
      - tb
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: ["image", "completions"]
              properties:
                image:
                  type: string
                  minLength: 1
                completions:
                  type: integer
                  minimum: 1
                  maximum: 1000
                parallelism:
                  type: integer
                  minimum: 1
                  default: 1
            status:
              type: object
              properties:
                succeeded:
                  type: integer
                phase:
                  type: string
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Image
          type: string
          jsonPath: .spec.image
        - name: Phase
          type: string
          jsonPath: .status.phase
```

```bash
$ kubectl apply -f crd-taskbatch.yaml
customresourcedefinition.apiextensions.k8s.io/taskbatches.tasks.example.com created

$ kubectl api-resources | grep taskbatch
taskbatches   tb   tasks.example.com/v1   true   TaskBatch
```

Create an instance:

```yaml
# sample-taskbatch.yaml
apiVersion: tasks.example.com/v1
kind: TaskBatch
metadata:
  name: nightly-reports
  namespace: tasks
spec:
  image: example/task-api:1.0.0
  completions: 5
  parallelism: 2
```

```bash
$ kubectl apply -f sample-taskbatch.yaml
taskbatch.tasks.example.com/nightly-reports created

$ kubectl get tb -n tasks
NAME              IMAGE                     PHASE
nightly-reports   example/task-api:1.0.0
```

Structural schemas (OpenAPI v3 in the CRD) are required for modern CRDs. They enable validation, pruning of unknown fields (when configured), and server-side apply awareness.

Versioning tips:

- One version is marked `storage: true`.
- Serve multiple versions with conversion webhooks (or none, if you only ever serve one).
- Prefer additive schema evolution; breaking field removals need a new version and a migration story.

### In production

1. Own CRDs like APIs: review schemas, publish docs, and avoid silent breaking changes.
2. Use **status subresources** so controllers can update status without fighting users on `spec`.
3. Gate who can create CRDs themselves (cluster-admin territory) versus who can create *instances*.
4. Watch etcd size—chatty custom resources with huge specs add real cost.

> 💡 **Tip:** Start with a CRD + a small controller. Only reach for aggregated API servers when you need non-standard storage, special verbs, or protocols CRDs cannot express cleanly.

---

## 29.3 The operator pattern

### In plain terms

An **operator** is a controller (often packaged with its CRDs) that encodes human operational knowledge: provision a database, rotate its certificates, take backups, fail over. Users declare *what* they want (`kind: PostgresCluster`); the operator continuously drives the cluster toward that desire.

### Under the hood

The reconciliation loop is the same idea as built-in controllers:

```text
Watch TaskBatch objects
        │
        ▼
Read desired spec ──► Compare to live Jobs/Pods ──► Create/Update/Delete children
        │
        ▼
Update TaskBatch.status
```

A sketch in Go-shaped pseudocode (not a full project):

```text
for each TaskBatch tb:
  ensure Job exists with Completions=tb.spec.completions
  set tb.status.succeeded = job.status.succeeded
  set tb.status.phase = "Running" or "Completed"
```

Operators commonly use:

- **controller-runtime** / Operator SDK / Kubebuilder scaffolding
- **ownerReferences** so garbage collection deletes children when the CR goes away
- finalizers for cleanup that must happen before the API object disappears
- RBAC limited to the resources the operator truly needs

```yaml
# Example ownerReference on a child Job (set by the operator)
apiVersion: batch/v1
kind: Job
metadata:
  name: nightly-reports-batch
  namespace: tasks
  ownerReferences:
    - apiVersion: tasks.example.com/v1
      kind: TaskBatch
      name: nightly-reports
      uid: 4f2a9c1e-8b3d-4e2a-9f1c-123456789abc
      controller: true
      blockOwnerDeletion: true
spec:
  completions: 5
  parallelism: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: example/task-api:1.0.0
```

### In production

1. **Level-triggered, idempotent** reconcile—retries are normal, not exceptional.
2. Emit events and metrics; operators without observability are silent liability.
3. Define upgrade contracts for both the operator Deployment *and* the CRD schema.
4. Prefer mature operators (cert-manager, external-dns, cloud CSI helpers) over writing your own until the domain knowledge is truly yours.

> ⚠️ **Common Pitfall:** Treating the operator Pod as the source of truth. The custom resource in etcd is the source of truth; the operator is a worker that may be rescheduled at any time.

---

## 29.4 API aggregation layer

### In plain terms

CRDs extend the *same* apiserver process with new types. The **aggregation layer** lets you run a *separate* extension API server and register it so that `kubectl` and clients still talk to the front door (`kube-apiserver`), which proxies specific API groups to your backend.

### Under the hood

You register an `APIService` that maps a group-version to a Service running your extension server:

```yaml
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1beta1.metrics.k8s.io
spec:
  service:
    name: metrics-server
    namespace: kube-system
    port: 443
  group: metrics.k8s.io
  version: v1beta1
  insecureSkipTLSVerify: false
  groupPriorityMinimum: 100
  versionPriority: 100
  caBundle: LS0tLS1CRUdJTi...   # PEM CA bundle, base64-encoded
```

Flow:

```text
kubectl get --raw /apis/metrics.k8s.io/v1beta1/nodes
        │
        ▼
kube-apiserver (aggregation) ──proxy──► metrics-server Service
```

The **metrics-server** is the classic in-tree-ecosystem example. Custom aggregated APIs appear when CRD storage semantics are not enough (specialized query APIs, different persistence, or protocol needs).

Front-proxy certificates (chapter 28’s `front-proxy-ca`) authenticate the apiserver to the extension server so the extension can trust the identity of the original user via impersonation headers.

### In production

1. Treat extension API servers as **control-plane critical**—if they hang, parts of `kubectl` hang.
2. Use proper TLS and `caBundle`; avoid `insecureSkipTLSVerify` outside labs.
3. Prefer CRDs unless you have a concrete aggregation requirement.
4. Monitor `APIService` availability (`kubectl get apiservices`).

```bash
$ kubectl get apiservices | head
NAME                                   SERVICE                      AVAILABLE   AGE
v1.                                    Local                        True        40d
v1.apps                                Local                        True        40d
v1beta1.metrics.k8s.io                 kube-system/metrics-server   True        10d
```

> 📘 **Deep Dive (optional):** Aggregation is how some service-mesh and policy products expose rich APIs without merging into kubernetes/kubernetes core. Reading an `APIService` object is often the fastest way to discover which extension owns a given `apiGroup`.

---

## 29.5 Admission webhooks

### In plain terms

Admission webhooks are **phone-a-friend** checks during API requests. After authentication and authorization, the apiserver can call your HTTPS endpoint to **mutate** (change) or **validate** (allow/deny) the object before it is persisted.

### Under the hood

Two configuration kinds:

| Kind | Role |
|------|------|
| `MutatingWebhookConfiguration` | Can change the object (patches) |
| `ValidatingWebhookConfiguration` | Can only accept or reject |

```yaml
# validating-webhook-config.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: taskbatch-policy
webhooks:
  - name: validate.taskbatches.tasks.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None
    timeoutSeconds: 5
    failurePolicy: Fail
    clientConfig:
      service:
        namespace: platform-system
        name: taskbatch-webhook
        path: /validate-taskbatch
        port: 443
      caBundle: LS0tLS1CRUdJTi...
    rules:
      - apiGroups: ["tasks.example.com"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["taskbatches"]
        scope: Namespaced
```

Request/response use `AdmissionReview` objects. Your service must present a certificate trusted via `caBundle`.

Ordering and risk:

- Mutating webhooks run before validating webhooks.
- `failurePolicy: Ignore` fails open (availability over safety); `Fail` fails closed (safety over availability).
- Long timeouts stall **every** matching API call cluster-wide.

### In production

1. Keep webhooks **highly available** and cheap; autoscale and watch p99 latency.
2. Scope `rules` and `namespaceSelector` / `objectSelector` tightly—never “all resources” without extreme care.
3. Set `sideEffects: None` when you can; it enables dry-run safety.
4. Have a break-glass path (remove or ignore the webhook) documented for control-plane recovery.
5. On Kubernetes 1.36, ask whether a **CEL admission policy** can replace the webhook entirely (next sections).

> ⚠️ **Warning:** A broken mutating webhook with `failurePolicy: Fail` can block Pod creation cluster-wide—including the webhook’s own repair Pods if you mismanage selectors. Always exclude critical system namespaces or the webhook’s namespace from match criteria when appropriate.

---

## 29.6 ValidatingAdmissionPolicy and CEL (stable)

### In plain terms

A **ValidatingAdmissionPolicy** is a validating webhook written as **declarations and CEL expressions** inside the apiserver. No sidecar service, no TLS bundle rotation for your app, no extra Deployment to page on. You express rules like “every Pod must set `runAsNonRoot`” in CEL; the API server evaluates them in-process.

### Under the hood

ValidatingAdmissionPolicy has been stable since Kubernetes 1.30 and remains the validation half of the CEL admission story on 1.36. You typically create:

1. `ValidatingAdmissionPolicy` — the logic
2. `ValidatingAdmissionPolicyBinding` — where it applies (and optional params)

```yaml
# vap-require-app-label.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-app-label
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "has(object.metadata.labels) && has(object.metadata.labels.app)"
      message: "Deployments must carry an 'app' label"
      reason: Invalid
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-app-label-binding
spec:
  policyName: require-app-label
  validationActions: ["Deny"]
  matchResources:
    namespaceSelector:
      matchLabels:
        policy.example.com/enforce: "true"
```

```bash
$ kubectl apply -f vap-require-app-label.yaml
validatingadmissionpolicy.admissionregistration.k8s.io/require-app-label created
validatingadmissionpolicybinding.admissionregistration.k8s.io/require-app-label-binding created
```

CEL sees variables such as `object`, `oldObject`, `request`, `params`, `namespaceObject`, and `authorizer`. Example requiring resource requests:

```yaml
validations:
  - expression: >
      object.spec.template.spec.containers.all(c,
        has(c.resources) && has(c.resources.requests) &&
        has(c.resources.requests.memory) && has(c.resources.requests.cpu))
    message: "All containers must set cpu and memory requests"
```

`validationActions` may include `Deny`, `Warn`, and `Audit`—useful for rolling out policy without a big-bang outage.

### In production

1. Roll out with **Warn/Audit** first; switch to Deny when dashboards look clean.
2. Keep expressions small and readable; complex policies belong in tests (Kubernetes provides policy test helpers in the ecosystem).
3. Use bindings’ selectors to stage by namespace.
4. Remember policies cannot replace every webhook—external data lookups and multi-step side effects still need services or operators.

---

## 29.7 MutatingAdmissionPolicy (GA in 1.36)

### In plain terms

If ValidatingAdmissionPolicy is the bouncer who rejects bad outfits, **MutatingAdmissionPolicy** is the stylist who quietly adds the missing badge on the way in. As of Kubernetes **1.36**, MutatingAdmissionPolicy is **GA** (`admissionregistration.k8s.io/v1`), enabled by default—mutations via CEL without running a mutating webhook server.

### Under the hood

Core pieces:

| Resource | Role |
|----------|------|
| `MutatingAdmissionPolicy` | Mutation logic (CEL apply configuration or JSON patch) |
| `MutatingAdmissionPolicyBinding` | Activates and scopes the policy |
| Optional parameter CR / ConfigMap | Makes the policy reusable with different values |

Label injection example:

```yaml
# map-add-managed-by.yaml
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingAdmissionPolicy
metadata:
  name: add-managed-by-label
spec:
  failurePolicy: Fail
  reinvocationPolicy: IfNeeded
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
  mutations:
    - patchType: ApplyConfiguration
      applyConfiguration:
        expression: >
          Object{
            metadata: Object.metadata{
              labels: {"managed-by": "cel-policy"}
            }
          }
---
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingAdmissionPolicyBinding
metadata:
  name: add-managed-by-label-binding
spec:
  policyName: add-managed-by-label
```

```bash
$ kubectl apply -f map-add-managed-by.yaml
mutatingadmissionpolicy.admissionregistration.k8s.io/add-managed-by-label created
mutatingadmissionpolicybinding.admissionregistration.k8s.io/add-managed-by-label-binding created

$ kubectl run demo --image=nginx:1.27 -n tasks
pod/demo created

$ kubectl get pod demo -n tasks -o jsonpath='{.metadata.labels.managed-by}{"\n"}'
cel-policy
```

**ApplyConfiguration** mutations merge with server-side apply semantics—safer for additive fields. **JSONPatch** mutations are available when you need explicit list operations. Match conditions can skip work:

```yaml
matchConditions:
  - name: missing-managed-by
    expression: '!has(object.metadata.labels) || !("managed-by" in object.metadata.labels)'
```

Sidecar-style mutation (init container) pattern from the official docs shape:

```yaml
mutations:
  - patchType: ApplyConfiguration
    applyConfiguration:
      expression: >
        Object{
          spec: Object.spec{
            initContainers: [
              Object.spec.initContainers{
                name: "mesh-proxy",
                image: "mesh/proxy:v1.0.0",
                args: ["proxy", "sidecar"],
                restartPolicy: "Always"
              }
            ]
          }
        }
```

Use match conditions so you do not stack duplicate sidecars on every update. Policies and bindings that configure admission are exempt from being mutated by MutatingAdmissionPolicy via the REST API path—guards against unrecoverable self-modification loops.

### In production

1. Prefer **MutatingAdmissionPolicy** for common label/annotation/defaulting work; reserve webhooks for complex external decisions.
2. Set `reinvocationPolicy` deliberately (`IfNeeded` vs `Never`) when multiple mutators interact.
3. Pair mutations with **ValidatingAdmissionPolicy** so required post-mutation shape is enforced.
4. Treat policy YAML as critical config: code review, GitOps, and staged bindings.
5. Load-test admission QPS after adding heavy CEL—cheap expressions stay cheap; pathological ones tax the apiserver.

> 💡 **Tip:** On 1.36, a practical migration path is “inventory mutating webhooks → classify as pure CEL vs needs external data → replace the pure CEL set with MutatingAdmissionPolicy → keep a thin webhook for the rest.”

---

## 29.8 Choosing an extension mechanism

| Need | Prefer |
|------|--------|
| New declarative API noun + stored objects | CRD |
| Continuously act on those objects | Operator / controller |
| Non-CRD API semantics or separate storage | Aggregated API server |
| Reject bad objects with local logic | ValidatingAdmissionPolicy (CEL) |
| Default/inject fields with local logic | MutatingAdmissionPolicy (CEL, GA 1.36) |
| Admission that calls inventory/DB/IdP | Admission webhook |
| Package CRDs + controller + RBAC for others | Operator + Helm/OLM-style distribution |

<!-- VISUAL: Decision tree from "need new API?" to CRD/operator vs "need gate on write?" to CEL policy vs webhook -->

---

## 29.9 Common pitfalls

> ⚠️ **Common Pitfall:** Publishing a CRD without a controller and wondering why nothing happens. The API will store objects happily forever; reconciliation is your job.

> ⚠️ **Common Pitfall:** Conversion webhook or admission webhook downtime blocking upgrades and CRD changes. Budget HA for anything on the request path.

> ⚠️ **Common Pitfall:** CEL policies that assume fields always exist. Use `has()` and safe navigation patterns; test CREATE and UPDATE separately.

> ⚠️ **Common Pitfall:** Mutating the same list with ApplyConfiguration incorrectly and wiping sibling elements. Know SSA merge rules; use JSONPatch when you must append carefully.

> ⚠️ **Common Pitfall:** Granting operators `cluster-admin`. Scope RBAC to the CRDs and child resources they manage.

---

## 29.10 Hands-on exercises

1. Apply the `TaskBatch` CRD from this chapter, create an instance, and inspect it with `kubectl get tb -o yaml`. Confirm no Jobs exist until a controller creates them.
2. Write a ValidatingAdmissionPolicy that denies Deployments missing `spec.template.spec.containers[*].resources.requests.cpu` in a labeled namespace. Prove Warn vs Deny behavior.
3. Add a MutatingAdmissionPolicy that sets `metadata.labels.managed-by=cel-policy` on Pod CREATE. Show the label appearing without any webhook Pod running.
4. Inspect `kubectl get apiservices` on your cluster and identify which groups are `Local` versus backed by a Service.
5. (Stretch) Scaffold a tiny controller with Kubebuilder or Operator SDK that creates a Job per TaskBatch and updates status.

---

## 29.11 Check Your Understanding

**Q1.** Does creating a CRD automatically enforce business logic like “create five Jobs”?

<details>
<summary>Show answer</summary>

No. A CRD only registers the API type and schema. A controller or operator must watch instances and reconcile dependent objects.
</details>

**Q2.** What problem does the aggregation layer solve that CRDs do not?

<details>
<summary>Show answer</summary>

It lets a separate extension API server serve an API group behind kube-apiserver—useful for custom storage, protocols, or implementations that do not fit CRD etcd storage.
</details>

**Q3.** What became GA in Kubernetes 1.36 for admission?

<details>
<summary>Show answer</summary>

MutatingAdmissionPolicy (and its binding) graduated to stable `admissionregistration.k8s.io/v1`, enabling CEL-based in-process mutations without a mutating webhook service.
</details>

**Q4.** When would you still use a validating admission webhook instead of ValidatingAdmissionPolicy?

<details>
<summary>Show answer</summary>

When validation needs external data, proprietary engines, or logic that CEL in-process cannot express cleanly—or when you are not yet ready to migrate an existing webhook investment.
</details>

**Q5.** Why are `failurePolicy` and webhook timeouts operationally critical?

<details>
<summary>Show answer</summary>

They determine whether API requests fail closed or open when the webhook is down or slow, and slow webhooks stall the apiserver’s admission path for every matching request.
</details>

---

## 29.12 Key takeaways

- **CRDs** add nouns; **operators** add verbs that reconcile them.
- The **aggregation layer** proxies specialized APIs through the front door when CRDs are not enough.
- **Admission webhooks** remain powerful but operationally heavy—HA, TLS, and blast radius matter.
- **ValidatingAdmissionPolicy** and **MutatingAdmissionPolicy** (GA in 1.36) bring CEL policies in-process for the common validation and mutation cases.
- Pick the **smallest extension point** that meets the need; not every platform problem deserves a new webhook service.

---

## 29.13 Official documentation map

| Topic | Official page |
|-------|---------------|
| Custom Resources | [Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/) |
| Extend the API with CRDs | [Extend the Kubernetes API with CustomResourceDefinitions](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/) |
| Operator pattern | [Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) |
| API aggregation | [Configure the aggregation layer](https://kubernetes.io/docs/tasks/extend-kubernetes/configure-aggregation-layer/) |
| Dynamic admission | [Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) |
| ValidatingAdmissionPolicy | [Validating Admission Policy](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/) |
| MutatingAdmissionPolicy | [Mutating Admission Policy](https://kubernetes.io/docs/reference/access-authn-authz/mutating-admission-policy/) |
| CEL in Kubernetes | [Common Expression Language in Kubernetes](https://kubernetes.io/docs/reference/using-api/cel/) |

**Previous:** [Chapter 28 — Cluster Lifecycle with kubeadm](28-cluster-lifecycle-kubeadm.md) | **Next:** [Chapter 30 — Advanced Object Management](30-object-management-advanced.md)
