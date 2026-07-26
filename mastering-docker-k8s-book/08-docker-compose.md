# Chapter 08 — Docker Compose

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain what problem Compose solves and why a declarative file beats a pile of `docker run` commands
> - Write a `compose.yaml` using the modern **Compose Specification** (not obsolete "v3 syntax" framing)
> - Define services, networks, and volumes, and wire them together
> - Manage configuration with environment variables, `.env` files, profiles, and overrides
> - Add health checks and readiness-based startup ordering
> - Use Compose **Watch** (`develop.watch`) for a hands-off local edit loop
> - Build and run a realistic multi-service Task API with Postgres

---

## 08.1 The orchestra score

By now you can run a container the way a musician plays an instrument. A real application is an orchestra: a web API, a database, a cache, maybe a worker — each needing the right networks, volumes, ports, and environment, started in a sensible order.

![Orchestra conductor coordinating multi-service applications](assets/analogy-orchestra.png)

*Figure 08.A: Compose is the conductor that starts each section when the score (compose.yaml) says so.*

You *could* conduct by shouting individual `docker run` lines every time. Or you could hand everyone a **score**: one document that describes each player and how they fit together.

Docker Compose is that score. You describe the application in YAML; `docker compose up` performs it. The file is *declarative and versionable* — it lives in Git, documents architecture, and makes "works on my machine" mean "works on every machine with Docker."

---

## 08.2 First contact with Compose

### In plain terms

Compose V2 ships with modern Docker as the `docker compose` subcommand (the old standalone `docker-compose` Python binary is history). One file, one command, a whole stack.

### Under the hood

Create `compose.yaml`:

```yaml
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
```

```bash
$ docker compose up -d
[+] Running 2/2
 ✔ Network myapp_default  Created
 ✔ Container myapp-web-1  Started

$ docker compose ps
NAME          IMAGE        COMMAND                  SERVICE   CREATED          STATUS          PORTS
myapp-web-1   nginx:1.27   "/docker-entrypoint.…"   web       10 seconds ago   Up 9 seconds    0.0.0.0:8080->80/tcp

$ docker compose down
[+] Running 2/2
 ✔ Container myapp-web-1  Removed
 ✔ Network myapp_default  Removed
```

Compose created a dedicated user-defined network for the project (so services can find each other by name, as in Chapter 06) and named resources after the project (directory name by default).

```mermaid
flowchart LR
  yaml["compose.yaml"] --> up["docker compose up"]
  up --> net["Project network"]
  up --> svc["Service containers"]
  up --> vols["Named volumes"]
  down["docker compose down"] --> cleanup["Remove containers + network"]
  cleanup -.->|optional -v| dropVols["Also remove volumes"]
```

*Figure 08.1: Compose turns one declarative file into networks, services, and volumes — and tears them down as a unit.*

### Clearing up "version 3": an important correction

Many tutorials start with `version: "3.8"` and talk about "v2 vs v3 syntax." **That framing is outdated.**

- Historically there were two file-format families: Compose file version 2 (standalone) and version 3 (Swarm-oriented). The top-level `version:` key selected between them.
- Those families merged into one evolving standard: the **Compose Specification**.
- Under the spec, the top-level `version:` key is **obsolete**. Modern Compose ignores it (and may warn). Features come from your Compose tool version, not a number in the file.
- Preferred filename: `compose.yaml` (`docker-compose.yml` still works for compatibility).

Write spec-style files: no `version:` key, `compose.yaml` as the name.

### In production

Commit `compose.yaml` next to the app. Treat Compose as the local and CI contract for "how this stack runs." Production at scale may move to Swarm stacks (Chapter 09) or Kubernetes (Part II), but the *declarative multi-service* habit starts here.

---

## 08.3 Services, networks, and volumes

### In plain terms

A Compose file has three main pillars — containers to run, networks that connect them, and volumes that persist data — the same concepts from Chapters 05–07, written once.

### Under the hood

```yaml
services:      # the containers to run, and how
networks:      # the user-defined networks connecting them
volumes:       # the named volumes persisting their data
```

```yaml
services:
  api:
    build: ./api
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://tasks:${DB_PASSWORD}@db:5432/tasks
    depends_on:
      - db
    networks:
      - backend

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: tasks
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: tasks
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - backend

networks:
  backend:

volumes:
  db-data:
```

The hostname `db` in the connection string works because Compose networks are user-defined networks with embedded DNS.

```mermaid
flowchart TB
  host["Host"] -->|"publish 8000:8000"| api["api service"]
  api --- backend["backend network"]
  db["db service"] --- backend
  dbVol["db-data volume"] --- db
```

*Figure 08.2: A minimal Compose topology — API and database on a private network, volume on the database, published API port only.*

### In production

Do not publish database ports unless a human tool on the host truly needs them. Keep data stores on internal networks; publish only the API (or put a reverse proxy in front).

---

## 08.4 Configuration: env, extends, overrides, profiles

### In plain terms

Keep secrets and environment-specific knobs *out of hard-coded YAML strings* where you can. Compose interpolates variables, merges files, and can gate optional services behind **profiles**.

### Under the hood

**`.env` vs `env_file:` vs `environment:`**

| Mechanism | Affects | Typical use |
|-----------|---------|-------------|
| `.env` (auto-loaded) | Interpolation *inside the Compose file* | Ports, tags, passwords for local `${VAR}` |
| `env_file:` on a service | Environment *inside that container* | Bulk app configuration |
| `environment:` on a service | Environment *inside that container* | Explicit overrides |

```bash
# .env — loaded automatically for interpolation
DB_PASSWORD=devsecret
```

```yaml
services:
  api:
    build: ./api
    env_file:
      - ./api/app.env
    environment:
      LOG_LEVEL: debug
```

Commit `compose.yaml`; add `.env` to `.gitignore` when it holds secrets.

**`extends` and multiple files:**

```yaml
# compose.yaml
services:
  api:
    extends:
      file: common.yaml
      service: base-api
    environment:
      LOG_LEVEL: debug
```

```bash
$ docker compose -f compose.yaml -f compose.prod.yaml up -d
```

Compose also auto-loads `compose.override.yaml` when present — handy for personal local tweaks.

**Profiles** — optional services in one file:

```yaml
services:
  api:
    build: ./api

  pgadmin:
    image: dpage/pgadmin4:8
    profiles: ["debug"]
```

```bash
$ docker compose up -d                     # api only
$ docker compose --profile debug up -d     # api + pgadmin
```

### In production

Use profiles for debug UIs, seed jobs, and heavy optional components — not for secretly forking prod topology. Prefer overlay files when whole *environments* differ (dev vs staging settings for the same services).

---

## 08.5 Health checks and real startup ordering

### In plain terms

`depends_on: [db]` only controls *start order*. Postgres's container can be "started" long before it accepts connections. Your API can race ahead, fail, and crash. A **health check** plus `condition: service_healthy` waits for readiness.

### Under the hood

```yaml
services:
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tasks -d tasks"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

  api:
    build: ./api
    depends_on:
      db:
        condition: service_healthy
```

`start_period` gives Postgres a grace window before failures count against `retries`.

```mermaid
flowchart LR
  composeUp["compose up"] --> startDb["Start db container"]
  startDb --> health["healthcheck: pg_isready"]
  health -->|unhealthy| wait["Wait / retry"]
  wait --> health
  health -->|healthy| startApi["Start api<br/>depends_on condition"]
  startApi --> ready["Stack ready"]
```

*Figure 08.3: Health-aware dependency ordering — the API waits until Postgres is healthy, not merely started.*

> 📘 **Deep Dive (optional):** `depends_on.condition` existed in the old Compose file v2 format, was removed in classic "v3," and returned in the Compose Specification — a concrete reason the merged spec beats the old v3 framing.

### In production

Health checks are not a substitute for application retries, but they stop the most common "API started before DB" foot-gun in local and CI stacks. Mirror the same readiness idea later with Kubernetes probes (Chapter 13).

---

## 08.6 Compose Watch and the `develop` section

### In plain terms

Bind mounts are one way to live-reload code. **Compose Watch** is another: you declare which local paths to monitor and what to do when they change — sync files into the container, rebuild the image, restart, or run a command — then leave Compose running while you edit.

### Under the hood

Add a `develop.watch` list under a service (Compose Specification `develop` attribute):

```yaml
services:
  api:
    build: ./api
    develop:
      watch:
        - path: ./api
          target: /app
          action: sync
          ignore:
            - .venv/
            - __pycache__/
        - path: ./api/requirements.txt
          action: rebuild
        - path: ./api/gunicorn.conf.py
          action: sync+restart
```

| Action | Behavior |
|--------|----------|
| `sync` | Copy changed files into the running container at `target` |
| `rebuild` | Rebuild the image (BuildKit) and recreate the service |
| `restart` | Restart the service container |
| `sync+restart` | Sync, then restart |
| `sync+exec` | Sync, then run a command inside the container |

Start watch mode:

```bash
$ docker compose up --watch --build
```

Or, if the stack is already up and you want watch events separate from build logs:

```bash
$ docker compose watch
```

Typical pattern for the Task API: **sync** Python source for instant edits; **rebuild** when dependency files change; **sync+restart** when process config changes.

```mermaid
flowchart TD
  edit["Local file change"] --> path{"Which path?"}
  path -->|app source| sync["action: sync"]
  path -->|requirements.txt| rebuild["action: rebuild"]
  path -->|process config| syncRestart["action: sync+restart"]
  sync --> running["Container updated"]
  rebuild --> recreate["Image rebuild + recreate"]
  syncRestart --> restart["Sync then restart"]
```

*Figure 08.4: Compose Watch maps path changes to sync, rebuild, or restart actions for a fast local loop.*

> 💡 **Tip:** Watch does not replace a proper image build for CI or production. It is a developer velocity tool. Keep `Dockerfile` and `compose.yaml` as the source of truth for how the service *ships*.

### In production

Do not enable watch-based workflows against production hosts. Use Watch locally (and maybe in ephemeral preview environments). Ship immutable images built in CI for anything that faces real traffic.

---

## 08.7 Putting it together: Task API and Postgres

Create this layout:

```text
task-api/
├── compose.yaml
├── .env
└── api/
    ├── Dockerfile
    ├── requirements.txt
    └── app.py
```

`api/app.py`:

```python
import os
import psycopg
from flask import Flask, jsonify, request

app = Flask(__name__)
DB_URL = os.environ["DATABASE_URL"]

def db():
    return psycopg.connect(DB_URL)

with db() as conn:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks ("
        "id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN DEFAULT FALSE)"
    )

@app.get("/tasks")
def list_tasks():
    with db() as conn:
        rows = conn.execute("SELECT id, title, done FROM tasks ORDER BY id").fetchall()
    return jsonify([{"id": r[0], "title": r[1], "done": r[2]} for r in rows])

@app.post("/tasks")
def create_task():
    title = request.get_json()["title"]
    with db() as conn:
        row = conn.execute(
            "INSERT INTO tasks (title) VALUES (%s) RETURNING id", (title,)
        ).fetchone()
    return jsonify({"id": row[0], "title": title, "done": False}), 201

@app.get("/healthz")
def healthz():
    return "ok"
```

`api/requirements.txt`:

```text
flask==3.0.3
psycopg[binary]==3.2.1
gunicorn==22.0.0
```

`api/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]
```

`.env`:

```bash
DB_PASSWORD=devsecret
```

`compose.yaml`:

```yaml
services:
  api:
    build: ./api
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgres://tasks:${DB_PASSWORD}@db:5432/tasks
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')\""]
      interval: 10s
      timeout: 3s
      retries: 3
    develop:
      watch:
        - path: ./api
          target: /app
          action: sync
          ignore:
            - __pycache__/
        - path: ./api/requirements.txt
          action: rebuild
    networks:
      - backend

  db:
    image: postgres:16
    environment:
      POSTGRES_USER: tasks
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: tasks
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tasks -d tasks"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s
    networks:
      - backend

  cache:
    image: redis:7-alpine
    profiles: ["cache"]
    networks:
      - backend

networks:
  backend:

volumes:
  db-data:
```

Bring it up and exercise it:

```bash
$ docker compose up -d --build
[+] Running 3/3
 ✔ Network task-api_backend   Created
 ✔ Container task-api-db-1    Healthy
 ✔ Container task-api-api-1   Started

$ curl -s -X POST http://127.0.0.1:8000/tasks \
    -H "Content-Type: application/json" \
    -d '{"title": "Finish chapter 8"}'
{"done":false,"id":1,"title":"Finish chapter 8"}

$ curl -s http://127.0.0.1:8000/tasks
[{"done":false,"id":1,"title":"Finish chapter 8"}]

$ docker compose logs --tail 2 api
task-api-api-1  | [2026-07-25 17:42:03 +0000] [1] [INFO] Listening at: http://0.0.0.0:8000 (1)
task-api-api-1  | [2026-07-25 17:42:03 +0000] [1] [INFO] Booting worker with pid: 7

$ docker compose down
```

For a live edit loop:

```bash
$ docker compose up --watch --build
```

Change `app.py`, save, and watch Compose sync into the container. Change `requirements.txt` and watch a rebuild.

Every concept from this chapter is in play: services, private DNS (`db`), named volume, `.env` interpolation, a profile-gated cache, health-checked ordering, and Watch for development.

---

## 08.8 Common pitfalls

1. **Cargo-culting `version: "3.8"`.** Obsolete mental model — omit `version:`.
2. **Assuming bare `depends_on` waits for readiness.** Use `condition: service_healthy`.
3. **Confusing `.env` with `env_file:`.** Interpolation vs container environment.
4. **Editing code without rebuild or Watch/bind mount.** `up -d` reuses the image until `--build`, sync, or a mount updates it.
5. **`docker compose down -v` reflexively.** Deletes project named volumes, including databases.
6. **Publishing the database port out of habit.** Prefer internal network access only.
7. **Treating Watch as a production deploy mechanism.** It is for local development.

---

## 08.9 Hands-on exercises

1. **Run the score.** Build the Task API project as shown, create three tasks with `curl`, and list them.
2. **Prove persistence.** `docker compose down` (no `-v`), then `up -d` again — tasks remain. Repeat with `down -v` and explain the difference.
3. **Break ordering, then fix it.** Use bare `depends_on: [db]` without a health check; observe API connection errors; restore the healthy condition.
4. **Use the profile.** Start with `--profile cache` and confirm Redis appears in `docker compose ps`.
5. **Layer an override.** Create `compose.override.yaml` that maps `9000:8000`, bring the stack up, verify port 9000.
6. **Watch in action.** Run `docker compose up --watch`, edit `app.py`, and confirm Compose reports a sync (or rebuild when you touch `requirements.txt`).

---

## 08.10 Check Your Understanding

**Q1.** What is wrong with starting a new Compose file with `version: "3.8"`?

<details>
<summary>Show answer</summary>

Nothing necessarily breaks, but it reflects an obsolete model. The separate v2/v3 file formats merged into the Compose Specification, and modern Compose ignores `version:` (often with a warning). Feature availability comes from your Compose version, not a number in the file.

</details>

**Q2.** Your API starts before Postgres is ready and crashes. `depends_on: [db]` is set. Why doesn't it help, and what's the fix?

<details>
<summary>Show answer</summary>

The list form only orders startup, not readiness. Add a `healthcheck` on `db` (for example `pg_isready`) and use `depends_on: { db: { condition: service_healthy } }`.

</details>

**Q3.** How does `api` reach hostname `db` with no IP addresses configured?

<details>
<summary>Show answer</summary>

Compose attaches both services to a user-defined network with embedded DNS, which resolves the service name `db` to the container IP.

</details>

**Q4.** What's the difference between `.env` and a file referenced by `env_file:`?

<details>
<summary>Show answer</summary>

`.env` supplies values for `${VARIABLE}` interpolation *within the Compose file*. `env_file:` injects environment variables *into that service's container*.

</details>

**Q5.** When would you use Compose Watch (`develop.watch`) instead of only bind mounts?

<details>
<summary>Show answer</summary>

When you want declarative, per-path behavior: sync interpreted source for fast edits, rebuild when dependency manifests change, or restart when process config changes — without always mounting the entire project tree. Bind mounts remain valid; Watch adds automated rebuild/restart/exec reactions Compose manages for you.

</details>

**Q6.** When would you reach for profiles instead of a second Compose file?

<details>
<summary>Show answer</summary>

When optional services belong to the same project and you just want to toggle them (debug UIs, seed jobs, optional caches). Separate override files fit better when whole environments differ for the same core services.

</details>

---

## 08.11 Key takeaways

- Compose turns a multi-container app into one declarative `compose.yaml`, run with `docker compose up`.
- The modern standard is the **Compose Specification**: no `version:` key, prefer `compose.yaml`, and retire "v3 syntax" as the organizing story.
- Pillars — `services`, `networks`, `volumes` — map to earlier chapters.
- Interpolate with `.env`, inject with `environment:` / `env_file:`, reshape with overrides, `extends`, and **profiles**.
- Health checks plus `depends_on.condition: service_healthy` give readiness-based ordering.
- **`develop.watch`** (Compose Watch) syncs, rebuilds, or restarts on local file changes for a fast development loop — not for production deploys.

---

## 08.12 Official documentation map

| Topic | Official page |
|-------|---------------|
| Compose overview | [Docker Compose](https://docs.docker.com/compose/) |
| Compose Specification | [Compose file reference](https://docs.docker.com/reference/compose-file/) |
| `develop` / watch attribute | [Compose file develop](https://docs.docker.com/reference/compose-file/develop/) |
| Use Compose Watch | [Use Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/) |
| Profiles | [Using profiles with Compose](https://docs.docker.com/compose/how-tos/profiles/) |
| Healthcheck | [Compose services — healthcheck](https://docs.docker.com/reference/compose-file/services/#healthcheck) |
| `depends_on` | [Compose services — depends_on](https://docs.docker.com/reference/compose-file/services/#depends_on) |
| Networking in Compose | [Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) |
| `docker compose` CLI | [docker compose](https://docs.docker.com/reference/cli/docker/compose/) |

**Previous:** [Chapter 07 — Docker Volumes and Data Persistence](07-docker-volumes-and-data.md) | **Next:** [Chapter 09 — Introduction to Docker Swarm](09-docker-swarm-intro.md)
