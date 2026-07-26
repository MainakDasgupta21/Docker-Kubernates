# Chapter 19 — Networking — CNI and Policies

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain what a CNI plugin does and how Pods get IP addresses
> - Compare Calico, Flannel, Cilium, and common managed CNIs at a practical level
> - Trace a packet from a Pod on one node to a Pod on another
> - Describe how CoreDNS resolves Service and Pod names
> - Write NetworkPolicies, including a default-deny baseline with DNS egress
> - Cross-reference dual-stack IPv4/IPv6 Service behavior with Chapters 15 and 32
> - Debug common “why can’t these Pods talk?” failures

---

## 19.1 The city street grid

Think of your cluster as a city. Every Pod is a building with its own street address (IP). Nodes are neighborhoods. Without a city planning department, buildings would have conflicting addresses and no roads between neighborhoods.

The **Container Network Interface (CNI)** is that planning department: it assigns Pod IPs, wires virtual interfaces, and ensures packets can leave one node and arrive at another. **Services** ([Chapter 15](15-k8s-services.md)) give stable names on top of those changing IPs. **NetworkPolicies** are the zoning laws—who is allowed to call whom.

By default, Kubernetes assumes a flat, reachable Pod network: any Pod can talk to any other Pod unless you deliberately restrict it. That openness is great for getting started and dangerous for production multi-tenant clusters.

---

## 19.2 What CNI provides

### In plain terms

When the kubelet creates a Pod, it does not invent networking itself. It calls the configured CNI plugin: “Give this Pod an address and a working network interface.” Without a healthy CNI, Pods sit in `ContainerCreating` with network setup errors—like buildings with no street numbers and no curb cuts.

### Under the hood

A typical CNI hook sequence:

1. Allocate an IP from the Pod CIDR (IPAM)
2. Create a network interface inside the Pod’s network namespace
3. Connect that interface to the node datapath (bridge, veth pair, eBPF programs, and so on)
4. Install routes (or tunnel endpoints) so other nodes can reach this Pod

```bash
$ kubectl get pods -n kube-system -o wide
NAME                                       READY   STATUS    IP            NODE
coredns-7db6d8ff4d-xk2m9                   1/1     Running   10.244.0.11   worker-1
calico-node-abc12                          1/1     Running   192.168.1.21  worker-1
calico-kube-controllers-5f6d7c8d9b-hj4lp   1/1     Running   10.244.0.8    worker-2
```

Exact DaemonSet names depend on the plugin. Managed clouds often ship Amazon VPC CNI, Azure CNI, GKE Dataplane V2 (Cilium-based), and similar—the mental model still applies.

Inspect node Pod CIDRs:

```bash
$ kubectl get nodes -o custom-columns=NAME:.metadata.name,PODCIDR:.spec.podCIDR
NAME       PODCIDR
worker-1   10.244.1.0/24
worker-2   10.244.2.0/24
```

### In production

1. Treat CNI DaemonSets as critical infrastructure—alert on CrashLoopBackOff and NotReady nodes.
2. Document Pod and Service CIDRs; overlapping ranges with on-prem or VPC networks break routing.
3. Upgrade CNI with the same care as Kubernetes itself; dataplane regressions are cluster-wide outages.
4. Verify NetworkPolicy support before relying on YAML isolation.

---

## 19.3 Popular CNI plugins compared

### In plain terms

You usually pick **one** primary CNI per cluster. Flannel is the simple overlay for labs. Calico emphasizes routing and mature policy. Cilium bets on eBPF for performance, identity-aware policy, and observability. Managed providers often choose for you—know what you inherited.

### Under the hood

| Plugin | Style | Strengths | Notes |
|--------|-------|-----------|-------|
| **Flannel** | Simple overlay (often VXLAN) | Easy to understand; great for labs | Limited NetworkPolicy unless paired with something else |
| **Calico** | Routing and/or overlay; strong policy | Mature NetworkPolicy; flexible IPAM | Very common in production |
| **Cilium** | eBPF-based datapath | High performance; identity-aware policy; Hubble observability | Modern default on some platforms |
| **Amazon VPC CNI** | Pods as VPC ENI/IPs | Native AWS networking | IP density and subnet planning matter |
| **Azure CNI / GKE variants** | Cloud-native wiring | Integrates with cloud networking and policy | Follow provider docs for dual-stack and policy |

> 💡 **Tip:** For learning NetworkPolicy behavior, Calico or Cilium are clearer than Flannel alone, because policy enforcement is a first-class feature.

<!-- VISUAL: Flannel VXLAN overlay vs Calico BGP/routes + policy shield vs Cilium eBPF datapath -->

### In production

1. Do not run two competing full CNIs “to be safe”—pick one dataplane.
2. Measure MTU and encapsulation overhead; overlays can surprise latency-sensitive apps.
3. Align NetworkPolicy CRDs and CNI version; applying policies that nobody enforces creates false confidence.
4. For multi-cluster or service mesh, confirm how the mesh dataplane interacts with CNI policy (order of enforcement).

---

## 19.4 Cross-node packet flow

### In plain terms

Pod A on Node 1 calling Pod B on Node 2 is like a letter leaving one neighborhood, riding the city’s trunk roads (the underlay), and being delivered to another neighborhood. The CNI either **encapsulates** that letter in a tunnel (overlay) or **advertises routes** so the underlay can deliver it directly.

### Under the hood

Suppose Pod A (`10.244.1.10`) calls Pod B (`10.244.2.20:8000`).

Simplified VXLAN-style path:

1. App in Pod A sends a TCP packet to `10.244.2.20:8000`
2. Packet leaves Pod A’s eth0 via a veth pair into the node’s networking
3. Node 1’s CNI decides Node 2 owns that Pod CIDR
4. Packet is encapsulated and sent over the underlay to Node 2
5. Node 2 decapsulates and delivers to Pod B
6. Return traffic reverses the path

With route-based Calico (no overlay), nodes advertise Pod CIDRs via BGP; packets route directly when the underlay allows it.

```text
Pod A (Node 1) → veth/CNI → [overlay or route] → CNI/veth → Pod B (Node 2)
```

Services add another hop: clients often target a ClusterIP; **kube-proxy** (iptables, IPVS, or an eBPF replacement) DNAT/load-balances to an EndpointSlice IP. From there, the path is again Pod-to-Pod networking. See [Chapter 15](15-k8s-services.md) for Service types and EndpointSlices.

<!-- VISUAL: Sequence of Pod-to-Pod cross-node flow with encapsulation box between nodes -->

### In production

1. When debugging, separate “DNS failed,” “NetworkPolicy denied,” and “CNI/routing broken.”
2. Packet capture on nodes (tcpdump/cilium monitor) beats guessing.
3. Watch for asymmetric routes after VPC peering or firewall rule changes.

---

## 19.5 Cluster DNS (CoreDNS)

### In plain terms

CoreDNS is the cluster phone book. Pods ask it for `task-api` and get the Service ClusterIP. Applications should call **Services by DNS name**, not Pod IPs—those change on every reschedule.

### Under the hood

CoreDNS runs as a Deployment in `kube-system` and backs the cluster DNS Service (often still labeled `kube-dns`). Pods receive nameserver and search domains from the kubelet.

| Query | Resolves to |
|-------|-------------|
| `task-api` | Service `task-api` in the Pod’s namespace |
| `task-api.payments` | Service in namespace `payments` |
| `task-api.payments.svc.cluster.local` | Fully qualified Service name |
| `10-244-1-10.default.pod.cluster.local` | Pod DNS (when enabled) |

```bash
$ kubectl run dns-test --rm -it --image=busybox:1.36 --restart=Never -- \
    nslookup task-api.default.svc.cluster.local
Server:		10.96.0.10
Address:	10.96.0.10:53

Name:	task-api.default.svc.cluster.local
Address: 10.96.120.45
```

> ⚠️ **Common Pitfall:** Calling `localhost` from one Pod expecting to reach another Pod. `localhost` is always *this* network namespace. Use the Service DNS name.

### In production

1. Alert on CoreDNS latency and error rates—DNS failure looks like “the whole mesh is down.”
2. Size CoreDNS replicas for peak QPS; autoscale if your platform supports it.
3. Prefer short names inside a namespace; use FQDNs across namespaces to avoid search-path surprises.

---

## 19.6 Dual-stack networking (cross-reference)

### In plain terms

**Dual-stack** means Pods and Services can use both IPv4 and IPv6. Think of every building getting both a street number and a new postal code system at once. Clients may dial either family; Services can expose one or both.

### Under the hood

Kubernetes dual-stack touches:

- Cluster and Pod CIDRs for both families
- Service `spec.ipFamilyPolicy` and `spec.ipFamilies`
- CNI and cloud networking support for IPv6 routes and load balancers

Example Service (details expanded in [Chapter 15](15-k8s-services.md); production dual-stack design and migration appear in [Chapter 32](32-advanced-networking-traffic.md)):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: task-api
spec:
  ipFamilyPolicy: PreferDualStack
  ipFamilies:
    - IPv4
    - IPv6
  selector:
    app: task-api
  ports:
    - name: http
      port: 80
      targetPort: 8000
```

```bash
$ kubectl get svc task-api -o wide
NAME       TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   IP-FAMILIES
task-api   ClusterIP   10.96.120.45   <none>        80/TCP    IPv4,IPv6
```

NetworkPolicies can reference IPv4 and IPv6 CIDRs in `ipBlock` peers. Default-deny still applies per selected Pod; dual-stack does not weaken policy—it doubles the address families you must allow intentionally.

### In production

1. Do not enable dual-stack casually on a live cluster; plan CIDRs, CNI, and cloud LB support first (Chapter 32).
2. Test NetworkPolicies for both families—an IPv4-only allow list will surprise IPv6 clients.
3. Keep Services’ `ipFamilyPolicy` consistent with how clients actually connect.

---

## 19.7 NetworkPolicy fundamentals

### In plain terms

A **NetworkPolicy** selects Pods and lists who may talk to them (ingress) and whom they may call (egress). Once any policy selects a Pod in a direction, traffic not explicitly allowed in that direction is denied. Policies are additive allow-lists, not competing deny engines.

### Under the hood

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
```

Important ideas:

- Policies select **Pods**, not Services (match the same labels Services use)
- **Ingress** rules control traffic *to* selected Pods
- **Egress** rules control traffic *from* selected Pods
- Peers can be pod selectors, namespace selectors, or IP blocks
- Ports are optional but recommended for least privilege

> 📘 **Deep Dive (optional):** NetworkPolicy implementation is delegated to the CNI. If your plugin does not enforce policy, applying YAML does nothing useful. Verify enforcement.

### In production

1. Start in non-prod with default-deny plus explicit allows; promote only after traffic maps exist.
2. Label namespaces consistently (`kubernetes.io/metadata.name` is auto-applied on modern clusters).
3. Pair with RBAC and PSA ([Chapter 21](21-rbac-and-security.md))—policy is one layer, not the whole castle.

---

## 19.8 Default deny and least-privilege allows

### In plain terms

Lock every door, then hand out specific keys: DNS, frontend to API, monitoring scrapes. Forgetting DNS is the classic foot-gun—apps fail with “name resolution” errors that look like application bugs.

### Under the hood

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: tasks
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Allow DNS to CoreDNS:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: tasks
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

Allow frontend to Task API:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-task-api
  namespace: tasks
spec:
  podSelector:
    matchLabels:
      app: task-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8000
```

Cross-namespace ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-from-monitoring
  namespace: tasks
spec:
  podSelector:
    matchLabels:
      app: task-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              purpose: monitoring
          podSelector:
            matchLabels:
              app: prometheus
      ports:
        - protocol: TCP
          port: 8000
```

```bash
$ kubectl label namespace monitoring purpose=monitoring --overwrite
$ kubectl apply -f default-deny.yaml -f allow-dns.yaml -f allow-frontend-to-api.yaml
$ kubectl get networkpolicy -n tasks
```

Egress to the internet (tighten CIDRs when you can):

```yaml
egress:
  - to:
      - ipBlock:
          cidr: 0.0.0.0/0
          except:
            - 10.0.0.0/8
    ports:
      - protocol: TCP
        port: 443
```

For dual-stack clusters, add matching IPv6 `ipBlock` entries when intentional egress on IPv6 is required.

<!-- VISUAL: Namespace with default-deny wall; frontend→task-api and DNS allowed; other arrows blocked -->

### In production

1. Maintain a traffic matrix per namespace; generate policies from it when possible.
2. Use staging to catch missing allows before production cutovers.
3. Prefer named ports in apps and policies for clarity.

---

## 19.9 Debugging connectivity

Checklist when Pods cannot talk:

1. Do both Pods have IPs? (`kubectl get pods -o wide`)
2. Does DNS resolve?
3. Does a NetworkPolicy select one of them?
4. Are labels exact matches?
5. Is the CNI healthy?
6. For Services: do EndpointSlices list ready Pods?

```bash
$ kubectl get endpointslices -l kubernetes.io/service-name=task-api
$ kubectl describe networkpolicy allow-frontend-to-task-api -n tasks
$ kubectl get pods -n kube-system -l k8s-app=calico-node
```

> ⚠️ **Common Pitfall:** Creating a default-deny egress policy and forgetting DNS.

---

## 19.10 Common pitfalls

> ⚠️ **Common Pitfall:** Assuming NetworkPolicy YAML works on every CNI—Flannel alone often does not enforce it.

> ⚠️ **Common Pitfall:** Selecting Services in your head but labeling Pods differently—policies match Pod labels only.

> ⚠️ **Common Pitfall:** Overlapping Pod CIDRs with the corporate network after VPN or hybrid connect.

> ⚠️ **Common Pitfall:** Enabling dual-stack Services without dual-stack CNI and firewall rules.

---

## 19.11 Hands-on exercises

1. **Map the CNI.** Identify which CNI your cluster runs and whether NetworkPolicy is enforced.
2. **DNS check.** From a debug Pod, resolve a Service FQDN and confirm it matches the ClusterIP.
3. **Baseline deny.** In a scratch namespace, deploy two labeled Pods. Apply default-deny. Verify they cannot connect.
4. **Selective allow.** Allow TCP from `app=a` to `app=b` on a chosen port. Verify only that path works.
5. **DNS egress.** With default-deny including egress, add DNS allow and confirm `nslookup` works again.

---

## 19.12 Check Your Understanding

**Q1.** Does Kubernetes itself implement Pod-to-Pod networking?

<details>
<summary>Show answer</summary>

**No.** Networking is provided by a CNI plugin installed in the cluster (or by the managed platform’s CNI).

</details>

**Q2.** Why might Flannel alone be insufficient for production multi-tenant isolation?

<details>
<summary>Show answer</summary>

Flannel focuses on connectivity. Rich NetworkPolicy enforcement typically needs Calico, Cilium, or a Flannel-plus-policy companion.

</details>

**Q3.** After any NetworkPolicy selects a Pod, what happens to unspecified ingress traffic?

<details>
<summary>Show answer</summary>

Unspecified ingress is **denied** for that Pod in the ingress direction. The selecting policies define the allow-list.

</details>

**Q4.** Why does default-deny egress often break DNS?

<details>
<summary>Show answer</summary>

CoreDNS is reached over the network. Without an egress allow to DNS (UDP/TCP 53), name resolution fails.

</details>

**Q5.** Where should you go next for dual-stack Service fields versus deep dual-stack design?

<details>
<summary>Show answer</summary>

Service `ipFamilyPolicy` / `ipFamilies` basics live in [Chapter 15](15-k8s-services.md). Production dual-stack design and migration are covered in [Chapter 32](32-advanced-networking-traffic.md).

</details>

---

## 19.13 Key takeaways

- CNI plugins assign Pod IPs and implement cross-node connectivity; monitor them as critical infrastructure.
- Calico, Flannel, Cilium, and cloud CNIs trade simplicity, policy, and observability differently.
- CoreDNS powers service discovery; apps should use Service names.
- NetworkPolicies are deny-by-exception once a Pod is selected—start from default-deny and open least-privilege paths, including DNS.
- Dual-stack multiplies address families; cross-check Chapters 15 and 32 before enabling it in production.

---

## 19.14 Official documentation map

| Topic | Official page |
|-------|---------------|
| Cluster networking | [Cluster Networking](https://kubernetes.io/docs/concepts/cluster-administration/networking/) |
| Network Policies | [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) |
| DNS for Services and Pods | [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) |
| Dual-stack | [IPv4/IPv6 Dual-Stack](https://kubernetes.io/docs/concepts/services-networking/dual-stack/) |
| Service | [Service](https://kubernetes.io/docs/concepts/services-networking/service/) |
| CNI specification | [CNI](https://www.cni.dev/) |

**Previous:** [Chapter 18 — Kubernetes Storage](18-k8s-storage.md) | **Next:** [Chapter 20 — Scheduling and Advanced Placement](20-scheduling-and-advanced-placement.md)
