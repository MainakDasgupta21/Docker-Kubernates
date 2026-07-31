# Chapter 28 — Cluster Lifecycle with kubeadm

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Bootstrap a Kubernetes 1.36 control plane and join workers with **kubeadm**
> - Choose and sketch HA topologies (stacked vs external etcd, load-balanced API)
> - Explain the cluster PKI layout and rotate or renew certificates safely
> - Plan and execute version upgrades within the supported window (1.33–1.36)
> - Cordon, drain, and retire nodes without surprise downtime
> - Back up, restore, and operate etcd as the cluster’s source of truth

---

## 28.1 Opening story: the city that rebuilds itself

Imagine you are handed the keys to a small city. On day one you pour foundations (control plane), connect power and water (CNI and kubelet), and issue building permits (API certificates). Over the years you add neighborhoods (worker nodes), renovate city hall without closing the streets (upgrades), and keep the deed registry vaulted and backed up (etcd).

**kubeadm** is the official toolbox for that civic construction when you run Kubernetes yourself—on VMs, bare metal, or a lab. Managed services (EKS, GKE, AKS) hide most of this chapter; the concepts still apply when you debug upgrades, certificates, or node maintenance. If you only ever click “upgrade cluster” in a cloud console, read this once so you know what that button is really doing.

> 💡 **Tip:** Practice on disposable VMs or a nested lab before touching production. kubeadm is deliberate and powerful; a mistyped `--control-plane-endpoint` or a skipped etcd snapshot is expensive.

---

## 28.2 What kubeadm is (and is not)

### In plain terms

kubeadm is a **certified installer and lifecycle helper**, not a full platform product. It gets you a conformant control plane and a clean join path for nodes. You still choose the OS, container runtime, CNI plugin, load balancer, and how you patch hosts.

kubeadm bootstraps clusters to best-practice defaults; it is not a full day-2 fleet manager. You might think kubeadm replaces Terraform/Cluster API for lifecycle—many teams compose them.

> ⚠️ **Common Pitfall:** Treating kubeadm init as a one-way irreversible snowflake with no documented config.

### Under the hood

kubeadm’s main verbs:

| Command | Role |
|---------|------|
| `kubeadm init` | Bootstrap the first control-plane node |
| `kubeadm join` | Add workers or extra control-plane members |
| `kubeadm upgrade` | Plan and apply version bumps |
| `kubeadm reset` | Tear down kubeadm-managed state on a node |
| `kubeadm certs` | Inspect and renew cluster certificates |
| `kubeadm token` | Manage bootstrap tokens for joins |
| `kubeadm config` | Print or migrate ClusterConfiguration |

A minimal init (lab-shaped; adjust versions and CIDRs for your environment):

```bash
$ sudo kubeadm init \
    --kubernetes-version=v1.36.0 \
    --pod-network-cidr=10.244.0.0/16 \
    --control-plane-endpoint=k8s-api.example.com:6443 \
    --upload-certs
```

Typical success output (abbreviated):

```text
Your Kubernetes control-plane has initialized successfully!

To start using your cluster, you need to run the following as a regular user:

  mkdir -p $HOME/.kube
  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
  sudo chown $(id -u):$(id -g) $HOME/.kube/config

Then you can join any number of worker nodes by running:

  kubeadm join k8s-api.example.com:6443 --token <token> \
    --discovery-token-ca-cert-hash sha256:<hash>
```

After init, install a CNI (Calico, Cilium, Flannel, and so on). Until the CNI is healthy, CoreDNS and other system Pods often stay `Pending` or `ContainerCreating`.

```bash
$ mkdir -p $HOME/.kube
$ sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
$ sudo chown "$(id -u):$(id -g)" $HOME/.kube/config

$ kubectl get nodes
NAME     STATUS     ROLES           AGE   VERSION
cp-1     NotReady   control-plane   30s   v1.36.0
```

`NotReady` here usually means “no CNI yet,” not “kubeadm failed.”

Declarative configuration (preferred for anything beyond a throwaway lab):

```yaml
# kubeadm-config.yaml
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: v1.36.0
controlPlaneEndpoint: "k8s-api.example.com:6443"
networking:
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/12"
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
localAPIEndpoint:
  advertiseAddress: "192.168.10.11"
  bindPort: 6443
nodeRegistration:
  criSocket: unix:///var/run/containerd/containerd.sock
```

```bash
$ sudo kubeadm init --config=kubeadm-config.yaml --upload-certs
```

### In production

**Ownership:** Platform owns kubeadm config and upgrades; keep ClusterConfiguration in Git.

**Failure mode:** Snowflake clusters → unrepeatable restores. Detect with config drift checks. Mitigate with checked-in kubeadm configs and rebuild drills.

| Do | Don't |
|----|-------|
| Version-control kubeadm config | Undocumented manual tweaks on masters |
| Know what kubeadm does not manage | Expect kubeadm to manage app addons forever alone |

**Before you leave this section**

- **Understand:** kubeadm bootstraps; you still own day-2 operations.
- **Try:** Read a kubeadm ClusterConfiguration and note version fields.
- **Watch in prod:** Undocumented control-plane snowflakes.


---

## 28.3 Bootstrap workflow end to end

### In plain terms

Building a cluster is a checklist: prepare machines → init first control plane → install networking → join workers → verify. Skip a step and the city has houses with no roads.

Init control plane, join workers, install CNI—order matters. You might think Pods will schedule before CNI—they will not become Ready.

> ⚠️ **Common Pitfall:** Forgetting CNI and debugging apps for hours.

### Under the hood

**Prerequisites (each node):**

- Compatible Linux (check kubeadm’s OS matrix for 1.36)
- swap off (or configured per current kubelet guidance)
- container runtime with CRI (typically **containerd**)
- required ports open (6443 API, 2379–2380 etcd on control plane, 10250 kubelet, NodePort range if used, CNI-specific ports)
- `kubeadm`, `kubelet`, `kubectl` packages installed; kubelet enabled

```bash
$ sudo systemctl enable --now kubelet
$ sudo crictl info
```

**Join a worker:**

```bash
$ sudo kubeadm join k8s-api.example.com:6443 \
    --token abcdef.0123456789abcdef \
    --discovery-token-ca-cert-hash sha256:0123...cdef
```

Create a fresh token if the default expired (tokens last 24 hours by default):

```bash
$ kubeadm token create --print-join-command
```

**Verify:**

```bash
$ kubectl get nodes -o wide
NAME     STATUS   ROLES           AGE   VERSION   INTERNAL-IP     OS-IMAGE
cp-1     Ready    control-plane   1h    v1.36.0   192.168.10.11   Ubuntu 24.04
wk-1     Ready    <none>          10m   v1.36.0   192.168.10.21   Ubuntu 24.04
wk-2     Ready    <none>          9m    v1.36.0   192.168.10.22   Ubuntu 24.04

$ kubectl get pods -n kube-system
NAME                               READY   STATUS    RESTARTS   AGE
coredns-7db6d8ff4d-xk2m9           1/1     Running   0          1h
etcd-cp-1                          1/1     Running   0          1h
kube-apiserver-cp-1                1/1     Running   0          1h
kube-controller-manager-cp-1       1/1     Running   0          1h
kube-proxy-abc12                   1/1     Running   0          10m
kube-scheduler-cp-1                1/1     Running   0          1h
```

```mermaid
sequenceDiagram
  participant operator as Operator
  participant controlPlane as First control-plane node
  participant cni as CNI plugin
  participant workers as Worker nodes
  participant apiServer as Kubernetes API
  operator->>controlPlane: Prepare runtime, ports, and packages
  operator->>controlPlane: kubeadm init
  controlPlane->>apiServer: Start static control-plane Pods
  operator->>cni: Install CNI manifest
  cni->>apiServer: Establish Pod networking
  operator->>workers: kubeadm join with token and CA hash
  workers->>apiServer: Register nodes and start kubelet
  operator->>apiServer: kubectl get nodes
  apiServer-->>operator: Control plane and workers Ready
```

*Figure 28.1: kubeadm bootstrap establishes the control plane before networking and worker joins make the cluster ready.*

### In production

**Ownership:** Platform owns bootstrap automation and checklist; record versions (Kubernetes 1.36 baseline here).

**Failure mode:** Partial bootstrap → NotReady nodes. Detect with node conditions and core pods. Mitigate with idempotent bootstrap scripts and smoke tests.

| Do | Don't |
|----|-------|
| CNI before app workloads | Skip version pinning on container runtime |
| Smoke test DNS and a Deployment | Hand-join without join-token hygiene |

**Before you leave this section**

- **Understand:** Bootstrap order: control plane → CNI → workers → smoke tests.
- **Try:** Sketch your bootstrap checklist with version pins.
- **Watch in prod:** Clusters left without CNI or with expired join tokens.


---

## 28.4 High-availability topologies

### In plain terms

One control-plane node is a single brain. If city hall burns down, the workers keep running existing Pods for a while, but you cannot schedule, scale, or recover cleanly. HA means **multiple brains behind one address**, with etcd quorum so the deed registry stays consistent.

Stacked vs external etcd, load-balanced API servers, odd etcd member counts. You might think two etcd members are “HA”—quorum math disagrees.

> ⚠️ **Common Pitfall:** Even-sized etcd clusters that cannot form quorum cleanly.

### Under the hood

Two common kubeadm patterns:

| Topology | etcd location | Pros | Cons |
|----------|---------------|------|------|
| **Stacked** | etcd co-located on each control-plane node | Simpler; fewer machines | Control-plane load and etcd share fate |
| **External etcd** | Separate etcd nodes | Independent scaling and failure domains | More hosts and operational surface |

Both need a **load-balanced or VIP `controlPlaneEndpoint`** so clients and kubelets talk to one stable name.

```mermaid
flowchart TB
  clients["kubectl and kubelets"] --> endpoint["Load balancer or VIP"]
  endpoint --> cpOne["Control plane 1"]
  endpoint --> cpTwo["Control plane 2"]
  endpoint --> cpThree["Control plane 3"]
  subgraph stackedTopology["Stacked topology"]
    cpOne --> stackedEtcdOne["Local etcd 1"]
    cpTwo --> stackedEtcdTwo["Local etcd 2"]
    cpThree --> stackedEtcdThree["Local etcd 3"]
  end
  subgraph externalTopology["External-etcd topology"]
    cpOne --> externalEtcd["Dedicated etcd quorum"]
    cpTwo --> externalEtcd
    cpThree --> externalEtcd
  end
```

*Figure 28.2: Stacked HA co-locates an etcd member with each control plane, whereas external-etcd HA separates the quorum onto dedicated hosts.*

```text
                    ┌─────────────────────┐
   kubectl /        │  LB / VIP :6443     │
   kubelets  ──────►│  k8s-api.example.com│
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
      ┌─────────┐         ┌─────────┐         ┌─────────┐
      │  cp-1   │         │  cp-2   │         │  cp-3   │
      │ apiserver│         │ apiserver│         │ apiserver│
      │ etcd (*)│         │ etcd (*)│         │ etcd (*)│
      └─────────┘         └─────────┘         └─────────┘
        (*) stacked topology — external etcd would sit on dedicated hosts
```

Join an additional control-plane member (certificate key from `--upload-certs` or `kubeadm init phase upload-certs`):

```bash
$ sudo kubeadm join k8s-api.example.com:6443 \
    --token <token> \
    --discovery-token-ca-cert-hash sha256:<hash> \
    --control-plane \
    --certificate-key <certificate-key>
```

Odd numbers for etcd members (3 or 5). Quorum is `(n/2)+1`. Two of three members can keep the cluster writable; one of three cannot.

### In production

**Ownership:** Platform owns HA topology and LB for API server.

**Failure mode:** Lost quorum → API read-only/down. Detect with etcd health endpoints. Mitigate with 3/5 members in distinct failure domains.

| Do | Don't |
|----|-------|
| Odd etcd member count | Two-node “HA” etcd |
| LB + healthy API backends | Clients pinned to one API IP |

**Before you leave this section**

- **Understand:** HA topology follows quorum and failure domains.
- **Try:** Diagram your API LB and etcd members.
- **Watch in prod:** Quorum loss from co-located etcd members.


---

## 28.5 PKI and certificates

### In plain terms

Every serious conversation in the cluster is authenticated with certificates: apiserver identity, kubelet identity, etcd peer trust, and admin clients. kubeadm generates a small private PKI under `/etc/kubernetes/pki`. If certificates expire, the city still has buildings—but nobody can prove who they are at the gate.

kubeadm PKI trusts the cluster. Expiry takes APIs down. You might think cloud-managed certs mean you can ignore kubeadm certs—on kubeadm clusters you own rotation.

> ⚠️ **Common Pitfall:** Discovering cert expiry only when kubectl starts failing.

### Under the hood

Important paths on a control-plane node:

| Path | Purpose |
|------|---------|
| `/etc/kubernetes/pki/ca.crt` / `ca.key` | Cluster CA |
| `/etc/kubernetes/pki/apiserver.crt` | API server serving cert |
| `/etc/kubernetes/pki/etcd/` | etcd server and peer certs |
| `/etc/kubernetes/pki/front-proxy-ca.crt` | Aggregated API front-proxy CA |
| `/etc/kubernetes/admin.conf` | Admin kubeconfig (client cert) |
| `/etc/kubernetes/kubelet.conf` | Kubelet kubeconfig |

Inspect expiry:

```bash
$ sudo kubeadm certs check-expiration
CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED
admin.conf                 Jul 25, 2027 18:00 UTC   364d            ca                      no
apiserver                  Jul 25, 2027 18:00 UTC   364d            ca                      no
apiserver-etcd-client      Jul 25, 2027 18:00 UTC   364d            etcd-ca                 no
apiserver-kubelet-client   Jul 25, 2027 18:00 UTC   364d            ca                      no
controller-manager.conf    Jul 25, 2027 18:00 UTC   364d            ca                      no
etcd-healthcheck-client    Jul 25, 2027 18:00 UTC   364d            etcd-ca                 no
etcd-peer                  Jul 25, 2027 18:00 UTC   364d            etcd-ca                 no
etcd-server                Jul 25, 2027 18:00 UTC   364d            etcd-ca                 no
front-proxy-client         Jul 25, 2027 18:00 UTC   364d            front-proxy-ca          no
scheduler.conf             Jul 25, 2027 18:00 UTC   364d            ca                      no

CERTIFICATE AUTHORITY   EXPIRES                  RESIDUAL TIME   EXTERNALLY MANAGED
ca                      Jul 23, 2036 18:00 UTC   10y             no
etcd-ca                 Jul 23, 2036 18:00 UTC   10y             no
front-proxy-ca          Jul 23, 2036 18:00 UTC   10y             no
```

Renew all managed certificates (typically during maintenance; restart static Pods / kubelet as required):

```bash
$ sudo kubeadm certs renew all
$ sudo systemctl restart kubelet
```

kubeadm also renews certificates automatically during `kubeadm upgrade apply` when needed. Default kubeadm-issued leaf certificates last **one year**; CAs last longer.

`controlPlaneEndpoint` and extra SANs belong in the ClusterConfiguration so the apiserver certificate lists every name clients use:

```yaml
apiServer:
  certSANs:
    - "k8s-api.example.com"
    - "k8s-api-internal.example.com"
    - "192.168.10.10"
```

### In production

**Ownership:** Platform owns cert rotation schedule (`kubeadm certs check-expiration`).

**Failure mode:** Expired certs → auth failures cluster-wide. Detect with expiry monitors >30 days. Mitigate with scheduled rotation and calendar reminders.

| Do | Don't |
|----|-------|
| Monitor cert expiry | Manual copy of pki without backup |
| Rotate before expiry | Disable TLS to “fix” prod |

**Before you leave this section**

- **Understand:** PKI expiry is a predictable outage—monitor and rotate.
- **Try:** Run cert expiration check in a lab kubeadm cluster.
- **Watch in prod:** Silent certs nearing expiry.


---

## 28.6 Upgrades with kubeadm

### In plain terms

Upgrading is changing the city’s operating system one floor at a time: first the control plane, then each worker, never skipping a minor version. Kubernetes supports an **N−3** minor window for kubelet skew relative to the apiserver in modern releases; for cluster upgrades you still move **one minor at a time** (1.34 → 1.35 → 1.36).

Plan → control plane → nodes, respecting skew. Drain workers with PDBs. You might think `kubectl` upgrade alone upgrades nodes—kubeadm node workflow matters.

> ⚠️ **Common Pitfall:** Upgrading kubelet past supported skew relative to API server.

### Under the hood

High-level sequence for a minor upgrade to 1.36:

1. Read the release notes and deprecated API list for each hop.
2. Backup etcd (section 28.8).
3. Upgrade **kubeadm** on a control-plane node.
4. `kubeadm upgrade plan` then `kubeadm upgrade apply`.
5. Upgrade kubelet and kubectl on that node; restart kubelet.
6. Repeat for other control-plane nodes with `kubeadm upgrade node`.
7. Drain, upgrade, and uncordon each worker.

```bash
# On first control-plane node — packages shown schematically
$ sudo apt-mark unhold kubeadm && sudo apt-get install -y kubeadm=1.36.0-* && sudo apt-mark hold kubeadm

$ sudo kubeadm upgrade plan
Components that must be upgraded:
COMPONENT         CURRENT   TARGET
kube-apiserver    v1.35.x   v1.36.0
kube-controller-manager v1.35.x v1.36.0
kube-scheduler    v1.35.x   v1.36.0
kube-proxy        v1.35.x   v1.36.0
CoreDNS           v1.x.x    v1.x.y
etcd              3.5.x     3.5.y

$ sudo kubeadm upgrade apply v1.36.0
[upgrade/successful] SUCCESS! Your cluster was upgraded to "v1.36.0". Enjoy!

$ sudo apt-mark unhold kubelet kubectl
$ sudo apt-get install -y kubelet=1.36.0-* kubectl=1.36.0-*
$ sudo apt-mark hold kubelet kubectl
$ sudo systemctl daemon-reload && sudo systemctl restart kubelet
```

Additional control-plane or worker:

```bash
$ sudo kubeadm upgrade node
# then upgrade kubelet/kubectl packages and restart kubelet
```

Worker drain pattern (next section) wraps the kubelet bump.

```mermaid
flowchart LR
  review["Review release notes and API removals"] --> backup["Back up etcd"]
  backup --> plan["Upgrade kubeadm and run upgrade plan"]
  plan --> firstControlPlane["Apply first control-plane upgrade"]
  firstControlPlane --> otherControlPlanes["Upgrade remaining control planes"]
  otherControlPlanes --> drainWorker["Cordon and drain one worker"]
  drainWorker --> upgradeWorker["Upgrade kubeadm, kubelet, and kubectl"]
  upgradeWorker --> verifyWorker{"Node and workloads healthy?"}
  verifyWorker -->|Yes| moreWorkers{"More workers?"}
  moreWorkers -->|Yes| drainWorker
  moreWorkers -->|No| finalChecks["Run cluster and workload checks"]
  verifyWorker -->|No| stop["Stop rollout and recover"]
```

*Figure 28.3: A kubeadm minor upgrade proceeds through backup, control planes, and one drained worker at a time with health gates.*

### In production

**Ownership:** Platform owns kubeadm upgrade runbooks; rehearse on staging clones.

**Failure mode:** Skew violation → unsupported weirdness. Detect with version matrix dashboards. Mitigate with waved upgrades and pauses.

| Do | Don't |
|----|-------|
| Follow skew policy (1.33–1.36 window) | Skip staging upgrade rehearsal |
| Drain with PDB | Upgrade kubelet before API server carelessly |

**Before you leave this section**

- **Understand:** kubeadm upgrades are waved and skew-aware.
- **Try:** Read the upgrade plan output on a lab cluster.
- **Watch in prod:** Skew violations after partial upgrades.


---

## 28.7 Node lifecycle: cordon, drain, and retirement

### In plain terms

Before you reboot or replace a node, tell the scheduler to stop placing new Pods there (**cordon**), then politely evict workloads (**drain**) so replicas move elsewhere. Skipping drain is like demolishing a building while people are still inside.

Cordon/drain/retire nodes safely—same SOP as Chapter 20/24. You might think deleting a VM in the cloud console is equivalent—volumes and PDBs disagree.

> ⚠️ **Common Pitfall:** Force-deleting pods to speed drain during production upgrades.

### Under the hood

```bash
$ kubectl cordon wk-1
node/wk-1 cordoned

$ kubectl get node wk-1
NAME   STATUS                     ROLES    AGE   VERSION
wk-1   Ready,SchedulingDisabled   <none>   40d   v1.36.0

$ kubectl drain wk-1 \
    --ignore-daemonsets \
    --delete-emptydir-data \
    --grace-period=60
node/wk-1 already cordoned
evicting pod tasks/task-api-7d9c4f6b8-abcd1
pod/task-api-7d9c4f6b8-abcd1 evicted
node/wk-1 drained
```

| Action | Effect |
|--------|--------|
| `cordon` | Marks `SchedulingDisabled`; existing Pods keep running |
| `drain` | Cordons (if needed) and evicts Pods respecting PDBs |
| `uncordon` | Allows scheduling again after maintenance |
| `delete node` | Removes the Node object after the host is gone |

DaemonSets are not drained by default in a useful way for node agents—you ignore them so kube-proxy and CNI agents are not treated like app replicas. EmptyDir data is lost on eviction unless you opt into deletion explicitly (as above) after accepting the data loss.

```bash
# After OS patch / kubelet upgrade
$ kubectl uncordon wk-1
node/wk-1 uncordoned
```

Retiring a node forever:

```bash
$ kubectl drain wk-1 --ignore-daemonsets --delete-emptydir-data
$ sudo kubeadm reset -f   # on the node, if it was kubeadm-joined
$ kubectl delete node wk-1
```

For control-plane members, also remove the etcd member before or as you decommission, and ensure remaining members keep quorum.

### In production

**Ownership:** Platform owns node retirement automation; respect PDBs.

**Failure mode:** Unsafe retirement → multi-service outage. Detect with error budget during maintenance. Mitigate with capacity and one-domain-at-a-time drains.

| Do | Don't |
|----|-------|
| Cordon → drain → delete | Console-terminate without drain |
| Verify replacements Ready | Drain all zones at once |

**Before you leave this section**

- **Understand:** Node retirement uses drain+PDB discipline.
- **Try:** Retire a lab worker with cordon/drain.
- **Watch in prod:** Console deletions skipping drain.

> 🏭 **Production floor:** On kubeadm fleets, **drain + PDB** before every node upgrade/retire. Ticket must show PDB status, drain transcript, and post-join kubelet version.


---

## 28.8 etcd operations

### In plain terms

etcd is the deed registry and minute book for the entire cluster. Back it up on a schedule. Practice restore on a sacrificial cluster. Everything else in Kubernetes can be redeployed; etcd contents usually cannot be reinvented from memory.

Backup, restore, defrag, and member replace are control-plane surgery. Practice on copies. You might think disk snapshots alone equal etcd backup—verify consistency and encryption keys.

> ⚠️ **Common Pitfall:** Running defrag on all members simultaneously.

### Under the hood

On stacked kubeadm clusters, etcd often runs as a static Pod (`etcd-cp-1` in `kube-system`). Talk to it with `etcdctl` using the PKI under `/etc/kubernetes/pki/etcd/`.

**Snapshot backup:**

```bash
$ sudo ETCDCTL_API=3 etcdctl \
    --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key \
    snapshot save /var/backups/etcd/etcd-$(date +%F).db

$ sudo ETCDCTL_API=3 etcdctl snapshot status /var/backups/etcd/etcd-2026-07-25.db -w table
+----------+----------+------------+------------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
+----------+----------+------------+------------+
| a1b2c3d4 |  184291  |       3120 |      25 MB |
+----------+----------+------------+------------+
```

**Member health:**

```bash
$ sudo ETCDCTL_API=3 etcdctl \
    --endpoints=https://192.168.10.11:2379,https://192.168.10.12:2379,https://192.168.10.13:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key \
    endpoint health
```

**Restore** (disaster recovery outline—practice offline):

1. Stop API servers / etcd on affected nodes as documented for your topology.
2. `etcdctl snapshot restore` into a fresh data directory with correct `--initial-cluster` naming.
3. Point etcd static manifests at the restored data path.
4. Bring members back and verify `kubectl get nodes` and object counts.

Encrypted secrets at rest, large clusters, and defrag (`etcdctl defrag`) are advanced ops—schedule defrag after evaluating fragmentation; never defrag casually during peak write load without a plan.

### In production

**Ownership:** Platform owns etcd ops with two-person change control for restore.

**Failure mode:** Bad restore → history loss. Detect with restore drill metrics. Mitigate with object-lock backups and documented member-replace SOP.

| Do | Don't |
|----|-------|
| Tested backup/restore | Defrag all members at once |
| Quorum-aware member replace | etcdctl from untrusted networks |

**Before you leave this section**

- **Understand:** etcd ops require rehearsed backup/restore and quorum care.
- **Try:** Perform a backup in lab and restore to a scratch member set.
- **Watch in prod:** Untested backups; simultaneous defrag.

> 🏭 **Production floor:** **etcd backup tested restores**—schedule drills, record RTO, never declare DR ready on backup job green alone.


---

## 28.9 Common pitfalls

> ⚠️ **Common Pitfall:** Forgetting the CNI after `kubeadm init` and debugging “DNS is broken” for an hour. Check `kubectl get pods -n kube-system` first.

> ⚠️ **Common Pitfall:** Mixing package versions—kubeadm 1.36 with kubelet 1.34 left behind on half the nodes.

> ⚠️ **Common Pitfall:** Taking an etcd snapshot from one member while another is lagging, then restoring without understanding membership IDs. Practice the exact restore runbook.

> ⚠️ **Common Pitfall:** Using `kubeadm reset` on a healthy HA member without removing it from the etcd cluster first, leaving a zombie peer.

> ⚠️ **Common Pitfall:** Assuming managed Kubernetes “has no certificates.” It does—you just do not renew them by hand. Node drains and upgrade discipline still apply.

---

## 28.10 Hands-on exercises

1. On a lab of three VMs, run `kubeadm init` with a DNS `controlPlaneEndpoint`, install a CNI, and join two workers. Save the join command output in your notes.
2. Run `kubeadm certs check-expiration` and identify which certificates would expire first. Draft an alert threshold you would use in production.
3. Cordon and drain a worker while a Deployment with three replicas and a PDB (`minAvailable: 2`) is running. Observe eviction behavior; then uncordon.
4. Take an etcd snapshot, record the revision from `snapshot status`, and store the file off the control-plane node.
5. (Stretch) Add a second control-plane member with `kubeadm join --control-plane`. Kill the first apiserver process (or stop the VM) and confirm kubectl still works through the shared endpoint.

---

## 28.11 Check Your Understanding

**Q1.** Why should you set `controlPlaneEndpoint` even if you start with a single control-plane node?

<details>
<summary>Show answer</summary>

So API clients and certificates already trust a stable VIP or DNS name. When you add HA later, you do not have to reissue certificates or rewrite every kubeconfig to a new address.
</details>

**Q2.** What is the difference between cordon and drain?

<details>
<summary>Show answer</summary>

Cordon only marks the node unschedulable. Drain cordons (if needed) and evicts workloads so they can reschedule elsewhere, respecting PodDisruptionBudgets for voluntary disruptions.
</details>

**Q3.** Why do etcd clusters usually have 3 or 5 members?

<details>
<summary>Show answer</summary>

etcd needs quorum (`(n/2)+1`) to accept writes. Odd counts maximize fault tolerance for a given size; two members cannot survive one failure and still keep quorum.
</details>

**Q4.** Can you upgrade a kubeadm cluster directly from 1.34 to 1.36?

<details>
<summary>Show answer</summary>

No. Upgrade one minor version at a time (1.34 → 1.35 → 1.36), following `kubeadm upgrade plan` and release notes for each hop.
</details>

**Q5.** Where does kubeadm place the cluster CA by default?

<details>
<summary>Show answer</summary>

Under `/etc/kubernetes/pki/` on control-plane nodes (`ca.crt` and `ca.key`), with related kubeconfigs under `/etc/kubernetes/*.conf`.
</details>

---

## 28.12 Key takeaways

- **kubeadm** bootstraps and upgrades conformant clusters; you still own OS, runtime, CNI, and load balancing.
- Design **HA early** with a shared `controlPlaneEndpoint` and odd-sized etcd quorum (stacked or external).
- Treat **PKI expiry** as a first-class operational signal; renew before outages.
- Upgrade **one minor at a time**; backup etcd before you start.
- **Cordon → drain → maintain → uncordon** is the safe node lifecycle.
- **etcd snapshots** you have practiced restoring are the difference between an incident and a company-wide outage.

---

## 28.13 Official documentation map

| Topic | Official page |
|-------|---------------|
| kubeadm overview | [Installing Kubernetes with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/) |
| Creating a cluster | [Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/) |
| HA setup | [Creating highly available clusters with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/) |
| Certificate management | [Certificate Management with kubeadm](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/) |
| Upgrading kubeadm clusters | [Upgrading kubeadm clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/) |
| Safely drain a node | [Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/) |
| Operating etcd | [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) |
| Backing up etcd | [Backing up an etcd cluster](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/#backing-up-an-etcd-cluster) |
| Version skew policy | [Version Skew Policy](https://kubernetes.io/docs/releases/version-skew-policy/) |

**Previous:** [Chapter 27 — Docker Engine Operations](27-docker-engine-operations.md) | **Next:** [Chapter 29 — Extending Kubernetes](29-extending-kubernetes.md)
