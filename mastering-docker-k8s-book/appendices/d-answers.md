# Appendix D — Answers

> *Mastering Docker and Kubernetes: From Zero to Production*

## Where the chapter answers live

Throughout this book, exercise answers are **inline**, right where you need them. Each chapter presents its exercises and then works through the solution in the same section — with the reasoning, the commands, and the "why," not just the final result. That keeps the answer next to the context that makes it meaningful, and it's why there is no long answer key reproduced here.

If you're looking for a specific chapter's solution, return to that chapter and read the "Exercise" and the walkthrough that immediately follows it. The cheat sheets in [Appendix A](a-cheatsheet-docker.md) and [Appendix B](b-cheatsheet-kubectl.md) collect the commands those solutions use.

What *does* deserve a single consolidated place is the **capstone** — because it spans every skill in the book at once. The rest of this appendix is a compact, end-to-end reference solution for it.

---

## Capstone solution — Containerize and deploy the Flask Task API

**Goal:** take a small Python **Flask Task API**, containerize it with a secure image, and deploy it to Kubernetes (1.36) with a Deployment, Service, ConfigMap, Secret, and Ingress — then verify and clean up.

This is *a* correct solution, not the only one. It favors secure defaults: a non-root, read-only container; pinned base images; resource limits; health probes; and configuration/secrets kept out of the image.

### Project layout

```text
task-api/
├── app.py
├── requirements.txt
├── Dockerfile
├── .dockerignore
└── k8s/
    ├── configmap.yaml
    ├── secret.yaml
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

### `app.py`

A minimal in-memory Task API with a health endpoint. It reads configuration from the environment (never hard-coded), including a token pulled from a Secret. Served by a production WSGI server (gunicorn), not the Flask dev server.

```python
import os
from flask import Flask, jsonify, request, abort

app = Flask(__name__)

# Configuration comes from the environment (ConfigMap + Secret), with safe defaults.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info")
API_TOKEN = os.environ.get("API_TOKEN")  # injected from a Secret; required to mutate

app.logger.setLevel(LOG_LEVEL.upper())

# Simple in-memory store; fine for a capstone. Swap for a real DB in production.
_tasks = {}
_next_id = 1


def _require_token():
    if not API_TOKEN:
        abort(500, description="API_TOKEN is not configured")
    if request.headers.get("Authorization") != f"Bearer {API_TOKEN}":
        abort(401, description="missing or invalid token")


@app.get("/healthz")
def healthz():
    # Liveness/readiness probe target: no auth, no dependencies.
    return jsonify(status="ok"), 200


@app.get("/tasks")
def list_tasks():
    return jsonify(tasks=list(_tasks.values())), 200


@app.post("/tasks")
def create_task():
    _require_token()
    global _next_id
    body = request.get_json(silent=True) or {}
    title = body.get("title")
    if not title:
        abort(400, description="'title' is required")
    task = {"id": _next_id, "title": title, "done": False}
    _tasks[_next_id] = task
    _next_id += 1
    return jsonify(task), 201


@app.delete("/tasks/<int:task_id>")
def delete_task(task_id):
    _require_token()
    if task_id not in _tasks:
        abort(404, description="task not found")
    del _tasks[task_id]
    return "", 204


if __name__ == "__main__":
    # Only used for local dev; in the container gunicorn serves the app.
    app.run(host="127.0.0.1", port=8080)
```

### `requirements.txt`

Pin versions so builds are reproducible.

```text
flask==3.1.0
gunicorn==23.0.0
```

### `.dockerignore`

Keep the build context small and free of junk/secrets.

```text
.git
.gitignore
__pycache__/
*.pyc
.venv/
k8s/
*.md
```

### `Dockerfile`

Multi-stage, slim base, non-root user, and a healthcheck. gunicorn binds to all interfaces *inside the container* (the container is the security boundary; Kubernetes controls exposure).

```dockerfile
# ---- build stage: install deps into an isolated prefix ----
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- runtime stage: minimal, non-root ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 appuser
WORKDIR /app
COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser app.py .
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"
# 2 workers is a reasonable default for a small API; tune to CPU limits.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "app:app"]
```

### Build and test the image locally

```bash
cd task-api
docker build -t task-api:1.0 .

# Smoke test the container before touching Kubernetes.
docker run --rm -d --name task-api -p 8080:8080 -e API_TOKEN=devtoken task-api:1.0
curl -s localhost:8080/healthz                                   # {"status":"ok"}
curl -s -X POST localhost:8080/tasks \
  -H "Authorization: Bearer devtoken" \
  -H "Content-Type: application/json" \
  -d '{"title":"write the capstone"}'                            # 201 + task JSON
docker rm -f task-api
```

Push it to a registry your cluster can pull from (replace the host):

```bash
docker tag task-api:1.0 registry.example.com/task-api:1.0
docker push registry.example.com/task-api:1.0
```

> If you're on a local cluster, load the image directly instead of pushing:
> `kind load docker-image task-api:1.0` or `minikube image load task-api:1.0`.

---

## Kubernetes manifests (1.36, GA APIs)

### `k8s/configmap.yaml` — non-sensitive config

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: task-api-config
  labels:
    app: task-api
data:
  LOG_LEVEL: "info"
```

### `k8s/secret.yaml` — sensitive config

`stringData` lets you write plaintext; Kubernetes stores it base64-encoded. In real projects, generate this out-of-band (or use an external secret manager) and never commit real values.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: task-api-secret
  labels:
    app: task-api
type: Opaque
stringData:
  API_TOKEN: "change-me-to-a-strong-random-value"
```

> ⚠️ Secrets are base64-encoded, **not** encrypted by default. Enable encryption at rest, restrict RBAC on the `secrets` resource, and prefer Sealed Secrets / External Secrets Operator / cloud KMS for production. Rotate `API_TOKEN` by updating the Secret and running `kubectl rollout restart deploy/task-api`.

### `k8s/deployment.yaml`

Two replicas, pinned image, resource requests/limits, probes, and a hardened `securityContext` compatible with the `restricted` Pod Security Standard.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
  labels:
    app: task-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: task-api
  template:
    metadata:
      labels:
        app: task-api
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: task-api
          image: registry.example.com/task-api:1.0   # or task-api:1.0 for a loaded local image
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: task-api-config
          env:
            - name: API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: task-api-secret
                  key: API_TOKEN
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
```

### `k8s/service.yaml`

A stable in-cluster address (`ClusterIP`) that load-balances across the pods.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: task-api
  labels:
    app: task-api
spec:
  type: ClusterIP
  selector:
    app: task-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

### `k8s/ingress.yaml`

External HTTP routing. Requires an ingress controller in the cluster.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: task-api
  labels:
    app: task-api
spec:
  rules:
    - host: task-api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: task-api
                port:
                  number: 80
```

> ⚠️ `Ingress` needs a controller (e.g. ingress-nginx) installed and a DNS record (or `/etc/hosts` entry) pointing `task-api.example.com` at the controller's external IP. Without a controller, use `kubectl port-forward svc/task-api 8080:80` to reach the app.

---

## Deploy

Apply in dependency order (config/secret before the workload) — or just apply the directory, since `kubectl apply -f` handles the set:

```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
# equivalently:
kubectl apply -f k8s/
```

## Verify

```bash
kubectl rollout status deploy/task-api            # wait for a healthy rollout
kubectl get pods -l app=task-api -o wide          # 2/2 Running
kubectl get svc task-api                          # ClusterIP + port 80
kubectl get endpoints task-api                    # should list 2 pod IPs
kubectl get ingress task-api

# Functional check without depending on Ingress/DNS:
kubectl port-forward svc/task-api 8080:80 &
curl -s localhost:8080/healthz                    # {"status":"ok"}
TOKEN=$(kubectl get secret task-api-secret -o jsonpath='{.data.API_TOKEN}' | base64 -d)
curl -s -X POST localhost:8080/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"deployed to k8s"}'                # 201 Created
curl -s localhost:8080/tasks                      # lists the task
kill %1                                            # stop the port-forward
```

If anything is unhealthy, the two reflex commands from Appendix B solve most of it:

```bash
kubectl describe pod -l app=task-api      # events: scheduling, pulls, probe failures
kubectl logs -l app=task-api --tail=100   # application output
```

## Clean up

```bash
kubectl delete -f k8s/                    # remove everything this capstone created
# or individually:
kubectl delete ingress task-api
kubectl delete service task-api
kubectl delete deployment task-api
kubectl delete configmap task-api-config
kubectl delete secret task-api-secret
```

Local Docker cleanup:

```bash
docker image rm task-api:1.0 registry.example.com/task-api:1.0
```

That's the full loop the book builds toward: a secure image, declarative manifests, a verified deployment, and a clean teardown. Re-run it from memory on a local cluster (see [Appendix C](c-further-resources.md)) until each step feels routine.

---

**Prev:** [Appendix C — Further Resources](c-further-resources.md) · **Next:** [Appendix E — Glossary](e-glossary.md)
