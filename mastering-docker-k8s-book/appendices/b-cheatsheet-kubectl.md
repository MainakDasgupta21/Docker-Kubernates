# Appendix B — kubectl Cheatsheet

> *Mastering Docker and Kubernetes: From Zero to Production*
> Target: **Kubernetes 1.36**. Commands use stable (GA) APIs unless noted.

Compact, task-grouped reference for day-to-day cluster work. Blocks are tagged by shell. Safety notes appear inline as `> ⚠️`. The definitive flag list for your version is always `kubectl <cmd> --help`, and `kubectl explain <resource>` documents every field of an object schema.

**Version awareness:** kubectl supports servers within ±1 minor version. Confirm both before trusting a manifest's `apiVersion`.

```bash
kubectl version                 # client + server versions
kubectl api-resources           # every resource kind + its apiVersion + short name
kubectl api-versions            # served API group/versions on THIS cluster
kubectl explain deployment.spec.template.spec.containers   # schema for a field path
```

---

## 1. Context & configuration

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config use-context prod-cluster
kubectl config set-context --current --namespace=team-a   # default namespace for this context
```

> ⚠️ Always confirm `current-context` before running mutating commands — the same command against the wrong cluster is the classic outage. Consider a shell prompt that shows context/namespace.

---

## 2. Viewing & finding resources

```bash
kubectl get pods                          # add -A / --all-namespaces for cluster-wide
kubectl get pods -o wide                  # node, IP, and more columns
kubectl get pods -l app=api               # filter by label selector
kubectl get deploy,svc,ingress -n team-a  # multiple kinds at once
kubectl get pod mypod -o yaml             # full manifest
kubectl get pod mypod -o jsonpath='{.status.podIP}'
kubectl describe pod mypod                # events + config, best first debugging step
kubectl get events --sort-by=.lastTimestamp
```

Watch and wait:

```bash
kubectl get pods -w                                  # stream changes
kubectl rollout status deploy/api                    # block until rollout completes
kubectl wait --for=condition=Ready pod -l app=api --timeout=120s
```

---

## 3. Creating & applying resources

```bash
kubectl apply -f manifest.yaml            # declarative; idempotent create/update
kubectl apply -f ./k8s/                    # apply a whole directory
kubectl apply -k ./overlays/prod           # Kustomize overlay
kubectl diff -f manifest.yaml              # preview what apply would change
kubectl delete -f manifest.yaml
```

> ⚠️ Prefer declarative `apply` (version-controlled manifests) over imperative `create`/`edit` in real environments — imperative changes drift from Git and get overwritten by the next apply.

Imperative generators are still handy for scaffolding — emit YAML, then commit it:

```bash
kubectl create deployment api --image=myapp:1.0 --dry-run=client -o yaml > deploy.yaml
kubectl create configmap app-config --from-literal=LOG_LEVEL=info --dry-run=client -o yaml
kubectl expose deployment api --port=80 --target-port=8080 --dry-run=client -o yaml
```

---

## 4. Logs, exec, and debugging

```bash
kubectl logs api-abc123                    # single pod
kubectl logs -f deploy/api                 # follow logs from a Deployment's pods
kubectl logs api-abc123 -c sidecar         # a specific container
kubectl logs api-abc123 --previous         # logs from the last crashed instance
kubectl exec -it api-abc123 -- sh          # shell into a container
kubectl cp api-abc123:/etc/config ./config # copy files out of a pod

# Ephemeral debug container (no shell in a distroless image? use this)
kubectl debug -it api-abc123 --image=busybox:1.36 --target=api
```

> ⚠️ `kubectl exec`/`debug` grant interactive access to a live workload — treat it like SSH to production. It should be audited and rare in a healthy system.

---

## 5. Port-forward & proxy (local access)

```bash
kubectl port-forward svc/api 8080:80       # localhost:8080 -> Service port 80
kubectl port-forward pod/api-abc123 5000:5000
kubectl proxy                              # authenticated proxy to the API server on :8001
```

> ⚠️ `port-forward` is for debugging/dev only. Never make it part of a production ingress path.

---

## 6. Rollouts, scaling & self-healing

```bash
kubectl rollout status deploy/api
kubectl rollout history deploy/api
kubectl rollout undo deploy/api                       # roll back to previous revision
kubectl rollout undo deploy/api --to-revision=3
kubectl rollout restart deploy/api                    # re-create pods (e.g., to pick up a Secret)

kubectl scale deploy/api --replicas=5
kubectl autoscale deploy/api --min=2 --max=10 --cpu-percent=70   # creates an HPA
```

Set a new image without editing YAML by hand (record it in Git afterward):

```bash
kubectl set image deploy/api api=myapp:1.1
```

> ⚠️ A rollout only progresses if new pods become Ready. If it's stuck, check readiness probes and `kubectl describe`/`logs` before forcing anything.

---

## 7. Config & secrets

```bash
kubectl create configmap app-config --from-literal=LOG_LEVEL=info --from-file=./app.conf
kubectl create secret generic db-secret --from-literal=password='s3cr3t'
kubectl create secret tls web-tls --cert=tls.crt --key=tls.key
kubectl get secret db-secret -o jsonpath='{.data.password}' | base64 -d   # decode one value
```

> ⚠️ Kubernetes Secrets are **base64-encoded, not encrypted** at rest by default. Enable [encryption at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/), restrict RBAC on `secrets`, and never commit real secret values to Git. Prefer an external manager (Sealed Secrets, External Secrets Operator, cloud KMS) for production.

---

## 8. Namespaces, labels & annotations

```bash
kubectl create namespace team-a
kubectl label pod api-abc123 tier=backend
kubectl label pod api-abc123 tier-               # remove the "tier" label (trailing dash)
kubectl annotate deploy/api kubernetes.io/change-cause="bump to 1.1"
kubectl get pods -l 'env in (prod,staging),tier=backend'   # set-based selector
```

---

## 9. Nodes & scheduling

```bash
kubectl get nodes -o wide
kubectl describe node <node>
kubectl top nodes                 # requires metrics-server
kubectl top pods -A
kubectl cordon <node>             # mark unschedulable (no new pods)
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data   # evict pods for maintenance
kubectl uncordon <node>           # allow scheduling again
kubectl taint nodes <node> dedicated=gpu:NoSchedule
```

> ⚠️ `drain` evicts running pods — respect PodDisruptionBudgets and do it one node at a time. `--delete-emptydir-data` permanently drops emptyDir contents on that node.

---

## 10. RBAC & permission checks

```bash
kubectl auth can-i create deployments -n team-a          # does MY user have this right?
kubectl auth can-i '*' '*' --all-namespaces              # am I cluster-admin? (hopefully limited)
kubectl auth can-i list secrets --as=system:serviceaccount:team-a:api   # impersonate to test
```

> ⚠️ Follow least privilege: scope Roles to namespaces, avoid wildcard `*` verbs/resources, and bind ServiceAccounts to exactly what a workload needs.

---

## 11. Manifest building blocks (1.36-valid apiVersions)

Deployment + Service (the everyday pair):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: api
          image: myapp:1.0
          ports: [{ containerPort: 8080 }]
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits:   { cpu: "500m", memory: "256Mi" }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector: { app: api }
  ports:
    - port: 80
      targetPort: 8080
```

Ingress (networking.k8s.io/v1, GA):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
```

> ⚠️ `Ingress` requires an ingress controller (NGINX, Traefik, cloud LB) installed in the cluster; the object alone does nothing. Many controllers now also support the newer **Gateway API** (`gateway.networking.k8s.io`) — check what your platform standardizes on.

---

## 12. Output, formatting & scripting

```bash
kubectl get pods -o json | jq '.items[].metadata.name'
kubectl get pods -o custom-columns='NAME:.metadata.name,STATUS:.status.phase'
kubectl get pods --sort-by=.status.startTime
kubectl get pods -o yaml --show-managed-fields=false
```

---

## 13. Troubleshooting reflexes

| Symptom | First thing to check |
| --- | --- |
| Pod `Pending` | `describe pod` events — usually unschedulable (resources/taints/PVC) |
| `CrashLoopBackOff` | `logs --previous`; failing command or missing config/secret |
| `ImagePullBackOff` | image name/tag typo, private registry auth (imagePullSecret) |
| Service returns nothing | selector labels match pod labels? `get endpoints <svc>` populated? |
| `CreateContainerConfigError` | referenced ConfigMap/Secret/key missing |
| Ingress 404/502 | controller installed? host/path rules and backend service correct? |

Two commands solve most incidents: `kubectl describe <resource>` (events) and `kubectl logs` (application output). `kubectl get endpointslices` / `kubectl get endpoints <svc>` confirms a Service actually selects pods.

---

## 14. Debug, Server-Side Apply, Kustomize, kuberc

```bash
# Ephemeral debug container (requires cluster support)
kubectl debug -it pod/my-pod --image=busybox:1.37 --target=app

# Server-Side Apply (field managers on the API server)
kubectl apply --server-side -f deploy.yaml
kubectl apply --server-side --field-manager=ci-bot -f deploy.yaml
kubectl get deploy myapp -o yaml | grep -A20 managedFields

# Kustomize
kubectl kustomize overlays/prod
kubectl apply -k overlays/prod

# Diff before apply
kubectl diff -f deploy.yaml
kubectl diff -k overlays/prod
```

> ⚠️ Prefer `--server-side` in CI when multiple actors edit the same object; client-side apply can fight over annotations. Learn field managers before force-conflicts.

**kuberc** (kubectl user preferences) separates personal CLI defaults from cluster `kubeconfig`. Check your kubectl minor for `kubectl kuberc` support and store preferences outside shared kubeconfig files.

**JSONPath tips:**

```bash
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
kubectl get svc api -o jsonpath='{.spec.clusterIP}'
```

---

**Prev:** [Appendix A — Docker Cheatsheet](a-cheatsheet-docker.md) · **Next:** [Appendix C — Further Resources](c-further-resources.md)
