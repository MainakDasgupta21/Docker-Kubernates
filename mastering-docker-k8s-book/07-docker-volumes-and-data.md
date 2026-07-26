# Chapter 07 — Docker Volumes and Data Persistence

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain why data written inside a container disappears when the container is removed
> - Choose among named volumes, bind mounts, and tmpfs mounts for a given job
> - Manage volumes with the `docker volume` command family
> - Contrast the **containerd image store** (Engine 29.x default on fresh installs) with legacy **graph drivers** such as `overlay2`
> - Back up and restore volume data with a dependable pattern

---

## 07.1 The whiteboard and the filing cabinet

Think of a container's writable layer as a **whiteboard in a rented meeting room**. You can scribble during the meeting; when the booking ends and the room resets, the board is wiped. Removing a container deletes its writable layer the same way.

A **volume** is a filing cabinet that lives *outside* the meeting room. Wheel it in, store documents, wheel it out. Reset the room a hundred times — the cabinet survives.

Containers are disposable on purpose. You want to delete and recreate freely for upgrades and fixes. Data that must outlive any single container therefore needs a mount Docker's lifecycle cannot erase. Choosing the right mount — and understanding what still lives under the image store — is the skill of this chapter.

---

## 07.2 Watching data disappear

### In plain terms

If you write a file inside a container and then `docker rm` that container, the file is gone. A *stopped* container keeps its writable layer; a *removed* container does not.

### Under the hood

```bash
$ docker run -it --name scratch alpine:3.20 sh
/ # echo "important data" > /notes.txt
/ # exit

$ docker rm scratch
scratch

$ docker run -it --name scratch alpine:3.20 sh
/ # cat /notes.txt
cat: can't open '/notes.txt': No such file or directory
```

Same image, same name — brand-new writable layer. The file is gone.

### In production

Treat the container filesystem as ephemeral scratch. Persist deliberately with volumes (or bind mounts in carefully controlled cases). Databases that write only to the writable layer are a production incident waiting to happen.

---

## 07.3 Named volumes

### In plain terms

A **named volume** is Docker-managed storage you refer to by name. You do not care where it lives on disk; Docker places it under its data root and keeps it when containers come and go.

### Under the hood

```bash
$ docker volume create app-data
app-data

$ docker run -d --name db \
    -v app-data:/var/lib/postgresql/data \
    -e POSTGRES_PASSWORD=devsecret \
    postgres:16
```

```bash
$ docker volume ls
DRIVER    VOLUME NAME
local     app-data

$ docker volume inspect app-data
```

```json
[
    {
        "CreatedAt": "2026-07-25T17:10:42Z",
        "Driver": "local",
        "Labels": null,
        "Mountpoint": "/var/lib/docker/volumes/app-data/_data",
        "Name": "app-data",
        "Options": null,
        "Scope": "local"
    }
]
```

If you mount a *new, empty* named volume over a directory that already contains files in the image, Docker copies those image files into the volume first. Bind mounts do not — they simply hide the image content.

Prefer the explicit `--mount` form in scripts:

```bash
$ docker run -d --name db \
    --mount type=volume,source=app-data,target=/var/lib/postgresql/data \
    -e POSTGRES_PASSWORD=devsecret \
    postgres:16
```

### In production

Name every volume that holds real data. Prefer named volumes for databases and application state. Avoid anonymous volumes from bare `VOLUME` instructions when you care about finding and backing up the data later — they are easy to lose track of, and `docker rm -v` deletes them with the container.

---

## 07.4 Bind mounts

### In plain terms

A **bind mount** maps a specific host path into the container. Edit files on your laptop; the container sees the change immediately. That tight loop is why bind mounts dominate local development.

### Under the hood

```bash
$ docker run -d --name devweb \
    -v "$(pwd)/site:/usr/share/nginx/html:ro" \
    -p 8080:80 \
    nginx:1.27
```

The `:ro` suffix mounts read-only — a good habit when the container only needs to read.

Verbose form (fails loudly if the source path is missing):

```bash
$ docker run -d --mount type=bind,source="$(pwd)/site",target=/usr/share/nginx/html,readonly nginx:1.27
```

`--mount` is preferred in scripts and docs; `-v` is fine at the keyboard.

### In production

Bind mounts depend on host directory layout, skip copy-on-first-mount, and share raw UID/GID with the host. That makes them less portable and more permission-sensitive than named volumes. Use them for live source and host config in development; prefer named volumes (or Kubernetes PVCs later) for production state.

> ⚠️ **Common Pitfall:** Binding an empty host directory over a path that had files in the image *hides* those files. If the app's config directory suddenly looks empty, check your mounts.

---

## 07.5 tmpfs mounts

### In plain terms

A **tmpfs** mount lives in RAM. Fast, never written to disk, gone when the container stops. Ideal for scratch, caches, or secrets you do not want lingering on disk.

### Under the hood

```bash
$ docker run -d --name worker \
    --tmpfs /scratch:rw,size=100m \
    my-batch-job:1.0
```

tmpfs mounts are Linux-oriented in classic Engine usage and cannot be shared between containers the way named volumes can.

### In production

Pair tmpfs with `--read-only` root filesystems (Chapter 10) so temporary paths still work. Size the mount; unbounded tmpfs can pressure host memory under load.

<!-- VISUAL: Host showing named volume under Docker-managed area, bind mount from host path, tmpfs in RAM -->

---

## 07.6 Choosing the right mount

| | Named volume | Bind mount | tmpfs |
|---|---|---|---|
| Managed by | Docker | You (host path) | Kernel (RAM) |
| Survives container removal | Yes | Yes (host files remain) | No |
| Portable across hosts | Yes (by name) | No (path-based) | Not applicable |
| Pre-populated from image | Yes (if empty) | No (hides image files) | No |
| Best for | Databases, app state | Live source in dev, host configs | Secrets, caches, temp files |
| Example | `-v data:/path` | `-v /host:/path` | `--tmpfs /path` |

**Rule of thumb:** volumes for data you care about, bind mounts for development convenience, tmpfs for data you explicitly do not want persisted.

---

## 07.7 Image storage: containerd image store vs overlay2

Volumes hold the data you deliberately persist. Image layers and the container's writable layer are managed by Docker's **image/storage backend** — a different concern that changed significantly in **Docker Engine 29.x**.

### In plain terms

Think of image layers as floors of a building and the running container as a temporary rooftop patio. The patio can change; the floors underneath stay shared and read-only until someone rewrites a tile — then Docker copies that tile onto the patio first (**copy-on-write**). Volumes are a separate filing cabinet bolted on from outside the building: they bypass that copy-on-write path for native-speed I/O.

### Under the hood

#### Fresh Engine 29.x installs: containerd image store

On **fresh installs of Docker Engine 29.0 and later**, the default backend is the **containerd image store**, which uses containerd **snapshotters** (commonly `overlayfs`) instead of the classic Docker **graph drivers**.

```bash
$ docker info --format 'Driver={{.Driver}}'
Driver=overlayfs
```

Content for the containerd image store typically lives under **`/var/lib/containerd`** (plus related Docker state under `/var/lib/docker`). Multi-platform images and attestations are first-class citizens on this path.

Enable or confirm via `/etc/docker/daemon.json` when migrating an older daemon:

```json
{
  "features": {
    "containerd-snapshotter": true
  }
}
```

After changing daemon configuration, restart Docker and re-check `docker info`.

#### Upgrades and legacy graph drivers

If you **upgraded** from an earlier Engine, the daemon often continues using the classic **`overlay2`** graph driver until you migrate:

```bash
$ docker info --format 'Driver={{.Driver}}'
Driver=overlay2
```

Legacy graph drivers remain available for compatibility but are **deprecated**. New installs can still opt out and force a classic driver if required, but plan on the containerd image store as the future default.

> 📘 **Deep Dive (optional):** Classic storage-driver docs still describe `overlay2`, `btrfs`, and friends for upgraded systems. Treat that material as migration context, not as the Engine 29 greenfield default.

#### Migration side effect: hidden local images

When you switch to the containerd image store, existing images and containers from `overlay2` **remain on disk but become hidden**. They reappear if you switch back. To keep using them under the new store, **push to a registry** first or use `docker save` / `docker load`.

#### Incompatibility: userns-remap

The containerd image store is **incompatible with `userns-remap`**. If your security posture depends on user namespace remapping, either stay on a supported classic graph-driver configuration for now, move to **rootless Docker**, or redesign remapping before enabling the containerd image store. Do not flip the feature flag on a remapped daemon without a tested plan.

### In production

1. **Write-heavy workloads belong on volumes.** Copy-on-write on the image store is the wrong place for database files and high-churn queues.
2. **Plan migrations.** Push or save local images before enabling the containerd image store; expect a temporary empty `docker images` list after the switch.
3. **Know your data roots.** Monitor disk on both `/var/lib/docker` and `/var/lib/containerd` after Engine 29 fresh installs or migrations.
4. **Do not reconfigure weekly.** Prefer volumes and registry workflows over chasing storage-driver micro-optimizations.
5. **Document remapping.** If `userns-remap` is required, treat containerd image store enablement as a blocked change until remapping is retired or replaced.

> 💡 **Tip:** On Docker Desktop, the containerd image store is already the default on modern clean installs. Desktop users usually do not edit graph-driver settings the way Linux Engine admins do.

---

## 07.8 Backup and restore

### In plain terms

Do not dig through `/var/lib/docker` by hand. Run a short-lived helper container that mounts the volume and a host backup directory, then archive with `tar`.

### Under the hood

**Backup:**

```bash
$ docker run --rm \
    -v app-data:/source:ro \
    -v "$(pwd)/backups:/backup" \
    alpine:3.20 \
    tar czf /backup/app-data-2026-07-25.tar.gz -C /source .

$ ls backups/
app-data-2026-07-25.tar.gz
```

**Restore:**

```bash
$ docker volume create app-data-restored

$ docker run --rm \
    -v app-data-restored:/target \
    -v "$(pwd)/backups:/backup:ro" \
    alpine:3.20 \
    tar xzf /backup/app-data-2026-07-25.tar.gz -C /target
```

Then start the application against `app-data-restored` and verify.

**Housekeeping:**

```bash
$ docker volume rm old-data
$ docker volume prune
```

`docker volume prune` removes unused *anonymous* volumes by default; `--all` also removes unused *named* volumes — think twice.

### In production

A file-level copy of a *running* database can capture a torn, inconsistent state. Stop the container first, or — better — use the database's own tooling (`pg_dump`, `mysqldump`) and archive that output. Automate backups; test restores on a schedule, not on incident day.

---

## 07.9 Common pitfalls

1. **Database files in the writable layer.** Works until `docker rm` — then everything is gone.
2. **Assuming volumes always survive.** Anonymous volumes are easy to lose; `docker rm -v` deletes them.
3. **Bind-mounting over required image paths.** Empty host dirs hide image content.
4. **UID/GID clashes on bind mounts.** Match container user to host ownership (and SELinux `:z` / `:Z` when applicable).
5. **Backing up a live database at the file level.** Use dumps or stop first.
6. **Casual `docker volume prune --all`.** Unused does not mean unwanted.
7. **Enabling the containerd image store without migrating images.** Local images appear to vanish.
8. **Enabling the containerd image store with `userns-remap`.** Unsupported combination.

---

## 07.10 Hands-on exercises

1. **Reproduce data loss.** Write a file in Alpine, remove the container, recreate, confirm the file is gone.
2. **Persist with a named volume.** Create `notes-data`, write under `/notes`, remove the container, start another with the same mount, confirm survival.
3. **Live-edit with a bind mount.** Serve a local `site/index.html` with nginx (`:ro` mount, `-p 8080:80`), edit on the host, refresh.
4. **Full backup/restore cycle.** Tar-backup `notes-data`, delete the volume, restore into a new volume, verify contents.
5. **Observe copy-on-first-mount.** Mount a new named volume at `/etc/nginx` in nginx; list the volume contents. Repeat with an empty bind mount and compare.
6. **Identify your backend.** Run `docker info --format 'Driver={{.Driver}}'` and record whether you are on `overlayfs` (containerd image store) or legacy `overlay2`. Note which data directories exist under `/var/lib/docker` and `/var/lib/containerd` on a Linux Engine host.

---

## 07.11 Check Your Understanding

**Q1.** Why does data written inside a container disappear, and when exactly is it lost?

<details>
<summary>Show answer</summary>

Writes go to the container's writable layer, which belongs to that specific container. The data survives stops and restarts of the same container but is destroyed when the container is *removed* (`docker rm`), because the writable layer is deleted with it.

</details>

**Q2.** You're developing a Node.js app and want code changes on your laptop to appear in the container immediately. Volume, bind mount, or tmpfs?

<details>
<summary>Show answer</summary>

A bind mount. It maps your working directory straight into the container. Named volumes are Docker-managed and awkward to edit from the host; tmpfs does not persist or share host files.

</details>

**Q3.** What's the key behavioral difference when mounting an *empty* named volume versus an *empty* bind-mounted directory over a path that contains files in the image?

<details>
<summary>Show answer</summary>

An empty named volume is pre-populated from the image on first mount. An empty bind mount simply covers the path, so the application sees an empty directory.

</details>

**Q4.** What is the default image storage backend on a fresh Docker Engine 29.x install, and how does that differ from many upgraded daemons?

<details>
<summary>Show answer</summary>

Fresh Engine 29.x installs default to the **containerd image store** (snapshotters such as `overlayfs`, content often under `/var/lib/containerd`). Many upgraded daemons still run the legacy **`overlay2`** graph driver until you migrate. Graph drivers are deprecated; plan the move and note that the containerd image store is incompatible with `userns-remap`.

</details>

**Q5.** Why should databases use a volume rather than the writable layer, even ignoring persistence?

<details>
<summary>Show answer</summary>

Performance. The writable layer goes through copy-on-write machinery on the image store, which is slow for frequent or large writes. Volume I/O bypasses that path and behaves like native host filesystem access.

</details>

**Q6.** Sketch the backup pattern for a named volume in one sentence.

<details>
<summary>Show answer</summary>

Run a temporary container that mounts the volume read-only and bind-mounts a host directory, then run `tar` inside it to archive the volume into the host directory (and reverse the mounts and extract to restore).

</details>

---

## 07.12 Key takeaways

- The container writable layer is disposable; data that must outlive a container belongs in a mount.
- **Named volumes** for real data, **bind mounts** for development convenience, **tmpfs** for RAM-only scratch.
- An empty named volume can be pre-populated from the image; a bind mount hides image content instead.
- **Engine 29.x fresh installs** default to the **containerd image store**; legacy **`overlay2`** graph drivers remain on many upgrades but are **deprecated**. Content lives under paths such as `/var/lib/containerd`; the store is **incompatible with `userns-remap`**.
- Back up volumes with a throwaway container plus `tar`; for databases, prefer native dump tools or stop first.

---

## 07.13 Official documentation map

| Topic | Official page |
|-------|---------------|
| Volumes | [Volumes](https://docs.docker.com/engine/storage/volumes/) |
| Bind mounts | [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) |
| tmpfs mounts | [tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/) |
| Storage overview | [Storage](https://docs.docker.com/engine/storage/) |
| containerd image store | [containerd image store](https://docs.docker.com/engine/storage/containerd/) |
| Select a storage driver (classic) | [Select a storage driver](https://docs.docker.com/engine/storage/drivers/select-storage-driver/) |
| Deprecated Engine features | [Deprecated features](https://docs.docker.com/engine/deprecated/) |
| `docker volume` CLI | [docker volume](https://docs.docker.com/reference/cli/docker/volume/) |

**Previous:** [Chapter 06 — Docker Networking](06-docker-networking.md) | **Next:** [Chapter 08 — Docker Compose](08-docker-compose.md)
