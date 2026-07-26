# Chapter 02 — Docker Installation and Architecture

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Install Docker on your platform and verify the engine responds
> - Distinguish Docker Client, Docker Engine (`dockerd`), containerd, and runc
> - Trace what happens when you run a simple container
> - Read `docker version` and `docker info` with confidence
> - Recognize Desktop versus Engine-on-Linux differences that affect beginners

---

## 02.1 The Restaurant Kitchen

Think of Docker as a restaurant. You (the **client**) place orders with a waiter. The **kitchen** (the **engine/daemon**) prepares dishes according to recipes (**images**) and serves plates (**containers**). Walk-in customers never flip burners themselves; they talk to the waiter API.

If the kitchen is down, the waiter can still smile—but no food arrives. Beginners often install only a CLI-looking tool or forget to *start* Docker Desktop, then wonder why every command says the daemon is not running. This chapter gets the kitchen open and shows you the floor plan.

---

## 02.2 Installation Paths

### In plain terms

You have two common beginner paths: **Docker Desktop** (Windows, macOS, and many Linux learners) and **Docker Engine** installed directly on Linux servers. Both give you a `docker` CLI talking to a Linux container engine. Desktop wraps that engine in a managed VM and adds a GUI; Engine-on-Linux is leaner for servers.

| Path | Best for | Notes |
|------|----------|-------|
| **Docker Desktop** | Windows, macOS, and many Linux learners | GUI, optional Kubernetes, manages a Linux VM/engine for you |
| **Docker Engine** on Linux | Servers and Linux workstations | Install engine packages directly; no Desktop required |

This book’s commands assume a working Linux container engine reachable as `docker`. On Desktop, that is automatic once Docker is running.

### Under the hood

#### Windows (Docker Desktop)

1. Enable virtualization in BIOS/UEFI (Intel VT-x / AMD-V).
2. Install a supported backend: **WSL 2** is the usual recommendation on Windows 11.
3. Download and install Docker Desktop from Docker’s official site.
4. Start Docker Desktop and wait until it reports **Running**.
5. Open PowerShell, Windows Terminal, or WSL and verify:

```bash
$ docker version
$ docker run --rm hello-world
```

#### macOS (Docker Desktop)

1. Install Docker Desktop for Mac (Apple silicon or Intel build as appropriate).
2. Launch Docker Desktop; wait for the engine to start.
3. Verify with the same two commands as above.

#### Linux (Engine)

Use your distribution’s supported method from Docker’s official docs (apt/yum/dnf packages from Docker’s repositories—not outdated distro copies when possible). After install:

```bash
$ sudo systemctl enable --now docker
$ sudo docker run --rm hello-world
```

To run without `sudo`, add your user to the `docker` group, then log out and back in:

```bash
$ sudo usermod -aG docker $USER
```

> ⚠️ **Warning:** Membership in the `docker` group is effectively root-equivalent on the host. Use it on personal lab machines thoughtfully.

Always prefer the install guides on [docs.docker.com](https://docs.docker.com/engine/install/) for package names and repository setup—they change more often than conceptual architecture.

### In production

- Pin Desktop or Engine versions in team docs so “works on my machine” includes engine minor version.
- On servers, install from Docker’s official repositories, enable the service at boot, and restrict who can talk to the Docker socket.
- Treat corporate proxies and SSL inspection as first-class configuration: misconfigured TLS breaks pulls more often than “Docker is broken.”

---

## 02.3 Verify the Install

### In plain terms

Two commands tell you almost everything at the start: `docker version` (can the client reach a server?) and `docker run --rm hello-world` (can that server pull and run?).

### Under the hood

#### `docker version`

```bash
$ docker version
```

You should see **Client** and **Server** sections. If Client appears but Server errors with “Cannot connect to the Docker daemon,” the engine is not running or the client cannot reach its socket/pipe.

Sample shape (versions will differ; this book targets **29.x**):

```text
Client:
 Version:           29.x.x
 API version:       1.xx
 Go version:        go1.xx.x
 OS/Arch:           windows/amd64
 Context:           desktop-linux

Server: Docker Desktop
 Engine:
  Version:          29.x.x
  API version:      1.xx (minimum version 1.24)
  OS/Arch:          linux/amd64
```

Notice **Client OS/Arch** may be Windows/macOS while **Server OS/Arch** is `linux/amd64` or `linux/arm64`. That is expected on Desktop: your CLI runs on the host OS; containers run in a Linux engine.

#### `docker info`

```bash
$ docker info
```

Skim for: server version, storage driver / image store, logging driver, CPUs, total memory, and whether BuildKit is active. You do not memorize this output—you learn where to look when troubleshooting.

#### The classic smoke test

```bash
$ docker run --rm hello-world
```

```text
Hello from Docker!
This message shows that your installation appears to be working correctly.
...
```

`--rm` removes the container after it exits so your system does not accumulate one-off containers.

### In production

Automate a post-install health check in onboarding docs: `docker version`, `docker info`, and a known-good pull. Record Client version, Engine version, and Server OS/Arch so support tickets start with facts.

---

## 02.4 Architecture: Client, Engine, and Friends

### In plain terms

You type `docker …`. A client sends an API request. A long-running engine accepts it, then asks lower-level runtimes to create the actual isolated process. Registries sit on the side for pull and push.

<!-- VISUAL: docker CLI → API (named pipe / unix socket / TCP) → dockerd → containerd → runc → container process; registries on the side for pull/push -->

### Under the hood

#### Docker Client

The `docker` binary parses your command and sends an API request to the engine. It does not itself create namespaces or start processes (except by talking to the daemon).

#### Docker Engine (`dockerd`)

The long-running daemon that:

- Accepts API calls
- Manages images, containers, networks, and volumes
- Coordinates pulls/pushes with registries
- Delegates low-level runtime work

#### containerd and runc

Modern Docker uses **containerd** as a core container runtime component, which in turn often uses **runc** (or another OCI runtime) to spawn the actual container process. You rarely invoke these directly as a beginner, but error messages sometimes mention them—now you know they sit under the hood.

On fresh Docker Engine **29.x** installs, the **containerd image store** is typically the default for image content (snapshotters such as `overlayfs`). Upgraded daemons may still report legacy graph drivers until migrated—check `docker info` when disk or multi-platform behavior looks odd (Chapter 03 and 07 expand storage implications).

#### Images, Containers, Networks, Volumes

The engine keeps local state:

| Object | Role |
|--------|------|
| Images | Immutable templates (layered) |
| Containers | Instances with writable layers + config |
| Networks | How containers reach each other and the host |
| Volumes | Persistent data managed by Docker |

Chapter 03 focuses on images; Chapter 05 on containers; Chapters 06 and 07 cover networks and volumes.

### In production

Know this stack so failures map to layers: CLI/context problems, daemon down, pull/registry failures, runtime create/start failures, or application crashes. “Docker is broken” is rarely the diagnosis—architecture tells you where to look.

> 📘 **Deep Dive (optional):** The Docker API can be spoken by other clients (SDKs, CI plugins, Portainer). Anything with access to the socket can do what the CLI can do—treat socket exposure as privileged access.

---

## 02.5 Contexts and Endpoints

### In plain terms

A **context** is a named “which kitchen am I ordering from?” setting for the client. Beginners usually stay on the default Desktop or local context.

### Under the hood

```bash
$ docker context ls
```

On Linux the default API endpoint is often the Unix socket `unix:///var/run/docker.sock`. On Docker Desktop for Windows it may be an `npipe://` named pipe. You normally do not configure this by hand.

If commands suddenly hit the wrong machine, check the active context:

```bash
$ docker context show
```

### In production

Document which context developers and CI use. Prefer explicit contexts for remote engines over ad-hoc `DOCKER_HOST` changes that linger in shells. Never expose an unauthenticated Docker API over the public internet.

---

## 02.6 What Happens During `docker run hello-world`

### In plain terms

One command hides a pipeline: talk to the engine, find or pull an image, create a container, start a process, print a message, exit, maybe clean up.

### Under the hood

Layered view:

1. **CLI** validates arguments and calls the Engine API “create + start.”
2. **Engine** checks for the `hello-world` image locally.
3. On miss, Engine **pulls** from the configured registry (Docker Hub by default).
4. Engine creates a container config (hostname, networking, mounts, command).
5. Runtime starts the process defined by the image.
6. The process prints the hello message and exits.
7. With `--rm`, Engine deletes the container’s writable layer.

Understanding this pipeline makes later failures diagnosable: pull problems versus create problems versus start problems versus app crashes.

### In production

Teach on-call the same pipeline. A failed deploy is often “registry auth,” “disk full,” “image missing for this architecture,” or “process exited 1”—not a mysterious Docker ghost.

---

## 02.7 Desktop-Specific Realities

### In plain terms

On Mac and Windows, your containers do not run directly on the host kernel. They run inside a Linux environment Desktop manages. That explains resource knobs, file-sharing quirks, and why Client OS and Server OS differ.

### Under the hood

- **Resources:** Desktop allocates CPU/RAM/disk to the Linux VM. If builds are slow or containers OOM, raise resources in Desktop settings.
- **File sharing:** Bind-mounting host directories requires shared paths; permission quirks are common on Mac/Windows. Prefer working inside WSL2 filesystems on Windows when possible.
- **Linux containers vs Windows containers:** This book uses **Linux containers**. On Windows, ensure Desktop is in Linux container mode.
- **Optional Kubernetes:** Desktop can enable a single-node cluster—useful later in Part II, not required for Part I.
- **Compose V2:** Prefer `docker compose` (plugin) on Docker Engine 29.x over the legacy `docker-compose` standalone binary.

### In production

For local parity with Linux servers, develop inside WSL2 or a Linux VM when path and performance quirks matter. For CI, prefer Linux runners that match production architecture (`linux/amd64` versus `linux/arm64`).

---

## 02.8 Common Pitfalls

> ⚠️ **Common Pitfall:** Installing an old `docker-compose` standalone and mixing it with Compose V2.  
> Prefer `docker compose` (plugin) on modern Docker Engine 29.x.

> ⚠️ **Common Pitfall:** Daemon not running.  
> Symptoms: `Cannot connect to the Docker daemon`. Fix: start Docker Desktop or `systemctl start docker`, then retry.

> ⚠️ **Common Pitfall:** Using `sudo docker` sometimes and unsudo’d Docker other times with different contexts.  
> Pick one deliberate setup. Mixed modes confuse image visibility (“Where did my image go?”).

> ⚠️ **Common Pitfall:** Corporate proxies and SSL inspection breaking pulls.  
> If `docker pull` fails with TLS or timeout errors only on company networks, configure proxy settings in Desktop/daemon carefully—do not disable TLS globally as a “fix.”

---

## 02.9 Hands-On Exercises

1. Run `docker version` and record: Client version, Server Engine version, and Server OS/Arch. Confirm Server is present and note whether you are on a 29.x engine.
2. Run `docker info` and note your CPUs, Total Memory, Logging Driver, and storage/image-store related fields.
3. Run `docker run --rm hello-world` twice. The second run should be faster and should not re-download layers if the image is cached—observe the difference.
4. Run `docker ps -a` and `docker images`. Confirm `hello-world` appears in images. If a container remains, you likely omitted `--rm`; remove it with `docker rm <id>`.
5. Intentionally quit/stop Docker Desktop (or stop the service), run `docker ps`, read the error, then restart and confirm recovery.
6. Run `docker context ls` and note the active context marked with `*`.

---

## 02.10 Check Your Understanding

**Q1.** What is the difference between the Docker Client and the Docker Engine?

<details>
<summary>Show answer</summary>

The client is the CLI (and other API consumers) that sends requests. The engine (`dockerd`) is the background service that builds images, runs containers, and manages Docker objects.

</details>

**Q2.** On Docker Desktop for Mac, why might Client OS/Arch differ from Server OS/Arch?

<details>
<summary>Show answer</summary>

The client runs on macOS; Linux containers run inside a Linux virtual machine that hosts the engine. Server OS/Arch therefore shows linux/amd64 or linux/arm64.

</details>

**Q3.** What does a successful `docker run --rm hello-world` prove?

<details>
<summary>Show answer</summary>

That the client can reach a working engine, that the engine can pull (or already has) an image, and that it can create and start a container successfully.

</details>

**Q4.** Why is the `docker` group powerful on Linux?

<details>
<summary>Show answer</summary>

Anyone who can talk to the Docker socket can often escalate to root-equivalent control of the host by running privileged containers or mounting the host filesystem.

</details>

---

## 02.11 Key Takeaways

- Install Docker Desktop (Mac/Windows) or Docker Engine (Linux), then verify with `docker version` and `hello-world`.
- Architecture: **Client → Engine API → dockerd → containerd/runc → process**.
- Desktop runs a Linux engine in a VM; that split explains many path and resource quirks.
- Distinguish failures: daemon down, pull failed, container exited—architecture tells you where to look.
- Compose V2 via `docker compose` matches this book’s Docker Engine 29.x assumptions.

---

## 02.12 Official documentation map

| Topic | Official page |
|-------|---------------|
| Install Docker Engine | [Install Docker Engine](https://docs.docker.com/engine/install/) |
| Install Docker Desktop | [Docker Desktop](https://docs.docker.com/desktop/) |
| Docker Engine overview | [Engine](https://docs.docker.com/engine/) |
| `docker version` / CLI | [docker CLI reference](https://docs.docker.com/reference/cli/docker/) |
| Daemon configuration | [dockerd](https://docs.docker.com/reference/cli/dockerd/) |
| Contexts | [Docker contexts](https://docs.docker.com/engine/manage-resources/contexts/) |

**Previous:** [Chapter 01 — Docker: Why and What](01-docker-why-and-what.md) | **Next:** [Chapter 03 — Images Deep Dive](03-docker-images-deep-dive.md)
