# Chapter 06 — Docker Networking

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain how containers get network connectivity and why isolation is the default
> - Choose among the `bridge`, `host`, `none`, `overlay`, `macvlan`, and `ipvlan` drivers
> - Create user-defined networks and use Docker's embedded DNS for service discovery
> - Publish container ports with `-p` and `-P`, and explain what `EXPOSE` does not do
> - Replace legacy `--link` with user-defined networks

---

## 06.1 The apartment building

Imagine a large apartment building. Every apartment (container) has its own door, its own internal wiring, and its own private phone extension. Residents can call each other through the building's internal switchboard without dialing an outside line. If someone from the street wants apartment 4B, the front desk (the Docker host) must explicitly forward that call.

![Apartment building analogy for Docker networking isolation](assets/analogy-apartment-building.png)

*Figure 06.A: Each apartment (container) has private wiring; the front desk publishes only chosen doors.*

Docker networking works the same way:

- Each container gets its own **network namespace** — private interfaces, routes, and firewall rules.
- Containers on the same network can talk through Docker's virtual networks and DNS.
- The outside world reaches a container only if the host **publishes** a port.

Isolation is the default so one noisy or compromised container cannot see traffic that was never meant for it. You open exactly the doors you need.

---

## 06.2 What happens when a container starts

### In plain terms

Starting a container is like assigning a new apartment: Docker wires a private phone, plugs it into a floor switchboard (a network), and hands out an extension number (an IP). Until you ask the front desk to publish a port, outsiders cannot ring that apartment.

The problem this solves is *safe multi-tenancy on one machine*. You might run ten containers on a laptop or a hundred on a build server, and you do not want them all sharing one flat, promiscuous network where any process can sniff or spoof any other. So Docker gives each container its own **network namespace** — a private copy of the interfaces, routing table, and firewall rules — and then connects that namespace to a virtual switch. The container thinks it has a whole network stack to itself, because from the kernel's point of view it does.

> ⚠️ **Common Pitfall:** You might think a container's IP (say `172.17.0.2`) is something you can hand to a colleague or hard-code into config. It is not stable. That address is assigned from the bridge's subnet at start time and can change on the next `docker run`. Containers should find each other by **name** on a user-defined network (Section 06.6), never by scraped IP.

### Under the hood

When you run a container, Docker:

1. Creates a network namespace for it.
2. Attaches it to a network — by default, the built-in bridge named `bridge`.
3. Assigns a private IP from that network's subnet (for example, `172.17.0.2`).

Mechanically, the daemon creates a **veth pair** — a virtual Ethernet cable with two ends. One end lands inside the container's namespace as `eth0`; the other end plugs into the `docker0` bridge on the host. The bridge behaves like a small unmanaged switch: frames from one container reach the bridge, and the host's iptables/nftables rules decide what may leave via NAT. Outbound packets are source-NATed to the host's IP, which is why a container can reach the internet even though nothing on the internet can reach it back unprivileged.

```bash
$ docker network ls
NETWORK ID     NAME      DRIVER    SCOPE
9f3c2a1b4d5e   bridge    bridge    local
1a2b3c4d5e6f   host      host      local
7g8h9i0j1k2l   none      null      local
```

```bash
$ docker run -d --name web nginx:1.27
$ docker inspect web --format '{{.NetworkSettings.IPAddress}}'
172.17.0.2
```

```mermaid
flowchart TB
  subgraph host["Docker host"]
    eth0["eth0 / outward interface"]
    docker0["docker0 bridge"]
    eth0 --- docker0
    veth1["veth pair"] --- docker0
    veth2["veth pair"] --- docker0
    ctr1["Container A eth0"] --- veth1
    ctr2["Container B eth0"] --- veth2
  end
```

*Figure 06.1: On the default bridge, containers connect through veth pairs to `docker0`; outbound traffic NATs via the host.*

You can watch this happen. `docker inspect` shows the assigned address, and `ip addr` on the host lists the transient `veth…` interface that appears when the container starts and disappears when it stops:

```bash
$ docker inspect web --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}}{{end}}'
bridge=172.17.0.2
```

**What breaks if you ignore this:** a container that lands on the default `bridge` cannot resolve another container by name (the default bridge has no embedded DNS), so an app configured with `db` as its database host fails with a name-resolution error even though both containers are healthy and on the "same" bridge.

### In production

Know which network a workload lands on. Unintentional attachment to the default `bridge` is a common source of broken DNS and overly shared blast radius. Prefer explicit `--network` (or Compose networks) for every multi-container app.

**Who owns this:** the platform team owns the network topology (which named networks exist, their subnets, and their trust boundaries); the app team owns *which* network each service attaches to, declared in Compose or the run command. When those two drift — for example, a service silently defaulting to `bridge` because someone dropped the `--network` flag — you get an app that works in one environment and mysteriously cannot reach its database in another.

**Failure mode and detection:** the first signal is usually a connection-refused or DNS-resolution error in application logs, not a Docker error, because Docker did exactly what you asked. Confirm placement with `docker inspect <ctr> --format '{{json .NetworkSettings.Networks}}'` before assuming the app is broken. **Do** make the network explicit in every long-lived definition; **don't** rely on the default bridge for anything beyond a throwaway `docker run` at the keyboard.

**Before you leave this section**

- **Understand:** each container gets its own network namespace and a NATed private IP; that IP is not stable and is not a service address.
- **Try:** run a container, read its IP with `docker inspect`, stop and restart it, and confirm the address may change.
- **Watch in prod:** connection or DNS failures that trace back to a workload silently landing on the default `bridge` instead of its intended network.

---

## 06.3 Bridge, host, and none

### In plain terms

These three are the built-in, single-host drivers you meet on day one. They sit on a spectrum from "fully isolated" to "no isolation at all," and picking the wrong end of that spectrum is one of the most common early mistakes.

- **Bridge** — a private virtual switch on one machine; the usual default for apps that talk to each other and occasionally to the outside world via published ports.
- **Host** — the container shares the host's network stack: no private IP, no NAT, maximum speed, zero network isolation.
- **None** — only loopback; the container is deliberately unplugged.

Think of it as choosing how an apartment connects to the world. Bridge is the normal apartment with a private line through the building switchboard. Host is knocking down the wall between the apartment and the building's own phone system — fast and direct, but now the guest answers the landlord's phone. None is an apartment with the phone jack removed entirely.

> ⚠️ **Common Pitfall:** You might reach for `--network host` because "it's simpler — no port mapping to think about." That convenience is exactly the trap: you also inherit every port conflict on the host and lose the isolation boundary that makes containers safe to co-locate. Host networking is a deliberate performance/compatibility choice, not a shortcut around learning `-p`.

### Under the hood

**Bridge.** The `bridge` driver creates a Linux bridge (default: `docker0`). Containers on the same bridge reach each other by IP; outbound traffic is NATed through the host.

```bash
$ docker run -d --name web nginx:1.27
$ docker inspect web --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
172.17.0.2
```

**Host.**

```bash
$ docker run -d --network host --name fastweb nginx:1.27
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:80
200
```

There is no `-p` mapping: if the process listens on port 80, it is the host's port 80. Host networking is native on Linux. On Docker Desktop (macOS/Windows) it is supported in recent Desktop versions but runs through the Desktop Linux VM, so behavior can differ from bare-metal Linux.

**None.**

```bash
$ docker run --rm --network none alpine:3.20 ip addr
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
```

Useful for batch jobs that only touch local files, or for workloads where zero network access is a security requirement.

**What breaks if X:** if a host-networked container listens on port 80 and the host — or another host-networked container — already owns port 80, the second process fails to bind with `address already in use`. There is no NAT layer to remap it, because with host networking the container *is* using the host's real port. This is the failure that most surprises people migrating a `-p 80:80` service to `--network host`.

### In production

| Driver | Scope | Isolation | Typical use | Port publishing |
|--------|-------|-----------|-------------|-----------------|
| `bridge` | Single host | Yes (NAT) | Most single-host apps | Yes (`-p` / `-P`) |
| `host` | Single host | No | Latency-sensitive tools, host-facing daemons | No (shares host ports) |
| `none` | Single host | Total | Offline jobs, lockdown | Not applicable |

Prefer bridge plus published ports for ordinary services. Reserve host networking for measured need; document the lost isolation. Use `none` when the threat model says "this process must not talk to the network."

**Who owns this:** whoever approves the run configuration owns the isolation trade-off. Host networking should never be a silent default buried in a script — it is a security-relevant decision that belongs in a review, because a compromised host-networked container can reach loopback-bound services (databases, metrics endpoints, the Docker socket proxy) that the operator assumed were unreachable from containers.

**Failure mode and detection:** the classic host-networking incident is a port collision that only appears under scale-out (two replicas of the same host-networked service scheduled on one node). Detect it early by never assuming host ports are free; check with `ss -ltnp` on the host. **Do** keep latency-sensitive or interface-scanning tools (some monitoring agents, VPN clients) on host networking with an explicit note; **don't** put an internet-facing application there just to skip a `-p` flag.

> 🏭 **Production floor:** Host networking removes the container's network isolation entirely — one process now shares the host's ports, loopback, and interface list. Treat switching a service to `--network host` as a change-managed decision: record *why*, confirm no port collisions with `ss -ltnp`, and note the expanded blast radius (a container escape now starts with full visibility of host-local services). Never flip an internet-facing service to host mode to "fix" a port mapping problem.

**Before you leave this section**

- **Understand:** bridge isolates with NAT, host shares the whole stack with zero isolation, none removes networking; the right choice is a trade-off, not a preference.
- **Try:** run the same image on `bridge`, `host`, and `none`; compare `docker inspect` output and whether the app is reachable.
- **Watch in prod:** host-networked services colliding on a shared host port, and host mode quietly widening a container's blast radius.

```mermaid
flowchart TD
  need["Choose a network driver"] --> multiHost{"Must span multiple hosts?"}
  multiHost -->|Yes| overlay["overlay<br/>requires Swarm"]
  multiHost -->|No| underlay{"Must appear on physical LAN?"}
  underlay -->|Yes| macChoice{"Unique MAC per container?"}
  macChoice -->|Yes| macvlan["macvlan"]
  macChoice -->|No| ipvlan["ipvlan"]
  underlay -->|No| isolate{"Need network isolation?"}
  isolate -->|No network at all| noneDrv["none"]
  isolate -->|Share host stack| hostDrv["host"]
  isolate -->|Yes default| bridgeDrv["bridge / user-defined bridge"]
```

*Figure 06.2: A driver decision path — start from multi-host and underlay needs, then fall back to bridge, host, or none.*

> ⚠️ **Warning:** Two host-networked containers cannot both bind the same host port. Treat the host port namespace as shared scarce resource.

---

## 06.4 Overlay networks

### In plain terms

An **overlay** network is a virtual switch that stretches across *multiple* Docker hosts. Containers on different machines behave as if they were plugged into the same LAN. The traffic is tunneled (typically VXLAN) between hosts.

The problem overlay solves is that a bridge lives on exactly one machine. The moment your application outgrows a single host — three web replicas on one server, a database on another — a bridge cannot reach across the gap. Overlay builds a software-defined network *on top of* whatever physical network already connects your hosts, so containers on `node-1` and `node-2` share a subnet and talk by name as if the underlying machines did not exist. That is why every real orchestrator has something overlay-shaped underneath it.

> ⚠️ **Common Pitfall:** You might think overlay is "just another driver you pick with `--driver overlay`" on any Docker install. It is not available on a standalone daemon: overlay needs a control plane to distribute network state and encryption keys to every participating host, and on Docker that control plane is Swarm mode.

### Under the hood

Overlay networks require **Swarm mode** (Chapter 09). On a standalone daemon:

```bash
$ docker network create --driver overlay --attachable my-overlay
Error response from daemon: This node is not a swarm manager. Use "docker swarm init" ... to create one.
```

That error is expected — and useful. After `docker swarm init`, you create overlay networks for multi-host services; Swarm's routing mesh (Chapter 09) publishes service ports across the cluster.

Under the covers, each host encapsulates container traffic in **VXLAN** frames (UDP port 4789) and sends them to the peer host that hosts the destination container. Swarm distributes the mapping of "which container IP lives behind which host" through its Raft-backed control plane, and can encrypt the data plane with IPsec when you pass `--opt encrypted`. **What breaks if X:** if a firewall between your hosts blocks the VXLAN port (4789/udp) or the Swarm control ports (2377/tcp, 7946/tcp+udp), the network is created successfully but cross-host traffic silently black-holes — containers on the same host talk fine, cross-host calls time out. That asymmetry is the tell.

### In production

Use overlay when services must span nodes under Swarm. For Kubernetes (Part II), CNI plugins play the analogous multi-host role — do not expect Docker overlay alone to wire a Kubernetes cluster.

**Who owns this:** the platform/network team owns the firewall rules and MTU budget that make overlay work; the app team only owns which services attach to which overlay. **Failure mode and detection:** the signature symptom is "works within a node, times out across nodes," which points at blocked VXLAN/control ports or an MTU mismatch (VXLAN adds ~50 bytes of overhead, so a path that only passes 1500-byte frames can drop the encapsulated packets). Detect with a cross-node `ping`/`curl` between tasks and by checking `docker network inspect` on each node. **Do** open 2377/tcp, 7946/tcp+udp, and 4789/udp between nodes and consider `--opt encrypted` for untrusted links; **don't** assume overlay alone secures traffic — plaintext VXLAN is readable by anyone on the underlay.

**Before you leave this section**

- **Understand:** overlay stretches one virtual L2 network across many hosts using VXLAN, and it requires Swarm's control plane to exist.
- **Try:** run `docker network create --driver overlay …` on a non-Swarm daemon and read the error; then re-run after `docker swarm init`.
- **Watch in prod:** cross-node connectivity that breaks when VXLAN/control ports are firewalled or the path MTU is too small for encapsulated frames.

---

## 06.5 Macvlan and ipvlan

### In plain terms

Sometimes an application expects to sit on the **physical LAN** like a bare-metal host or VM — with its own address visible to routers, firewalls, and legacy monitoring — rather than behind Docker NAT. **Macvlan** and **ipvlan** plug containers into a parent host interface so they appear on that underlay network.

- **Macvlan** assigns each container its **own MAC address**, so neighbors see distinct Ethernet devices.
- **Ipvlan** shares the **parent interface's MAC** and distinguishes containers mainly by IP (and mode). Prefer ipvlan when the network or NIC limits how many MACs you may attach.

### Under the hood

Neither driver is supported on Docker Desktop or in rootless mode in the usual beginner setups. Use a Linux host with a real parent NIC (for example `eth0` or a VLAN sub-interface).

**Macvlan (bridge mode):**

```bash
$ docker network create -d macvlan \
    --subnet=192.168.1.0/24 \
    --gateway=192.168.1.1 \
    -o parent=eth0 \
    lan-macvlan

$ docker run -d --name lan-web --network lan-macvlan nginx:1.27
$ docker inspect lan-web --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
192.168.1.2
```

**Ipvlan L2** (closest cousin to macvlan without unique MACs):

```bash
$ docker network create -d ipvlan \
    --subnet=192.168.210.0/24 \
    --gateway=192.168.210.254 \
    -o ipvlan_mode=l2 \
    -o parent=eth0 \
    ipvlan210
```

Ipvlan also supports **L3** mode for routing-oriented designs; choose L2 when you want same-subnet LAN presence.

> 💡 **Tip:** By default the host itself often cannot reach macvlan/ipvlan container IPs on the same parent without an extra shim interface. Plan host-to-container access deliberately (another network, a proxy, or documented host config) — do not assume `curl` from the host "just works."

### In production

| Driver | Unique MAC per container? | Best when |
|--------|---------------------------|-----------|
| `macvlan` | Yes | Legacy apps / appliances that must look like physical hosts on the LAN |
| `ipvlan` | No (shares parent MAC) | MAC exhaustion, switch port security limits, or L3 underlay integration |

Checklist:

1. Confirm the parent interface and VLAN tagging with your network team.
2. Reserve IP ranges so Docker IPAM does not collide with DHCP or static hosts.
3. Document that Desktop/rootless learners cannot reproduce this lab as-is.
4. For Swarm-scoped macvlan, node-specific `--config-only` networks are often required so each node uses a non-overlapping `--ip-range` — IPAM is not centrally coordinated the way overlay is.

**Who owns this:** because macvlan/ipvlan put containers directly on the physical LAN, they cross into the network team's territory — IP ranges, VLAN IDs, and switch port security are now shared with Docker's IPAM. The single worst failure here is an **IP collision**: Docker hands a container an address that a static host or DHCP lease already uses, and both endpoints start dropping traffic intermittently. Detect it with duplicate-address complaints in switch logs or `arping` on the parent subnet. **Do** carve out a dedicated, documented range that DHCP will never lease; **don't** let two hosts' macvlan IPAM overlap.

**Before you leave this section**

- **Understand:** macvlan gives each container its own MAC on the LAN; ipvlan shares the parent MAC and leans on IP (and L2/L3 mode) instead.
- **Try:** on a Linux host with a spare subnet, create a macvlan network and confirm whether the host can reach the container without a shim.
- **Watch in prod:** IP collisions with existing DHCP/static hosts, and MAC-count limits on cloud NICs or security-locked switch ports.

---

## 06.6 User-defined networks and embedded DNS

### In plain terms

Do not leave multi-container apps on the default `bridge`. Create your own network. On a **user-defined** bridge, Docker's embedded DNS lets containers find each other **by name** — `db`, `api`, `cache` — instead of brittle IPs.

The problem this solves is the one you met in Section 06.2: container IPs are unstable and the default bridge has no name resolution, so any app that references a peer by IP breaks the moment that peer restarts with a new address. A user-defined bridge fixes this at the root. Docker runs a tiny embedded DNS resolver at `127.0.0.11` inside every container on the network; it resolves container and service names to whatever IP they currently hold. You write `db` in your connection string once and never touch it again, even as containers are recreated a hundred times.

> ⚠️ **Common Pitfall:** You might assume the built-in `bridge` network gives you name resolution "because it's still a bridge." It does not — automatic DNS between containers is a feature of *user-defined* networks specifically. This single difference is why so many first Compose-less multi-container setups fail with "could not resolve host db."

### Under the hood

```bash
$ docker network create app-net
$ docker run -d --name db --network app-net postgres:16
$ docker run -d --name api --network app-net --env DATABASE_URL=postgres://tasks:dev@db:5432/tasks task-api:0.1.0
$ docker exec api ping -c 1 db
PING db (172.19.0.2): 56 data bytes
64 bytes from 172.19.0.2: seq=0 ttl=64 time=0.089 ms
```

User-defined networks also give you:

- **Isolation** — containers on different networks cannot see each other unless you attach them to both.
- **Live attach/detach** — `docker network connect` / `disconnect` on running containers.
- **Custom subnets** — `docker network create --subnet 10.5.0.0/24 mynet` when addressing must be predictable.

```mermaid
flowchart TB
  subgraph frontendNet["frontend network"]
    web["web"]
    apiFront["api"]
  end
  subgraph backendNet["backend network"]
    apiBack["api"]
    db["db"]
  end
  apiFront -.->|same container<br/>attached to both| apiBack
```

*Figure 06.3: Dual-network attachment — the API bridges trust zones while the database stays on the backend network only.*

| Need | Prefer |
|------|--------|
| Multi-container DNS by name | User-defined bridge |
| Default catch-all for lonely containers | Built-in `bridge` |
| Attach one service to two zones | `docker network connect` (API on frontend + backend) |

### Legacy links

Older tutorials use `--link`:

```bash
$ docker run -d --name api --link db:database my-api:1.0
```

**`--link` is legacy and deprecated.** It only works on the default bridge, injects brittle `/etc/hosts` and env vars, and does not survive recreation cleanly. Replace it with a user-defined network and DNS names.

**What breaks if X:** if two containers on the same user-defined network share a `--network-alias`, Docker's embedded DNS returns *all* matching IPs and round-robins between them. That is a feature for simple load balancing, but it surprises people who assumed a name maps to exactly one container — a stale replica still holding the alias will receive a share of traffic until it is removed.

### In production

Segment by trust boundary: put databases on a backend network, frontends on a frontend network, and attach the API to both. Publish only the ports that must leave the host. Compose (Chapter 08) makes this pattern the default.

**Who owns this:** the app team owns the network segmentation because it encodes the application's trust model — which components are allowed to talk to the datastore at all. A flat single network where everything can reach everything is the networking equivalent of running every process as root: convenient until one compromised frontend can open a socket straight to the database.

**Failure mode and detection:** the quiet failure is *over-connection* — a service that works fine but is reachable by more peers than it should be, widening blast radius without ever throwing an error. Audit with `docker network inspect <net>` to list attached containers, and treat any datastore attached to a frontend-facing network as a finding. **Do** keep databases on a backend-only network and bridge just the API across zones; **don't** attach everything to one network for convenience.

**Before you leave this section**

- **Understand:** user-defined bridges add embedded DNS (`127.0.0.11`) so containers resolve each other by name; the default bridge does not.
- **Try:** create a network, start `db` and `api` on it, and `docker exec api getent hosts db` to see name resolution work; repeat on the default bridge and watch it fail.
- **Watch in prod:** datastores that end up attached to frontend-facing networks, silently widening the trust boundary.

---

## 06.7 Publishing ports

### In plain terms

Bridge-network containers can talk to peers, but your laptop browser cannot reach them until you **publish** a port — the front desk forwarding an outside call to apartment 4B.

Publishing is where the *isolation* you have been building meets the *exposure* you actually need. A container is unreachable from outside by design; publishing punches a deliberate hole through the host's firewall to forward one host port to one container port. That is exactly what you want for the one API a service should expose — and exactly what you do *not* want for the database, the admin UI, or the metrics endpoint sitting behind it. Every published port is a door you are choosing to leave unlocked to whatever can reach the host's address.

> ⚠️ **Common Pitfall:** You might read `-p 8080:80` and think the numbers are interchangeable or that the container port comes first. The order is always **`HOST:CONTAINER`**. Reversing it (`-p 80:8080`) silently "works" — it just opens the wrong host port and forwards to a container port nothing is listening on, so you get connection-refused and blame the app.

### Under the hood

**Explicit `-p` (`--publish`)** — `HOST:CONTAINER` order:

```bash
$ docker run -d --name web -p 8080:80 nginx:1.27
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080
200
```

Useful variants:

```bash
$ docker run -d -p 127.0.0.1:8080:80 nginx:1.27   # localhost only on the host
$ docker run -d -p 8080:80/udp my-udp-app:1.0     # UDP
$ docker run -d -p 80:80 -p 443:443 nginx:1.27    # multiple mappings
```

**`-P` (`--publish-all`)** publishes every `EXPOSE`d port to a random high host port:

```bash
$ docker run -d --name web2 -P nginx:1.27
$ docker port web2
80/tcp -> 0.0.0.0:32768
80/tcp -> [::]:32771
```

| Flag | Host port | Best for |
|------|-----------|----------|
| `-p 8080:80` | You choose | Everyday use |
| `-p 127.0.0.1:8080:80` | Localhost-only | Dev databases, local tools |
| `-P` | Random per `EXPOSE` | Throwaway tests, parallel CI |

> ⚠️ **Common Pitfall:** `EXPOSE` in a Dockerfile does **not** publish anything. It is documentation (and a hint for `-P`). Only `-p` / `-P` at run time open a host port.

```mermaid
flowchart LR
  client["Host / laptop client"] -->|"published port<br/>-p 8080:80"| hostPort["Host port 8080"]
  hostPort --> nat["NAT / port proxy"]
  nat --> ctrPort["Container port 80"]
  expose["EXPOSE 80"] -.->|documents only| ctrPort
```

*Figure 06.4: Publishing opens a host door; `EXPOSE` alone documents intent and does not forward traffic.*

**What breaks if X:** the most dangerous default is `-p 5432:5432` (or any bare `-p HOST:CONTAINER`). Docker binds to `0.0.0.0` — *all* host interfaces — not just loopback. On a cloud VM with a public IP, that publishes your database to the entire internet, and Docker's rule insertion can bypass a `ufw`/`firewalld` policy you thought was protecting it, because Docker programs its own iptables/nftables chains ahead of many host firewall rules. Bind explicitly to `127.0.0.1:5432:5432` when only host-local tools need it.

### In production

Bind management ports to `127.0.0.1` or protect them with a reverse proxy and firewall. Prefer explicit `-p` over `-P` for anything humans bookmark. On Docker Desktop, remember published ports land on the VM/host forwarding path — firewall and VPN clients can still block you.

**Who owns this:** publishing a port is a shared decision between the app team (what needs to be reachable) and the platform/security team (what the host's firewall and network expose). The person who adds `-p` owns the consequence: a published port on an internet-facing host is an internet-facing service, full stop.

**Failure mode and detection:** the classic incident is a "dev only" database or dashboard published with a bare `-p` on a public VM and discovered by internet-wide scanners within hours. Detect exposure from the host with `ss -ltnp` (what is listening) and from outside with an external port scan or your cloud provider's security-group view — never trust that a host firewall alone hides a Docker-published port. **Do** bind management and datastore ports to `127.0.0.1` and front real traffic with a reverse proxy; **don't** leave `0.0.0.0` publishes on anything with a public address.

> 🏭 **Production floor:** A published port is the single largest blast-radius decision in single-host Docker. `-p 5432:5432` on a public host can expose a database to the whole internet and can sit *in front of* a host firewall you assumed was blocking it, because Docker writes its own packet-filter rules. Change-manage every new publish: justify it, bind to `127.0.0.1` unless external traffic is truly required, verify from outside the host with a real port scan, and prefer a reviewed reverse proxy over ad-hoc `-p` for anything internet-facing. When in doubt, publish nothing and reach the service over its user-defined network instead.

**Before you leave this section**

- **Understand:** `-p HOST:CONTAINER` opens a real host door bound to `0.0.0.0` by default; `-P` randomizes host ports for `EXPOSE`d ports; `EXPOSE` itself publishes nothing.
- **Try:** publish nginx with `-p 127.0.0.1:8080:80`, confirm `curl` works locally, then confirm another host on the network cannot reach it.
- **Watch in prod:** bare `0.0.0.0` publishes on public hosts, Docker's rules bypassing the host firewall, and databases/admin UIs exposed by habit.

---

## 06.8 Common pitfalls

1. **Default bridge and broken DNS.** Name resolution between containers works on user-defined networks, not the default `bridge`.
2. **Reversing `-p` order.** Always `HOST:CONTAINER`.
3. **`localhost` inside a container.** That is the container itself. Use service/container names on a shared network, or `host.docker.internal` (Docker Desktop) to reach the host.
4. **Expecting `EXPOSE` to open ports.** It does not.
5. **Copy-pasting `--link`.** Use user-defined networks.
6. **Trying macvlan on Desktop.** Use a Linux Engine host with a real parent interface.
7. **Assuming the host can ping macvlan IPs.** Plan host access separately.

---

## 06.9 Hands-on exercises

1. **Explore the defaults.** Run `docker network ls` and `docker network inspect bridge`. Note the subnet and gateway.
2. **Prove the DNS difference.** Start two Alpine containers on the default bridge; confirm `ping` by name fails. Recreate them on a user-defined network; confirm ping succeeds.
3. **Publish and verify.** Run nginx with `-p 8080:80`, then a second with `-P`. Use `docker port` to discover the random mapping.
4. **Segment an application.** Create `frontend` and `backend` networks. Attach `db` only to `backend`, `api` to both. Prove a frontend-only container cannot reach `db`.
5. **Go offline.** Run `docker run --rm --network none alpine:3.20 wget -T 3 https://example.com` and explain why the failure is intentional.
6. **Macvlan sketch (Linux lab).** If you have a spare subnet and parent NIC, create a macvlan network and attach a container. Document whether the host can reach the container IP without extra configuration.

---

## 06.10 Check Your Understanding

**Q1.** Why should you prefer user-defined bridge networks over the default `bridge` network?

<details>
<summary>Show answer</summary>

User-defined networks provide automatic DNS-based name resolution between containers, cleaner isolation from unrelated workloads, and support for connecting or disconnecting running containers. The default bridge does not offer that name resolution and dumps every unassigned container into one shared space.

</details>

**Q2.** What is the difference between `-p 5000:80` and `-P`?

<details>
<summary>Show answer</summary>

`-p 5000:80` maps host port 5000 to container port 80 explicitly. `-P` publishes every port the image declared with `EXPOSE` to random high-numbered host ports, which you discover with `docker port`.

</details>

**Q3.** A teammate's app inside a container tries `localhost:5432` for the database and fails even though the `db` container is running. What is wrong?

<details>
<summary>Show answer</summary>

Inside a container, `localhost` is that container's own network namespace. The app should use the database container's DNS name (for example `db:5432`) with both containers on the same user-defined network.

</details>

**Q4.** When is `--network host` appropriate, and what do you give up?

<details>
<summary>Show answer</summary>

Host networking suits latency-sensitive workloads or tools that must see real host interfaces, because it removes NAT. You give up network isolation and port flexibility: the container competes with the host and other host-networked containers for the same ports.

</details>

**Q5.** How do macvlan and ipvlan differ, and when might you prefer ipvlan?

<details>
<summary>Show answer</summary>

Macvlan gives each container its own MAC address on the parent interface's LAN. Ipvlan shares the parent MAC and distinguishes endpoints primarily by IP (and mode). Prefer ipvlan when MAC count is limited by switches, cloud NICs, or security policy, or when you need ipvlan's L3 routing modes.

</details>

**Q6.** Why does creating an overlay network fail on a fresh single-machine Docker install?

<details>
<summary>Show answer</summary>

Overlay networks span hosts and rely on Swarm mode's control plane. A standalone daemon is not a Swarm manager, so Docker refuses until you run `docker swarm init` (Chapter 09).

</details>

---

## 06.11 Key takeaways

- Containers are network-isolated by default; publish only what you need.
- Core drivers: `bridge`, `host`, `none`, `overlay` (Swarm), plus `macvlan` / `ipvlan` for underlay LAN attachment.
- Always prefer **user-defined networks** for multi-container apps — DNS by name and clearer isolation.
- Legacy `--link` is deprecated; user-defined networks replace it.
- `-p HOST:CONTAINER` publishes explicitly; `-P` publishes all `EXPOSE`d ports randomly; `EXPOSE` alone publishes nothing.

---

## 06.12 Official documentation map

| Topic | Official page |
|-------|---------------|
| Network drivers overview | [Network drivers](https://docs.docker.com/engine/network/drivers/) |
| Bridge driver | [Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/) |
| Host driver | [Host network driver](https://docs.docker.com/engine/network/drivers/host/) |
| Overlay driver | [Overlay network driver](https://docs.docker.com/engine/network/drivers/overlay/) |
| Macvlan driver | [Macvlan network driver](https://docs.docker.com/engine/network/drivers/macvlan/) |
| Ipvlan driver | [Ipvlan network driver](https://docs.docker.com/engine/network/drivers/ipvlan/) |
| Networking overview | [Networking](https://docs.docker.com/engine/network/) |
| `docker network create` | [docker network create](https://docs.docker.com/reference/cli/docker/network/create/) |
| Publish ports | [Publish container ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/) |

**Previous:** [Chapter 05 — Docker Containers Management](05-docker-containers-management.md) | **Next:** [Chapter 07 — Docker Volumes and Data Persistence](07-docker-volumes-and-data.md)
