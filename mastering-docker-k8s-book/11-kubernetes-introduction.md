# Chapter 11 — Introduction to Kubernetes

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain which production problems container orchestration solves that single-host Docker cannot
> - Contrast imperative and declarative operations, and say why declarative wins at scale
> - Describe the reconciliation loop that makes Kubernetes self-healing
> - Name the core vocabulary — cluster, node, control plane, Pod, object, controller — in plain language
> - Create a local Kubernetes 1.36 cluster with kind and talk to it using `kubectl`
> - Run the Task API first imperatively, then declaratively with a version-controlled manifest
> - Recognize what Kubernetes deliberately does *not* do for you

---

## 11.1 Three in the morning

Alex's phone buzzes at 03:12. The Task API — the small Flask service you packaged back in Chapter 04 — is down. A host rebooted after a kernel update, and the container that was started with `docker run -d` never came back. Alex SSHs in, runs `docker start task-api`, and goes back to bed.

At 03:40 the phone buzzes again. Different host. Same story.

Nothing here is a mystery. The container worked. The image was fine. The *operating model* was wrong: a human being was the only component that knew the Task API was supposed to be running. Docker faithfully did what it was told — start this container, once — and nothing more.

Now scale that up. Forty services. Twelve machines. Launch-day traffic that triples in an hour. A bad release that needs to roll back without dropping requests. A machine that dies for good. Every one of those situations needs a decision, and every decision made by a tired human at 3 a.m. is a decision made badly.

**Container orchestration** is the practice of handing those decisions to software. **Kubernetes** — often written **K8s**, "K", eight letters, "s" — is the orchestrator that the industry standardized on, and this chapter is where your Docker knowledge starts paying compound interest.

### The harbor master analogy

Picture a busy container port. Shipping containers arrive by the thousand. Nobody wants a human running between cranes shouting instructions about which box goes on which berth.

Instead, the port has a **harbor master** who holds a manifest: *"There must always be three refrigerated containers on the north dock, held at 4 °C."* Cranes, trucks, and cooling units are dispatched automatically to make reality match that manifest. When a cooling unit fails, the harbor master moves the container to a working berth — nobody files a request.

Kubernetes is that harbor master. You do not describe the steps; you describe the **desired state** of the port, and Kubernetes works continuously to make the world match your description. That single idea carries the rest of this book.

<!-- VISUAL: Port scene split in two. Left: a person with a clipboard manually directing one crane ("Docker: you run one command, one thing happens"). Right: a manifest document feeding a control tower that dispatches many cranes and replaces a failed cooling unit automatically ("Kubernetes: declare desired state, controllers converge"). -->

---

## 11.2 What orchestration actually buys you

### In plain terms

Orchestration is the difference between hiring a contractor for one afternoon and hiring a building superintendent. The contractor does exactly what you ask, when you ask. The superintendent keeps the building in the condition you agreed on — forever — noticing broken things before you do and fixing them without a conversation.

Concretely, an orchestrator answers questions you would otherwise answer by hand:

| Question at 3 a.m. | Who answers it in Kubernetes |
|--------------------|------------------------------|
| The container exited. Who restarts it? | The kubelet, guided by the Pod's restart policy |
| This machine is gone. Who moves its work? | The node lifecycle and workload controllers, plus the scheduler |
| Traffic tripled. Who runs more copies? | A Deployment plus a HorizontalPodAutoscaler |
| Where should this new copy run? | The scheduler, using resource requests and constraints |
| How do callers find the healthy copies? | A Service, backed by EndpointSlices and cluster DNS |
| The new version is broken. Who rolls back? | The Deployment controller, from its revision history |

### Under the hood

Kubernetes is not one program. It is a small set of cooperating components plus a lot of independent **controllers**, all coordinating through one shared, versioned datastore reached via one HTTP API.

```text
you ──kubectl──►  API server  ──►  etcd (the only source of truth)
                    ▲   ▲
                    │   └── controllers watch objects and act
                    └────── kubelets on every node report and obey
```

Three properties fall out of that design and explain most of Kubernetes's behavior:

1. **Everything is an object in the API.** Pods, Services, Secrets, even node heartbeats. If you can `GET` it, you can watch it, and if you can watch it, you can automate it.
2. **Nothing talks directly to anything else.** Controllers do not call the scheduler; they write objects and let the scheduler notice. This decoupling is why Kubernetes survives components restarting.
3. **Work is level-triggered, not edge-triggered.** Components re-derive what to do from current state rather than from a stream of events they must never miss. A missed event is not a catastrophe; the next sync fixes it.

You will trace all of this concretely in Chapter 12.

### In production

Orchestration is not free, and pretending otherwise is how teams get hurt. Adopting Kubernetes means adopting:

- **A new failure surface.** Your app can now fail *and* the platform can fail. You need to know which is which (Chapter 22).
- **Capacity discipline.** Requests and limits are how the scheduler makes decisions. Skip them and you get mystery evictions (Chapter 13).
- **Upgrade cadence.** Kubernetes ships roughly three minor releases a year and supports about the last four (this book targets **1.36**, with 1.33–1.36 as the practical support window). Clusters are living systems, not appliances.
- **Configuration as code.** If your cluster state exists only in shell history, you have rebuilt the 3 a.m. problem with more moving parts.

A useful rule of thumb: adopt Kubernetes when you have **many services, more than one machine, and real uptime expectations**. One container on one small VM is a job for plain Docker or a managed container service, and choosing the boring option there is a sign of seniority, not inexperience.

---

## 11.3 Imperative and declarative

### In plain terms

Imperative is a *recipe*: "boil water, add pasta, drain after nine minutes." Declarative is an *order*: "I would like a plate of pasta, al dente." The recipe tells someone what to do; the order tells them what you want, and lets them figure out the steps — including what to do when the water boils over.

With Docker you were imperative:

```bash
$ docker run -d -p 8000:8000 ghcr.io/mastering-k8s/task-api:1.0
$ docker stop task-api
$ docker rm task-api
```

Each command happens once, right now. The knowledge "this service should be running" lives in your head.

With Kubernetes you mostly write down what you want and let the cluster keep that promise:

```yaml
# Plain English version of a manifest:
# "There should always be three healthy copies of task-api:1.0."
```

### Under the hood

Kubernetes accepts both styles, and the difference shows up in how state is stored.

| Style | Command examples | What the cluster remembers |
|-------|------------------|----------------------------|
| Imperative commands | `kubectl run`, `kubectl scale`, `kubectl delete` | The resulting object, with no record of your intent |
| Imperative object config | `kubectl create -f file.yaml` | The object; fails if it already exists |
| Declarative object config | `kubectl apply -f file.yaml` | The object **plus** a record of the fields you claim to manage |

That last row is the important one. `kubectl apply` performs a three-way merge between your file, the live object, and the fields you managed last time (tracked in `metadata.managedFields`, the mechanism known as **server-side apply**). Because your intent is recorded, `apply` can tell the difference between "the user removed this field" and "the user never set this field," and it can leave fields owned by other actors — an autoscaler, a mutating policy — alone.

Run the same command twice and watch the verb change:

```bash
$ kubectl apply -f task-api-pod.yaml
```

```text
pod/task-api created
```

```bash
$ kubectl apply -f task-api-pod.yaml
```

```text
pod/task-api unchanged
```

> 💡 **Tip:** Use imperative commands to *learn* and to *generate*, not to operate. `kubectl create deployment task-api --image=ghcr.io/mastering-k8s/task-api:1.0 --dry-run=client -o yaml > deploy.yaml` gives you a valid starting manifest in one line, which you then edit, review, and commit.

### In production

Declarative configuration is the entry ticket to every practice that makes clusters boring in a good way:

- **Code review for infrastructure.** A YAML diff in a pull request is auditable; a Slack message saying "I scaled it" is not.
- **Disaster recovery.** If your manifests are in Git, a lost cluster is an afternoon of rebuilding, not an archaeology project.
- **GitOps.** Tools like Argo CD and Flux continuously apply a Git repository to a cluster and report drift. This only works if Git is authoritative.
- **Safe collaboration.** Server-side apply lets several controllers own different fields of the same object without fighting each other.

> ⚠️ **Warning:** `kubectl edit` and `kubectl scale` change the cluster but not your files. The next `apply` will silently revert your change, usually at the worst possible moment. Treat live edits as emergency surgery: allowed, then immediately reflected back into the repository.

---

## 11.4 The reconciliation loop

### In plain terms

A thermostat does not need to be told to turn the heat on. You set 21 °C; it measures the room, compares, and acts — over and over, forever. It does not care *why* the room got cold: an open window, a failed radiator, winter. It only cares that reality differs from the setting.

Kubernetes is built almost entirely out of thermostats. Each one is called a **controller**.

### Under the hood

Every controller runs the same loop:

1. **Observe** current state (by watching the API server).
2. **Compare** it to desired state (the `spec` you wrote).
3. **Act** to close the gap (create, update, or delete objects).
4. **Report** what it sees in `status`.
5. Repeat forever.

```text
   ┌──────────────────────────────┐
   │                              │
   ▼                              │
observe current state             │
   │                              │
   ▼                              │
compare with desired state ── equal? ── yes ──┘
   │
   │ no
   ▼
act to converge, update status ───► (loop again)
```

A concrete trace, in the language of objects:

```text
Deployment spec: replicas: 3       (what you want)
ReplicaSet status: replicas: 2     (what exists — one Pod was evicted)
                    ↓
ReplicaSet controller creates 1 Pod
                    ↓
scheduler assigns it a node
                    ↓
kubelet on that node starts the container and reports Ready
                    ↓
current state: 3 Ready Pods → loop finds nothing to do
```

Nobody issued a "restart" command. One controller noticed a shortfall and wrote one object. This is why Kubernetes appears to heal itself: self-healing is just reconciliation you were not watching.

### In production

The loop shapes how you debug and how you design:

- **Read `status`, not just logs.** `kubectl describe` and `kubectl get -o yaml` show what the responsible controller believes. Conditions such as `Available`, `Progressing`, and `Ready` are the platform telling you where the loop is stuck.
- **Expect eventual, not instant.** Reconciliation is asynchronous. "I applied it and nothing happened" usually means "give it a few seconds and then read the events."
- **Never fight a controller.** Manually deleting a Pod that a Deployment owns just makes a new Pod. Change the desired state instead.
- **Fix causes, not symptoms.** If Pods restart in a loop, the loop is working correctly and your container is not.

> 💡 **Tip:** Whenever something in the rest of this book "just fixes itself," pause and name the controller responsible. That habit turns Kubernetes from magic into mechanism.

---

## 11.5 The vocabulary, and the shape of every object

### In plain terms

Kubernetes has a large vocabulary but a tiny grammar. Nine words carry you through most conversations:

| Term | One-line meaning | Covered in |
|------|------------------|------------|
| **Cluster** | A set of machines managed as one pool | Chapter 12 |
| **Node** | One machine (VM or physical) in that pool | Chapter 12 |
| **Control plane** | The brain: API server, scheduler, controllers, datastore | Chapter 12 |
| **Pod** | Smallest deployable unit: one or more containers sharing a network and storage | Chapter 13 |
| **Object** | A persisted record of intent plus observed state | This chapter |
| **Controller** | A loop driving current state toward desired state | This chapter, Chapter 14 |
| **Deployment** | Controller for stateless replicas and rollouts | Chapter 14 |
| **Service** | A stable network identity for a set of Pods | Chapter 15 |
| **Namespace** | A virtual sub-cluster for grouping and isolating objects | Chapter 12 |

### Under the hood

Every object — a one-line ConfigMap or a sprawling StatefulSet — has the same four fields you write, plus one you never do:

```yaml
apiVersion: v1        # which API group and version defines this kind
kind: Pod             # what kind of object this is
metadata:             # identity: name, namespace, labels, annotations
  name: task-api
  labels:
    app: task-api
spec:                 # DESIRED state — you write this
  containers:
    - name: task-api
      image: ghcr.io/mastering-k8s/task-api:1.0
# status:             # OBSERVED state — Kubernetes writes this
```

Learn to read that shape and you can read any manifest, including ones for resources that do not exist yet: custom resources added by operators follow exactly the same grammar.

`kubectl explain` is the built-in reference, generated from the API your cluster actually serves:

```bash
$ kubectl explain pod.spec.containers.image
```

```text
KIND:       Pod
VERSION:    v1

FIELD: image <string>

DESCRIPTION:
    Container image name. More info:
    https://kubernetes.io/docs/concepts/containers/images
    This field is optional to allow higher level config management to default or
    override container images in workload controllers like Deployments and
    StatefulSets.
```

### In production

- **Names are identity.** Within a namespace and kind, `metadata.name` is unique and immutable. Renaming means delete and recreate — which for a Service means a new set of endpoints, and for a StatefulSet means new Pod identities.
- **Labels are how everything finds everything.** Services select Pods by label, controllers own Pods by label, and your dashboards group by label. Agree on a label scheme (`app`, `component`, `part-of`, `env`, `version`) on day one; retrofitting labels is tedious.
- **Annotations are for tools.** Anything non-identifying — checksums, controller hints, change-cause notes — belongs in annotations, which are never used for selection.

> 📘 **Deep Dive (optional):** The `apiVersion` field encodes a group and a version, such as `apps/v1` (group `apps`) or plain `v1` (the legacy core group, whose group name is the empty string). Groups let Kubernetes evolve independently in different areas, and versions (`v1alpha1` → `v1beta1` → `v1`) encode stability promises. This book uses GA (`v1`) APIs everywhere; Chapter 12 shows how to list what your cluster serves.

---

## 11.6 A local cluster with kind

### In plain terms

You do not need a data center to learn Kubernetes. Several tools run a complete cluster on a laptop:

- **kind** — "Kubernetes IN Docker." Each node is a Docker container. Fast, disposable, ideal for CI.
- **minikube** — A cluster in a VM or container, with many bundled add-ons.
- **k3d / k3s** — A lightweight certified distribution, popular for edge and small clusters.
- **Docker Desktop** — A single-node Kubernetes you can enable in settings.

This book uses **kind**, because you already have Docker Engine 29.x from Part I and kind needs nothing else.

### Under the hood

You need two binaries: `kubectl` (the client) and `kind` (the cluster creator).

```bash
$ curl -LO "https://dl.k8s.io/release/v1.36.1/bin/linux/amd64/kubectl"
$ sudo install -m 0755 kubectl /usr/local/bin/kubectl
$ kubectl version --client
```

```text
Client Version: v1.36.1
Kustomize Version: v5.7.1
```

```bash
$ go install sigs.k8s.io/kind@v0.32.0    # or download the release binary
$ kind version
```

```text
kind v0.32.0 go1.25.3 linux/amd64
```

Create a three-node cluster (one control plane, two workers) so that later chapters can demonstrate scheduling, DaemonSets, and topology:

```yaml
# kind-cluster.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: mastering-k8s
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

```bash
$ kind create cluster --config kind-cluster.yaml --image kindest/node:v1.36.0
```

```text
Creating cluster "mastering-k8s" ...
 ✓ Ensuring node image (kindest/node:v1.36.0) 🖼
 ✓ Preparing nodes 📦 📦 📦
 ✓ Writing configuration 📜
 ✓ Starting control-plane 🕹️
 ✓ Installing CNI 🔌
 ✓ Installing StorageClass 💾
 ✓ Joining worker nodes 🚜
Set kubectl context to "kind-mastering-k8s"
You can now use your cluster with:

kubectl cluster-info --context kind-mastering-k8s
```

```bash
$ kubectl get nodes
```

```text
NAME                          STATUS   ROLES           AGE   VERSION
mastering-k8s-control-plane   Ready    control-plane   71s   v1.36.0
mastering-k8s-worker          Ready    <none>          58s   v1.36.0
mastering-k8s-worker2         Ready    <none>          58s   v1.36.0
```

`kubectl` learned about this cluster from a **kubeconfig** file (default `~/.kube/config`), which stores clusters, credentials, and **contexts** that pair the two. kind added a context and made it active.

```bash
$ kubectl config current-context
```

```text
kind-mastering-k8s
```

> 💡 **Tip:** kind pins node images by digest in its release notes, and newer patch images (for example `kindest/node:v1.36.1`) appear over time. Pinning `--image kindest/node:v1.36.0@sha256:…` in CI makes cluster creation reproducible; the plain tag is fine while learning.

### In production

Your laptop cluster is a learning environment, not a small production cluster. Real clusters differ in ways worth knowing now:

| Concern | kind on a laptop | Production |
|---------|------------------|------------|
| Control plane | One container, no redundancy | Three or more replicas, etcd quorum, backups |
| Node lifecycle | You delete the cluster | Autoscaling groups, drain and cordon procedures |
| Load balancers | `Service type: LoadBalancer` stays `<pending>` | Cloud controller provisions a real load balancer |
| Storage | Local path provisioner | CSI drivers with real disks and snapshots |
| Access control | Your kubeconfig is cluster-admin | RBAC per team, short-lived credentials (Chapter 21) |

The habit worth building today is context hygiene: check `kubectl config current-context` before anything destructive. "I thought I was on staging" is the single most expensive sentence in cluster operations.

---

## 11.7 Your first workload, twice

### In plain terms

We will run the Task API two ways: the quick imperative way, to see something work in ten seconds, and then the declarative way we use for the rest of the book.

### Under the hood

**Imperatively**, one command creates a Pod:

```bash
$ kubectl run task-api --image=ghcr.io/mastering-k8s/task-api:1.0 --port=8000
```

```text
pod/task-api created
```

```bash
$ kubectl get pods
```

```text
NAME       READY   STATUS    RESTARTS   AGE
task-api   1/1     Running   0          14s
```

Pod IPs are internal to the cluster network, so reach it through a local tunnel:

```bash
$ kubectl port-forward pod/task-api 8000:8000
```

```text
Forwarding from 127.0.0.1:8000 -> 8000
Forwarding from [::1]:8000 -> 8000
```

In a second terminal:

```bash
$ curl -s localhost:8000/healthz
```

```text
{"status":"ok"}
```

Clean up, then do it properly:

```bash
$ kubectl delete pod task-api
```

```text
pod "task-api" deleted
```

**Declaratively**, write the manifest down:

```yaml
# task-api-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: task-api
  labels:
    app: task-api
spec:
  containers:
    - name: task-api
      image: ghcr.io/mastering-k8s/task-api:1.0
      ports:
        - name: http
          containerPort: 8000
      env:
        - name: LOG_LEVEL
          value: "info"
```

```bash
$ kubectl apply -f task-api-pod.yaml
```

```text
pod/task-api created
```

Now add a label to the file and apply the *same command*:

```yaml
metadata:
  name: task-api
  labels:
    app: task-api
    tier: backend      # newly added
```

```bash
$ kubectl apply -f task-api-pod.yaml
```

```text
pod/task-api configured
```

The verb changed from `created` to `configured`: Kubernetes computed the difference and applied only that. Inspect what it recorded, including the `status` you never wrote:

```bash
$ kubectl get pod task-api -o wide
```

```text
NAME       READY   STATUS    RESTARTS   AGE   IP           NODE                   NOMINATED NODE   READINESS GATES
task-api   1/1     Running   0          49s   10.244.1.4   mastering-k8s-worker   <none>           <none>
```

```bash
$ kubectl describe pod task-api
```

```text
Name:             task-api
Namespace:        default
Node:             mastering-k8s-worker/172.18.0.3
Labels:           app=task-api
                  tier=backend
Status:           Running
IP:               10.244.1.4
Containers:
  task-api:
    Image:          ghcr.io/mastering-k8s/task-api:1.0
    Port:           8000/TCP
    State:          Running
    Ready:          True
    Restart Count:  0
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  50s   default-scheduler  Successfully assigned default/task-api to mastering-k8s-worker
  Normal  Pulled     49s   kubelet            Container image "ghcr.io/mastering-k8s/task-api:1.0" already present on machine
  Normal  Created    49s   kubelet            Created container: task-api
  Normal  Started    49s   kubelet            Started container task-api
```

Read the **Events** block bottom-up whenever something misbehaves; it is the cluster narrating what it attempted.

> ⚠️ **Warning:** A bare Pod is not self-healing. Delete it, or lose its node, and nothing brings it back — no controller ever recorded that it should exist. Production workloads are wrapped in a Deployment (Chapter 14). We used a raw Pod here to keep the first example honest and minimal.

### In production

The declarative version of this same workload, made production-shaped, gains four things you will add over the next chapters: a **Deployment** for replicas and rollouts, a **Service** for a stable address, **probes** so traffic only reaches healthy Pods, and **resource requests** so the scheduler can place it. The manifest you just wrote is the seed of all of them.

Two habits to start now:

- **Store manifests in Git next to the app.** The image tag and the manifest that deploys it should move through review together.
- **Pin image tags.** `:latest` means two nodes can run two different builds of "the same" version, and rollbacks stop being meaningful. This book always pins (`:1.0`), and digests (`@sha256:…`) are better still.

---

## 11.8 What Kubernetes is not

Setting expectations prevents disappointment and bad architecture:

- **Not a PaaS.** Kubernetes will not build your image, choose your database, or give you `git push` deploys. Those live in layers built on top (Helm in Chapter 23, CI in Chapter 24).
- **Not a fix for bad code.** A service that leaks memory will be restarted forever, which converts a bug into an outage with extra steps.
- **Not a security boundary by default.** Containers still share a kernel, Pods can still run as root, and namespaces are not tenancy. Chapters 19 and 21 cover what to add.
- **Not a stateful-database replacement.** You *can* run databases on Kubernetes (Chapters 14 and 18), but the operational care required does not go away.
- **Not the simplest option for small deployments.** One container on one VM does not need a control plane.

---

## 11.9 Common pitfalls

> ⚠️ **Common Pitfall:** **Running against the wrong cluster.** `kubectl` targets whatever context is active. Check `kubectl config current-context` before destructive commands, and consider a shell prompt that shows the context.

> ⚠️ **Common Pitfall:** **Creating bare Pods in production.** Unmanaged Pods do not reschedule after node failure. Use a Deployment (or another controller) so a loop owns the promise.

> ⚠️ **Common Pitfall:** **Editing live objects and forgetting the file.** `kubectl edit` changes the cluster only. The next `apply` reverts it. Push emergency edits back into Git the same day.

> ⚠️ **Common Pitfall:** **Using `:latest` tags.** Non-reproducible rollouts, meaningless rollbacks, and cache-dependent behavior. Pin versions.

> ⚠️ **Common Pitfall:** **Expecting Pod IPs to work from your laptop.** They are cluster-internal. Use `kubectl port-forward` for a peek and a Service or Ingress for real access (Chapters 15 and 16).

> ⚠️ **Common Pitfall:** **Assuming `apply` is instant.** It records intent; controllers converge afterward. Watch with `kubectl get pods -w` and read events instead of re-applying in frustration.

---

## 11.10 Hands-on exercises

1. **Build the cluster.** Create the three-node kind cluster from §11.6 with `kindest/node:v1.36.0`. Run `kubectl get nodes -o wide` and record each node's internal IP, OS image, and container runtime version.
2. **Apply and read status.** Apply `task-api-pod.yaml`, then run `kubectl get pod task-api -o yaml`. List five fields under `status` that you never wrote, and say which component you think set each one.
3. **Prove the limits of a bare Pod.** Delete the Pod with `kubectl delete pod task-api` and confirm with `kubectl get pods` that nothing replaces it. Write one sentence explaining this in terms of reconciliation.
4. **Generate, then commit.** Run `kubectl create deployment task-api --image=ghcr.io/mastering-k8s/task-api:1.0 --dry-run=client -o yaml > task-api-deploy.yaml`. Which of the four top-level fields are present? Apply it, run `kubectl get pods`, then delete the Deployment.
5. **Read a failure.** Apply a Pod whose image tag does not exist (`ghcr.io/mastering-k8s/task-api:does-not-exist`). Record the `STATUS` from `kubectl get pods` and the exact Event message from `kubectl describe pod` that explains the problem.
6. **Watch a loop.** With the generated Deployment running, run `kubectl get pods -w` in one terminal and `kubectl delete pod <one-pod-name>` in another. Describe what you observe and name the controller responsible.
7. **Extend the analogy.** In three sentences, describe what the harbor master does when you change the manifest from three refrigerated containers to five, and map each step to observe / compare / act.

---

## 11.11 Check Your Understanding

**Q1.** State the central idea of Kubernetes in one sentence.

<details>
<summary>Show answer</summary>

You declare the desired state of your workloads as objects in the API, and controllers run a continuous reconciliation loop that drives the cluster's current state toward that desired state.

</details>

**Q2.** Why is `kubectl apply` preferred over `kubectl create` for anything long-lived?

<details>
<summary>Show answer</summary>

`apply` is declarative and idempotent: it merges your manifest with the live object and records which fields you manage, so repeated runs are safe, updates work, and other controllers can own other fields. `create` is a one-shot imperative action that fails when the object exists, which makes it a poor fit for version-controlled workflows.

</details>

**Q3.** A bare Pod was running on a node that crashed. What happens, and why?

<details>
<summary>Show answer</summary>

The Pod is gone and is not recreated. No controller ever recorded that a replacement should exist, so no reconciliation loop notices a gap. A Deployment (through its ReplicaSet) would observe a shortfall in replicas and create a new Pod on a healthy node.

</details>

**Q4.** Which top-level field do you never write, and who writes it?

<details>
<summary>Show answer</summary>

`status`. Kubernetes components write it — controllers and the kubelet report observed state there. You write `apiVersion`, `kind`, `metadata`, and `spec`.

</details>

**Q5.** Name three problems orchestration solves that single-host Docker does not.

<details>
<summary>Show answer</summary>

Any three of: restarting and rescheduling workloads after container or machine failure; scaling replicas and load-balancing across them; zero-downtime rollouts with rollback; placing workloads across many machines according to available resources; providing stable network identities and service discovery; keeping desired state recorded so nothing depends on a human remembering it.

</details>

**Q6.** Why is level-triggered reconciliation more robust than reacting to a stream of events?

<details>
<summary>Show answer</summary>

Because controllers re-derive the correct action from the current state instead of depending on having seen every event. A dropped or duplicated event, a controller restart, or a network blip cannot leave the system permanently wrong: the next sync recomputes the gap and closes it.

</details>

**Q7.** You applied a manifest and nothing seems to have happened. What are the first two things to check?

<details>
<summary>Show answer</summary>

First, confirm you targeted the intended cluster and namespace (`kubectl config current-context`, `kubectl get pods -n <namespace>`). Second, read observed state and events (`kubectl describe …`), because reconciliation is asynchronous and the reason for a stall — image pull failure, unschedulable Pod, quota rejection — is almost always in the events or in a status condition.

</details>

---

## 11.12 Key takeaways

- Orchestration exists because someone has to hold the promise "this should be running," and a human at 3 a.m. is the wrong someone.
- Kubernetes is **declarative**: you write `spec`, controllers write `status`, and a reconciliation loop closes the gap forever. Self-healing is that loop, observed.
- Every object shares the shape `apiVersion` / `kind` / `metadata` / `spec`, so learning to read one manifest teaches you to read all of them.
- Prefer `kubectl apply` with manifests in Git; use imperative commands to explore and to generate YAML, not to operate.
- **kind** with `kindest/node:v1.36.0` gives you a real multi-node Kubernetes 1.36 cluster on a laptop; always verify your context before acting.
- Bare Pods are for learning. Controllers (Chapter 14) are for production — and Services, probes, and resource requests turn a demo into a deployment.
- Kubernetes is not a PaaS, not a security boundary by default, and not a substitute for sound application design.

---

## 11.13 Official documentation map

| Topic | Official page |
|-------|---------------|
| What Kubernetes is | [Overview](https://kubernetes.io/docs/concepts/overview/) |
| Cluster components | [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/) |
| The API and objects | [The Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/) |
| Controllers and reconciliation | [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) |
| Installing `kubectl` and friends | [Install Tools](https://kubernetes.io/docs/tasks/tools/) |
| Local and production setup options | [Getting started](https://kubernetes.io/docs/setup/) |
| Declarative management | [Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) |
| Object management styles | [Managing Kubernetes Objects](https://kubernetes.io/docs/concepts/cluster-administration/manage-deployment/) |
| Guided walkthrough | [Kubernetes Basics tutorial](https://kubernetes.io/docs/tutorials/kubernetes-basics/) |
| Port forwarding for local access | [Use Port Forwarding](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/) |
| kind quick start | [kind — Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start/) |
| Release notes for this baseline | [Kubernetes v1.36 release announcement](https://kubernetes.io/blog/2026/04/22/kubernetes-v1-36-release/) |

---

**Previous:** [Chapter 10 — Docker Security Basics](10-docker-security-basics.md) | **Next:** [Chapter 12 — Kubernetes Architecture](12-k8s-architecture.md)
