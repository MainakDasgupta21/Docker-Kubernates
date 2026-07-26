# Chapter 05 — Docker Containers Management

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Manage the full container lifecycle: create, start, stop, restart, pause, remove
> - Debug with logs, logging drivers, `exec`, `docker debug`, inspect, and port mappings
> - Apply CPU/memory limits and understand basic pressure symptoms
> - Choose restart policies intentionally
> - Distinguish ephemeral container filesystems from data you must persist

---

## 05.1 Pets, Cattle, and a Stubborn Process

Old-school servers were pets: named, unique, nursed back to health. Containers work better as cattle: if one is sick, you check the logs, then replace it from the same image. The skill is not “SSH in and edit until it works”—it is **lifecycle control + diagnosis**.

You already built `task-api:0.1.0` in Chapter 04. This chapter uses it (or `nginx:alpine` if you need a stand-in) to practice professional container operations on a single host.

---

## 05.2 Lifecycle at a Glance

### In plain terms

A container is born (created), can run, pause, stop, restart, and eventually be removed. `docker run` is a convenience that creates and starts in one step.

<!-- VISUAL: State diagram: created → running ⇄ paused; running → stopped → removed; running → dead/exited; restart policy arrows from exited back to running -->

| State (simplified) | Meaning |
|--------------------|---------|
| Created | Config exists; process not started |
| Running | Main process is alive |
| Paused | Process frozen via cgroups freezer |
| Exited / Stopped | Process ended (any exit code) |
| Removed | No longer present on the daemon |

### Under the hood

```bash
$ docker create --name task-api -p 8000:8000 task-api:0.1.0
$ docker start task-api
$ docker stop task-api
$ docker start task-api
$ docker restart task-api
$ docker pause task-api
$ docker unpause task-api
$ docker rm task-api          # must be stopped unless -f
```

One-shot convenience:

```bash
$ docker run --rm --name task-api -p 8000:8000 task-api:0.1.0
```

`docker run` = create + start (plus pull if needed). `--rm` removes the container when it exits—great for experiments, wrong for something you want to `docker start` again later.

List running versus all:

```bash
$ docker ps
$ docker ps -a
```

```text
CONTAINER ID   IMAGE            COMMAND                  STATUS         PORTS                                         NAMES
a1b2c3d4e5f6   task-api:0.1.0   "gunicorn --bind ..."    Up 2 minutes   0.0.0.0:8000->8000/tcp                        task-api
```

### In production

Name containers deliberately in scripts (`--name`) and prefer `--rm` for CI one-shots. On shared daemons, exited containers accumulate and confuse name conflicts—prune on a schedule, not by panic.

---

## 05.3 Detached Mode, Attach, and Ports

### In plain terms

Detached mode (`-d`) runs in the background—like starting a service. Attaching connects your terminal to the main process streams. Publishing ports (`-p`) is how the host reaches the app inside.

### Under the hood

```bash
$ docker run -d --name task-api -p 8000:8000 task-api:0.1.0
$ docker logs -f task-api
```

Attach to the main process streams:

```bash
$ docker attach task-api
```

Detach from an attached session without stopping the container: the default sequence is `Ctrl-P` then `Ctrl-Q` (not `Ctrl-C`, which may signal the process). Prefer `docker logs` for most debugging.

```bash
$ docker port task-api
```

```text
8000/tcp -> 0.0.0.0:8000
```

```bash
$ curl -s http://127.0.0.1:8000/healthz
```

```json
{"status":"ok"}
```

If curl fails but `docker ps` shows Up, check: wrong host port, app bound to `127.0.0.1` inside the container (should be `0.0.0.0`), or firewall/Desktop port sharing issues.

### In production

Publish only what you must. Prefer user-defined networks for container-to-container traffic (Chapter 06) instead of publishing every service to the host. In Kubernetes later, Services and probes replace ad-hoc `-p` habits—but the “listen on 0.0.0.0 inside the container” lesson remains.

---

## 05.4 Logs and Logging Drivers

### In plain terms

Applications should write to **stdout/stderr**. Docker’s logging driver decides where those streams go—local files, a journal, a log platform, or elsewhere. `docker logs` reads what the driver exposes for that container.

### Under the hood

#### Everyday log commands

```bash
$ docker logs task-api
$ docker logs --tail 100 task-api
$ docker logs --since 10m task-api
$ docker logs -f --timestamps task-api
```

Exit codes matter:

```bash
$ docker ps -a --filter name=task-api
```

Non-zero `Exited (1)` means the process crashed or failed at startup—read logs before restarting in a loop.

#### Which driver is active?

```bash
$ docker info --format '{{.LoggingDriver}}'
$ docker inspect -f '{{.HostConfig.LogConfig.Type}}' task-api
```

The default driver is typically **`json-file`**, which stores JSON log files on the Docker host. Other common drivers include:

| Driver | Role |
|--------|------|
| `json-file` | Default; local JSON files; supports `docker logs` |
| `local` | Compact local format; also supports `docker logs` |
| `journald` | Send to systemd journal (Linux) |
| `syslog` / `fluentd` / `awslogs` / `gcplogs` / … | Forward to external systems |

Per-container override with rotation options:

```bash
$ docker run -d --name task-api \
    --log-driver json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    -p 8000:8000 \
    task-api:0.1.0
```

Daemon defaults (Linux example `/etc/docker/daemon.json`; on Desktop use Settings → Docker Engine):

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

> ⚠️ **Warning:** Unlimited `json-file` logs can fill the disk. Always set rotation (`max-size` / `max-file`) on busy hosts.

If an app only writes to an internal file, you will not see it with `docker logs` unless you mount/copy that file—an anti-pattern for containers.

### In production

- Standardize on a driver strategy: local rotation for laptops; forwarding drivers or sidecars/agents for clusters.
- Remember: some remote drivers **do not** support `docker logs` the same way—use your log platform’s UI.
- Treat log volume as a capacity plan item alongside image storage (`docker system df`).
- Dual-ship carefully (local + remote) only when you understand duplication and retention costs.

> 📘 **Deep Dive (optional):** The `local` driver is optimized for lower overhead than `json-file` while still supporting `docker logs`. See Docker’s logging driver docs when tuning high-churn services on a single host.

---

## 05.5 `exec` and `docker debug`

### In plain terms

`docker exec` starts a new process inside a *running* container’s namespaces—handy for a quick shell or one-liner. **`docker debug`** (Docker Desktop / supported subscriptions) goes further: it can give you a toolbox shell even when the image is slim or distroless and has no shell of its own.

### Under the hood

#### Classic `exec`

```bash
$ docker exec -it task-api /bin/sh
```

If the image has bash:

```bash
$ docker exec -it task-api /bin/bash
```

Useful one-liners without an interactive shell:

```bash
$ docker exec task-api python -c "import app; print('ok')"
$ docker exec task-api ps aux
```

`exec` starts a **new** process in the container’s namespaces. It is for diagnosis, not for installing permanent packages—those belong in the image build.

#### `docker debug`

```bash
$ docker debug task-api
```

Or debug an image that is not even running:

```bash
$ docker debug task-api:0.1.0
```

Non-interactive command form:

```bash
$ docker debug -c "curl -s http://127.0.0.1:8000/healthz" task-api
```

Characteristics to remember:

- Works as an alternative when `docker exec … bash` fails because the image has no shell
- Ships a customizable toolbox (editors, `curl`, process tools, and more)
- Available via Docker Desktop CLI/GUI for Pro / Team / Business subscriptions; not a built-in of every standalone Engine install
- Prefer fixing images and runtime flags for lasting repairs—debug sessions are for investigation

> 💡 **Tip:** If `docker debug` is not a recognized command, you are likely on Engine-only Linux without the Desktop debug component—or without a licensed Desktop feature set. Fall back to `exec`, ephemeral `--entrypoint sh` containers, or distroless-friendly debug sidecar patterns.

### In production

Use `exec`/`debug` for forensics, not configuration management. Anything you install in a running container disappears when the container is replaced. Bake fixes into a new image tag/digest and redeploy.

---

## 05.6 Inspect: The Source of Truth

### In plain terms

When docs, dashboards, and memory disagree, `docker inspect` shows what the engine actually configured.

### Under the hood

```bash
$ docker inspect task-api
```

Query specific fields:

```bash
$ docker inspect -f '{{.State.Status}}' task-api
$ docker inspect -f '{{.RestartCount}}' task-api
$ docker inspect -f '{{.State.OOMKilled}}' task-api
$ docker inspect -f '{{json .HostConfig.Memory}}' task-api
$ docker inspect -f '{{.HostConfig.LogConfig.Type}}' task-api
$ docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' task-api
```

### In production

Teach on-call a short inspect checklist: status, exit code, OOMKilled, RestartCount, mounts, port bindings, log driver, env (careful—secrets may appear). Prefer templated `-f` queries over scrolling megabytes of JSON under pressure.

---

## 05.7 Resource Limits

### In plain terms

**Why:** A single runaway container can consume all memory and force the kernel to kill processes (OOM), or starve neighbors of CPU. Limits protect the host and other workloads.

### Under the hood

```bash
$ docker run -d --name task-api \
    -p 8000:8000 \
    --memory 256m \
    --memory-swap 256m \
    --cpus 0.50 \
    task-api:0.1.0
```

| Flag | Effect |
|------|--------|
| `--memory` / `-m` | Hard memory limit |
| `--memory-swap` | Total memory+swap ceiling (set equal to memory to disable swap use) |
| `--cpus` | CPU time allowance (0.5 ≈ half a CPU) |
| `--cpu-shares` | Relative weight when contending (soft) |

Watch live usage:

```bash
$ docker stats task-api
```

```text
CONTAINER ID   NAME       CPU %     MEM USAGE / LIMIT     MEM %     NET I/O
a1b2c3d4e5f6   task-api   0.12%     45MiB / 256MiB        17.5%     1.2kB / 648B
```

If the app is OOM-killed, `docker inspect` shows `OOMKilled` true and logs may end abruptly—raise memory *or* fix a leak; do not only raise forever without understanding.

### In production

Never run shared-host workloads without memory limits. Set CPU limits where noisy neighbors matter. In Kubernetes you will express the same ideas as requests/limits—learn the symptoms now on Docker.

---

## 05.8 Restart Policies

### In plain terms

Restart policies tell the **engine** what to do when the container exits—handy for daemons on a single host, dangerous when they turn a crash loop into a CPU furnace.

### Under the hood

```bash
$ docker run -d --name task-api \
    --restart unless-stopped \
    -p 8000:8000 \
    task-api:0.1.0
```

| Policy | Behavior |
|--------|----------|
| `no` | Do not restart (default) |
| `on-failure[:max]` | Restart on non-zero exit, optional max retries |
| `always` | Always restart; also starts after daemon reboot |
| `unless-stopped` | Like `always`, unless you explicitly stopped it |

Update an existing container’s policy:

```bash
$ docker update --restart=on-failure:5 task-api
```

### In production

Pair restarts with healthy images and attention to `RestartCount`. Prefer orchestrator-level restarts (Compose, Swarm, Kubernetes) for multi-service apps. A tight `always` loop on a broken image is an availability illusion—traffic fails while the daemon churns.

> ⚠️ **Warning:** `always` on a container that crashes instantly creates a restart storm—CPU churn and log spam. Stop it explicitly, fix the image, then bring it back.

---

## 05.9 Stopping Gracefully vs Forcing

### In plain terms

`docker stop` knocks politely (SIGTERM), waits, then forces. `docker kill` kicks the door in. Prefer polite.

### Under the hood

```bash
$ docker stop task-api
```

Sends the configured stop signal (`STOPSIGNAL` / default SIGTERM), waits a grace period (default 10s), then SIGKILL.

```bash
$ docker kill task-api
```

Sends SIGKILL immediately (unless you choose another signal). Prefer `stop` so Gunicorn workers can finish requests.

```bash
$ docker stop -t 30 task-api
```

Your app must handle SIGTERM—another reason exec-form `ENTRYPOINT`/`CMD` matters (Chapter 04).

### In production

Tune grace periods to match drain time (in-flight requests, connection cleanup). In Kubernetes, the same idea becomes `terminationGracePeriodSeconds` plus preStop hooks—practice good signal handling now.

---

## 05.10 Cleaning Up and Copying Files

### In plain terms

Remove containers you do not need. Prune carefully on shared machines. Copy files out when you need forensics.

### Under the hood

```bash
$ docker rm task-api
$ docker rm -f task-api    # force stop + remove
```

Bulk hygiene:

```bash
$ docker container prune
$ docker system prune
```

`system prune` can delete unused networks and dangling images; add `-a` only when you intend to remove unused images too.

```bash
$ docker cp task-api:/app/app.py ./app.py.copied
```

### In production

Schedule cleanup for CI agents. Never run destructive prunes on production nodes without confirming volumes and named resources you still need (Chapter 07).

---

## 05.11 A Practical Debugging Loop

### In plain terms

Follow a fixed order so you do not thrash: status → logs → inspect → exec/debug → reproduce → fix the image or flags.

### Under the hood

When a container misbehaves:

1. **`docker ps -a`** — Is it running, restarting, or exited? Exit code?
2. **`docker logs`** — App error, missing module, bind failure? (Confirm logging driver supports this.)
3. **`docker inspect`** — OOMKilled, env vars, mounts, port bindings, RestartCount?
4. **`docker exec` or `docker debug`** — Only if still running (or via debug-on-image); check files, DNS, local curl.
5. **Reproduce** with `docker run --rm -it --entrypoint sh image` to debug startup.
6. **Fix the image or runtime flags**, do not “hotfix” a running cattle container as the long-term solution.

Interactive override example:

```bash
$ docker run --rm -it --entrypoint /bin/sh task-api:0.1.0
```

### In production

Write this loop into your runbook. Add “check disk for log growth” and “check platform/arch” (`exec format error`) as standing items. Escalate to orchestrator events once you move to Kubernetes (Part II).

---

## 05.12 Ephemeral Filesystems

### In plain terms

Writes to the container’s writable layer vanish when the container is removed. Treat the container disk like a whiteboard in a rented room.

### Under the hood

For the Task API’s in-memory task list, data already resets on process restart. For databases and uploads you will need **volumes** (Chapter 07). Until then, treat container disks as temporary.

```bash
$ docker run --rm task-api:0.1.0 python -c "open('/tmp/x','w').write('hi')"
# container removed: /tmp/x is gone with it
```

### In production

Decide explicitly for every path: ephemeral, bind mount (dev), or named volume (data). Accidental reliance on the writable layer is a leading cause of “we lost the database when we redeployed.”

---

## 05.13 Common Pitfalls

> ⚠️ **Common Pitfall:** Using `docker restart` as the only fix.  
> Without reading logs, you may restart forever into the same crash.

> ⚠️ **Common Pitfall:** `docker run` every experiment without `--rm` or names.  
> You accumulate exited containers and confusing name conflicts (`Conflict. The container name ... is already in use`).

> ⚠️ **Common Pitfall:** Forgetting `-p` then blaming the app.  
> Listening inside the container is not the same as publishing to the host.

> ⚠️ **Common Pitfall:** Setting `always` on a broken container.  
> Stop it explicitly (`docker stop`) and fix the image; watch `RestartCount`.

> ⚠️ **Common Pitfall:** Believing `exec` installs survive image rebuilds.  
> Anything not in the image or a volume is gone when the container is replaced.

> ⚠️ **Common Pitfall:** Leaving `json-file` logs unbounded.  
> Busy containers can exhaust disk; set `max-size` / `max-file`.

---

## 05.14 Hands-On Exercises

1. Run `task-api:0.1.0` detached with `-p 8000:8000`, verify `/healthz`, then practice `stop`, `start`, and `restart`.
2. Trigger logs with a few API requests; run `docker logs --tail 20 --timestamps task-api`.
3. Inspect the logging driver: `docker inspect -f '{{.HostConfig.LogConfig.Type}}' task-api`. Recreate the container with `--log-opt max-size=1m --log-opt max-file=2`.
4. `docker exec -it task-api /bin/sh` and run `ps aux` and a local request to `/healthz`. Exit the shell without stopping the container.
5. If `docker debug` is available in your Desktop edition, run `docker debug task-api` and try `curl` from the debug toolbox. If not available, note that in your lab journal and continue with `exec`.
6. Recreate the container with `--memory 128m --cpus 0.25 --restart on-failure:3` and observe `docker stats` and `docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' task-api`.
7. Stop and `docker rm` the container; confirm `docker ps -a` no longer lists it.
8. Start a container that exits immediately, diagnose with `ps -a` and logs, then remove it.

---

## 05.15 Check Your Understanding

**Q1.** What is the difference between `docker stop` and `docker kill`?

<details>
<summary>Show answer</summary>

`stop` sends the configured stop signal (usually SIGTERM) and allows a grace period before SIGKILL. `kill` defaults to SIGKILL immediately, giving the process no chance to shut down cleanly.

</details>

**Q2.** Why might `docker logs` be empty even though the app “logs” somewhere?

<details>
<summary>Show answer</summary>

The application may be writing to a file inside the container instead of stdout/stderr. Also, some logging drivers forward elsewhere and may not support `docker logs` the same way as `json-file` or `local`.

</details>

**Q3.** What does `--restart unless-stopped` do after a Docker daemon reboot?

<details>
<summary>Show answer</summary>

The container is started again after reboot unless you had explicitly stopped it before the reboot.

</details>

**Q4.** Does publishing `-p 8000:8000` require `EXPOSE 8000` in the Dockerfile?

<details>
<summary>Show answer</summary>

No. `EXPOSE` documents intent. `-p` publishes ports at runtime independently. Including both is still good practice for clarity.

</details>

**Q5.** When would you reach for `docker debug` instead of `docker exec`?

<details>
<summary>Show answer</summary>

When the image is slim/distroless (no shell/tools), when you want the debug toolbox, or when you need to investigate an image/container where classic `exec … sh` cannot work. Availability depends on Docker Desktop / licensing; otherwise use entrypoint overrides or other debug patterns.

</details>

**Q6.** Why are memory limits a production concern on shared hosts?

<details>
<summary>Show answer</summary>

Without limits, one container can consume available memory, cause OOM conditions, and destabilize other containers or the host.

</details>

---

## 05.16 Key Takeaways

- Master lifecycle commands: `run`, `ps`, `stop`, `start`, `restart`, `pause`, `rm`.
- Debug in order: status → logs → inspect → exec/debug → controlled reproduce.
- Configure logging drivers and rotation; apps must log to stdout/stderr.
- Publish ports explicitly; use `docker stats` and memory/CPU flags to protect the host.
- Pick restart policies deliberately; avoid restart storms on broken images.
- Container filesystems are ephemeral—persist important data with volumes (Chapter 07).

---

## 05.17 Official documentation map

| Topic | Official page |
|-------|---------------|
| `docker run` reference | [docker container run](https://docs.docker.com/reference/cli/docker/container/run/) |
| `docker logs` | [docker container logs](https://docs.docker.com/reference/cli/docker/container/logs/) |
| Configure logging drivers | [Configure logging drivers](https://docs.docker.com/engine/logging/configure/) |
| json-file driver | [JSON File logging driver](https://docs.docker.com/engine/logging/drivers/json-file/) |
| `docker debug` | [docker debug](https://docs.docker.com/reference/cli/docker/debug/) |
| Resource constraints | [Runtime options — resources](https://docs.docker.com/engine/containers/resource_constraints/) |
| Start containers automatically | [Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/) |
| Container concepts | [What is a container?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/) |

**Previous:** [Chapter 04 — Dockerfiles and Builds](04-dockerfiles-and-builds.md) | **Next:** [Chapter 06 — Docker Networking](06-docker-networking.md)
