# Appendix A — Docker Cheatsheet

> *Mastering Docker and Kubernetes: From Zero to Production*
> Target: **Docker Engine 29.x** (Docker Engine / Docker Desktop). Commands assume a Linux container runtime.

This is a compact, task-oriented reference. Every block is tagged with the shell it runs in. Safety notes appear inline as `> ⚠️`. When in doubt, run any command with `--help` (for example, `docker run --help`) to see flags for *your* installed version — the CLI is the source of truth.

**Version awareness:** Check what you have before copying commands.

```bash
docker version          # client + server (Engine) versions
docker info             # runtime, storage driver, cgroup, contexts
docker buildx version   # BuildKit builder (bundled with Docker Engine 29.x)
```

---

## 1. Images: build, tag, inspect

```bash
# Build with BuildKit (default in Docker Engine 29.x); tag as name:version
docker build -t myapp:1.0 .

# Preferred modern builder (multi-platform, better caching)
docker buildx build -t myapp:1.0 --load .

# Build a specific stage of a multi-stage Dockerfile
docker build --target builder -t myapp:build .

# Multi-arch build pushed straight to a registry
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.com/myapp:1.0 --push .

# List, tag, inspect, and view history
docker images
docker tag myapp:1.0 registry.example.com/myapp:1.0
docker image inspect myapp:1.0
docker history myapp:1.0
```

> ⚠️ Avoid `:latest` for anything you deploy — pin explicit, immutable tags (or digests, `myapp@sha256:...`) so builds are reproducible.
> ⚠️ Never `COPY` secrets into an image layer; layers are cached and extractable. Use build secrets (`--secret`) or runtime env/secret injection instead.

---

## 2. Registry: login, pull, push

```bash
docker login registry.example.com          # prompts for credentials
docker pull nginx:1.27
docker push registry.example.com/myapp:1.0
docker logout registry.example.com
```

> ⚠️ `docker login` stores credentials in `~/.docker/config.json` (base64, *not* encrypted) unless a credential helper is configured. Use a credential store (`credsStore`) on shared machines.

---

## 3. Containers: run, manage lifecycle

```bash
# Run detached, name it, publish a port (host:container)
docker run -d --name web -p 8080:80 nginx:1.27

# Interactive shell, removed on exit
docker run --rm -it ubuntu:24.04 bash

# Common lifecycle
docker ps                 # running containers (add -a for all)
docker stop web
docker start web
docker restart web
docker rm web             # add -f to force-remove a running container
```

Secure-by-default run flags worth memorizing:

```bash
docker run -d --name api \
  --read-only \                         # immutable root filesystem
  --tmpfs /tmp \                         # writable scratch space
  --cap-drop ALL \                       # drop all Linux capabilities
  --security-opt no-new-privileges \     # block privilege escalation
  --user 10001:10001 \                   # run as non-root UID:GID
  --memory 512m --cpus 1 \               # resource limits
  myapp:1.0
```

> ⚠️ Avoid `--privileged` and mounting the Docker socket (`/var/run/docker.sock`) into containers — both are effectively root on the host.

---

## 4. Exec, logs, inspect, stats

```bash
docker exec -it web sh                # shell into a running container
docker logs -f --tail 100 web         # follow last 100 log lines
docker inspect web                    # full JSON config/state
docker inspect -f '{{.State.Health.Status}}' web   # single field via Go template
docker stats                          # live CPU/mem/net per container
docker top web                        # processes inside the container
docker diff web                       # filesystem changes vs. image
```

---

## 5. Data: volumes and bind mounts

```bash
docker volume create appdata
docker run -d -v appdata:/var/lib/data myapp:1.0     # named volume
docker run -d -v "$(pwd)/site:/usr/share/nginx/html:ro" nginx:1.27   # bind mount, read-only
docker volume ls
docker volume inspect appdata
docker volume rm appdata
```

> ⚠️ Named volumes are managed by Docker and survive container removal. Bind mounts expose host paths directly — use `:ro` for anything the container shouldn't write.

---

## 6. Networking

```bash
docker network create appnet                          # user-defined bridge (DNS by name)
docker run -d --name db --network appnet postgres:17
docker run -d --name api --network appnet myapp:1.0   # api reaches db at hostname "db"
docker network ls
docker network inspect appnet
docker network connect appnet web
docker network disconnect appnet web
```

> ⚠️ Containers on the default `bridge` network cannot resolve each other by name. Create a user-defined network for automatic DNS-based service discovery.

---

## 7. Dockerfile essentials

```dockerfile
# Multi-stage: build in a fat image, ship a slim one
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim
# Create and switch to a non-root user
RUN useradd --system --uid 10001 appuser
WORKDIR /app
COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser . .
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"
ENTRYPOINT ["python", "app.py"]
```

Key instruction reminders:

- `COPY` over `ADD` unless you need URL/tar auto-extraction (`ADD` has surprising behavior).
- Order layers cheap→expensive: copy dependency manifests and install *before* copying source, so code changes don't bust the dependency cache.
- Prefer exec-form `ENTRYPOINT ["exec","arg"]` so signals (SIGTERM) reach your process directly.
- Add a `.dockerignore` to keep `.git`, secrets, and `node_modules`/`__pycache__` out of the build context.

> ⚠️ Every `RUN` creating temp files should clean up in the *same* layer (`&& rm -rf ...`), otherwise the data stays in a lower layer even after deletion.

---

## 8. BuildKit caching & build secrets

```bash
# Mount a build-time secret without baking it into a layer
docker build --secret id=pipconf,src=$HOME/.pip/pip.conf -t myapp:1.0 .

# Use a cache mount inside the Dockerfile (BuildKit):
#   RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# Export/import build cache with a registry (great for CI)
docker buildx build --cache-to type=registry,ref=registry.example.com/myapp:cache \
                    --cache-from type=registry,ref=registry.example.com/myapp:cache \
                    -t myapp:1.0 --push .
```

---

## 9. Docker Compose (v2, the `docker compose` subcommand)

```bash
docker compose up -d              # start stack defined in compose.yaml
docker compose ps
docker compose logs -f api
docker compose exec api sh
docker compose build --no-cache
docker compose down               # stop + remove; add -v to also drop volumes
docker compose config             # validate & render the effective config
```

Minimal `compose.yaml`:

```yaml
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://db:5432/app
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      retries: 5
secrets:
  db_password:
    file: ./db_password.txt
```

> ⚠️ The top-level `version:` key is obsolete in Compose v2 — omit it. Compose reads `compose.yaml`/`compose.yml` by default.

---

## 10. Cleanup & disk usage

```bash
docker system df                  # where disk is going (images/containers/volumes/cache)
docker image prune               # remove dangling images
docker container prune           # remove stopped containers
docker builder prune             # clear BuildKit cache
docker system prune -a --volumes # AGGRESSIVE: removes all unused images, networks, volumes
```

> ⚠️ `docker system prune -a --volumes` deletes **all** unused images *and* volumes — including data not attached to a running container. Double-check before running it on any host that holds real data.

---

## 11. Save / load / export (offline transfer)

```bash
docker save myapp:1.0 -o myapp.tar          # image (with layers/metadata) → tar
docker load -i myapp.tar                     # restore an image tar
docker export web -o web-fs.tar              # container filesystem only (no history)
docker import web-fs.tar myapp:imported
```

> ⚠️ `save`/`load` preserve image history and tags; `export`/`import` flatten to a single layer and drop metadata. Use `save`/`load` for real image distribution.

---

## 12. Quick troubleshooting reflexes

| Symptom | First thing to check |
| --- | --- |
| Container exits immediately | `docker logs <name>`; is the main process foregrounded? |
| "port is already allocated" | `docker ps` for the conflicting publish, or change the host port |
| Can't reach another container by name | Are both on the same *user-defined* network? |
| Build ignores your code change | Layer cache; reorder `COPY`, or `--no-cache` |
| Image huge | `docker history`; adopt multi-stage + slim base + `.dockerignore` |
| Permission denied on volume | UID mismatch; align `--user` with file ownership |
| Images "disappeared" after Engine change | Image store backend switch; see Appendix G / Chapter 27 |

---

## 13. Build attestations, Bake, and Scout (Engine 29.x)

```bash
# Multi-platform build with SBOM + provenance attestations (push required for attestations)
docker buildx build --platform linux/amd64,linux/arm64 \
  --sbom=true --provenance=mode=max \
  -t registry.example.com/myapp:1.0 --push .

# Bake: declare targets in docker-bake.hcl / compose-bake
docker buildx bake
docker buildx bake --print          # show the resolved build plan

# Vulnerability scanning (Scout CLI / Docker Desktop integration)
docker scout cves myapp:1.0
docker scout quickview myapp:1.0
```

> ⚠️ Attestations are most useful when images are pushed to a registry that preserves OCI referrers. Local `--load` of multi-platform + attestations is limited—use `--push` in CI.

---

**Prev:** [Chapter 33 — Day-2 Operations and SRE](../33-day2-operations-and-sre.md) · **Next:** [Appendix B — kubectl Cheatsheet](b-cheatsheet-kubectl.md)
