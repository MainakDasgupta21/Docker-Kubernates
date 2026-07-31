# Chapter 17 — Configuration and Secrets

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Separate configuration from images with ConfigMaps (env and file mounts)
> - Store and consume Secrets safely, including built-in Secret types
> - Combine multiple sources with **projected volumes**
> - Explain encryption at rest for Secrets in etcd
> - Choose external secret managers (ESO / Secrets Store CSI) for production
> - Avoid baking credentials into container image layers

---

## 17.1 Why externalize configuration?

### In plain terms

Your container image should be the **appliance**, not the **settings dial**. The same Task API image should run in development, staging, and production. What changes is configuration: log level, database URL, feature flags, and credentials. If those values are baked into the image, you rebuild for every environment—and anyone who pulls the image can mine credentials from the layers.

The problem externalization solves is promotion safety: ship one digest through environments and only swap dials. That is how you prove "what we tested is what we run" instead of rebuilding with different `ENV` lines and hoping the binaries match.

> ⚠️ **Common Pitfall:** Baking `DATABASE_URL` into the image "just for the demo" and forgetting it before the image is published to a shared registry.

### Under the hood

Kubernetes provides two first-class objects:

| Object | Intended for | Default visibility |
|--------|--------------|--------------------|
| **ConfigMap** | Non-sensitive config | Readable by anyone with get/list in the namespace |
| **Secret** | Sensitive material | Still base64 in the API by default; extra RBAC and optional etcd encryption |

Both are injected into Pods as environment variables, files, or (for Secrets) sometimes via CSI drivers from external stores.

Lab baseline for this chapter (and the rest of Part II):

```bash
$ kind create cluster --name config --image kindest/node:v1.36.0
```

**What breaks if config lives only in the image:** every config tweak is a rebuild and retag; rollbacks mix binary and config changes; credential rotation requires a new image.

### In production

**Ownership:** app teams own ConfigMap/Secret *keys* and consumption; platform owns encryption-at-rest, external secret managers, and policies that ban Secrets in git.

- Treat image digests as immutable; promote the **same digest** across environments with different ConfigMaps/Secrets.
- Never commit production Secrets to git in plain form. Use sealed secrets, ESO, or your cloud secret manager.
- Size matters: ConfigMaps and Secrets are stored in etcd and are limited (practically about **1 MiB**). Large files belong in object storage or volumes, not ConfigMaps.

```mermaid
flowchart TB
  image["One image digest: task-api"]
  image --> dev["dev: ConfigMap dial + Secret key"]
  image --> staging["staging: ConfigMap dial + Secret key"]
  image --> prod["prod: ConfigMap dial + Secret key"]
```

*Figure 17.1: Promote the same image across environments; only ConfigMaps and Secrets change.*

> 🏭 **Production floor:** Digest pinning is part of config hygiene: PR → CI scan → promote digest → apply env-specific ConfigMap/Secret → rollout → rollback to previous digest. Incident tickets should record the digest and the Secret/ConfigMap resource versions, not "we deployed latest."

**Do:** one digest, many env dials. **Don't:** rebuild per environment with different baked credentials.

**Before you leave this section**

- **Understand:** Images are appliances; ConfigMaps/Secrets are dials.
- **Try:** Run the same image tag/digest with two different ConfigMaps.
- **Watch in prod:** Credentials or env-specific URLs found in image layers.

---

## 17.2 ConfigMaps

### In plain terms

A ConfigMap is a labeled envelope of settings—key/value pairs and small text files—that Pods can read without rebuilding the image. The problem it solves is non-sensitive drift between environments: log levels, feature flags, and property files that should change without a new build.

You might think updating a ConfigMap instantly reconfigures every Pod. Environment variables are fixed at container start; file mounts may update later, but the process must reload. Without a rollout, you can believe prod "has the new config" while old processes still run.

> ⚠️ **Common Pitfall:** Expecting ConfigMap env changes to hot-reload. Restart or redesign for file watches.

### Under the hood

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: task-api-config
  namespace: default
data:
  LOG_LEVEL: "info"
  MAX_TASKS_PER_USER: "100"
  FEATURE_PRIORITY_SORT: "true"
  app.properties: |
    cache.ttl=300
    cache.size=1000
    request.timeout=30
```

```bash
$ kubectl apply -f task-api-config.yaml
$ kubectl get configmap task-api-config -o yaml
```

**Environment injection** (cherry-pick):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
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
      containers:
        - name: api
          image: ghcr.io/example/task-api:1.2.0
          env:
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef:
                  name: task-api-config
                  key: LOG_LEVEL
```

**Bulk env** with `envFrom`:

```yaml
          envFrom:
            - configMapRef:
                name: task-api-config
```

**File mount**:

```yaml
          volumeMounts:
            - name: config-vol
              mountPath: /etc/task-api
              readOnly: true
      volumes:
        - name: config-vol
          configMap:
            name: task-api-config
            items:
              - key: app.properties
                path: app.properties
```

> 💡 **Tip:** Prefer file mounts for large or structured config. Prefer explicit `env` entries when you need a stable, small set of variables.

```mermaid
flowchart LR
  cm["ConfigMap"] --> envInject["env / envFrom"]
  cm --> fileMount["volumeMount files"]
  envInject --> container["Container"]
  fileMount --> container
```

*Figure 17.2: ConfigMaps inject as environment variables or mounted files without rebuilding the image.*

**What breaks if you `envFrom` a ConfigMap that also holds a multi-line properties file:** invalid environment variable names or surprise keys pollute the process environment—use `items` or cherry-pick keys.

### In production

**Ownership:** app teams own ConfigMap content; platform may enforce `immutable: true` for audited baselines.

- Updating a ConfigMap does **not** always restart Pods. Env vars are fixed at container start; mounted files can update eventually (kubelet sync), but apps must reload.
- For rollouts after config changes, bump a Deployment annotation or use `kubectl rollout restart`.
- Use `immutable: true` on ConfigMaps that should never change in place—forces a new object for changes and reduces accidental mutation.

**Do:** trigger a rollout after env-based config changes. **Don't:** store passwords in ConfigMaps "temporarily."

**Before you leave this section**

- **Understand:** Env injection is start-time; mounts may update; apps must reload.
- **Try:** Change a ConfigMap key used as env and prove the Pod still has the old value until restart.
- **Watch in prod:** Config drift between Git and live objects after emergency `kubectl edit`.

---

## 17.3 Secrets

### In plain terms

Secrets are ConfigMaps with a warning label: they hold passwords, tokens, and keys. Kubernetes gives them distinct types and slightly stronger defaults, but **base64 is not encryption**. Anyone with `get secrets` can decode them unless you add controls.

The problem Secrets solve is separating sensitive material from images and from world-readable ConfigMaps—so RBAC, etcd encryption, and external managers have a dedicated object kind to protect. They do *not* by themselves make credentials safe for git or for every ServiceAccount in the namespace.

You might think "it's base64, so it's obfuscated enough for GitHub." Base64 reverses in one shell pipeline. Treat a Secret YAML in git as a plaintext leak unless it is sealed/encrypted for that purpose.

> ⚠️ **Common Pitfall:** Putting Secrets in git “because they are base64.” Base64 reverses with `echo … | base64 -d`. Use sealed/external systems for source control.

### Under the hood

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: task-api-secret
type: Opaque
stringData:
  DATABASE_URL: "postgres://task:s3cret@postgres:5432/tasks"
  API_TOKEN: "replace-me"
```

`stringData` is convenience; the API stores `data` as base64.

```bash
$ kubectl get secret task-api-secret -o jsonpath='{.data.API_TOKEN}' | base64 -d
```

```text
replace-me
```

**Consume as env:**

```yaml
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: task-api-secret
                  key: DATABASE_URL
```

**Consume as files** (often safer—less likely to leak via process listings):

```yaml
          volumeMounts:
            - name: secrets
              mountPath: /var/run/secrets/task-api
              readOnly: true
      volumes:
        - name: secrets
          secret:
            secretName: task-api-secret
```

#### Built-in Secret types

| Type | Purpose |
|------|---------|
| `Opaque` | Generic key/value secrets |
| `kubernetes.io/tls` | `tls.crt` / `tls.key` for Ingress/Gateway |
| `kubernetes.io/dockerconfigjson` | Image pull credentials |
| `kubernetes.io/service-account-token` | Legacy SA tokens (prefer projected tokens) |

```bash
$ kubectl create secret tls demo-tls \
    --cert=tls.crt --key=tls.key
$ kubectl create secret docker-registry regcred \
    --docker-server=ghcr.io \
    --docker-username=USER \
    --docker-password=TOKEN
```

```mermaid
flowchart LR
  secret["Secret"] --> envPath["secretKeyRef → env"]
  secret --> volPath["secret volume → files"]
  envPath --> app["Application"]
  volPath --> app
```

*Figure 17.3: Secrets reach the app as env vars or files; file mounts leak less via process listings.*

**What breaks if the Secret name or key is wrong in the Pod template:** the Pod may fail to start (`CreateContainerConfigError`) or the app starts with empty credentials and fails later—check events before blaming the database.

### In production

**Ownership:** security/platform own encryption-at-rest, ESO/CSI patterns, and RBAC for `get secrets`; app teams own rotation procedures and which keys the app reads; nobody owns "Secrets committed to the app repo."

- RBAC: separate who can `create/update` Secrets from who can only mount them via Pods.
- Prefer file mounts + short-lived tokens over long-lived env vars.
- Enable **encryption at rest** for the Secret resource in the API server (see §17.5).
- Rotate credentials on a schedule; design apps to reload or restart cleanly.

> 🏭 **Production floor:** Secrets do not belong in git. Not in `stringData`, not "temporarily," not in private repos that every contractor can clone. Use Sealed Secrets, SOPS, External Secrets Operator, or your cloud secret manager; CI injects or syncs at deploy time. If a Secret hits git history, rotate it—removing the file is not enough.

**Do:** mount tokens as files; audit `get secrets` in RBAC. **Don't:** share one Opaque Secret across unrelated apps.

**Before you leave this section**

- **Understand:** Secrets are base64 in the API by default—RBAC and encryption matter.
- **Try:** Create an Opaque Secret, mount it as a file, and prove env vs file trade-offs.
- **Watch in prod:** `CreateContainerConfigError`, broad `get secrets` RoleBindings, and Secrets in git history.

---

## 17.4 Projected volumes

### In plain terms

Sometimes a Pod needs **several** config sources in **one directory**: a ConfigMap file, a Secret file, a service account token, and Pod metadata. A **projected volume** merges those sources into a single mount path—like a binder with tabs from different drawers. The problem it solves is sprawl of mounts and the old pattern of long-lived auto-mounted SA tokens as Secrets.

You might think multiple volumeMounts are always equivalent. Projection also enables **time-bound service account tokens** with audience and expiry—modern clusters prefer that over the legacy Secret-based token.

> ⚠️ **Common Pitfall:** Mounting the default service account token into every Pod with broad permissions. Use dedicated ServiceAccounts and projected tokens.

### Under the hood

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: task-api-projected-demo
spec:
  serviceAccountName: task-api
  containers:
    - name: api
      image: ghcr.io/example/task-api:1.2.0
      volumeMounts:
        - name: projected
          mountPath: /var/run/task-api
          readOnly: true
  volumes:
    - name: projected
      projected:
        sources:
          - configMap:
              name: task-api-config
              items:
                - key: app.properties
                  path: config/app.properties
          - secret:
              name: task-api-secret
              items:
                - key: API_TOKEN
                  path: secrets/api_token
          - serviceAccountToken:
              path: token
              expirationSeconds: 3600
          - downwardAPI:
              items:
                - path: labels
                  fieldRef:
                    fieldPath: metadata.labels
```

Projected volumes are the modern way to get **time-bound service account tokens** into Pods (replacing long-lived auto-mounted Secrets in many clusters).

```mermaid
flowchart TB
  cm["ConfigMap"] --> projected["Projected volume"]
  secret["Secret"] --> projected
  sat["serviceAccountToken"] --> projected
  downward["Downward API"] --> projected
  projected --> mount["Single mount path in Pod"]
```

*Figure 17.4: A projected volume merges ConfigMap, Secret, SA token, and Downward API sources into one directory.*

**What breaks if `expirationSeconds` is very short and the app never reloads the file:** API calls fail after expiry—apps must refresh the projected token file (kubelet rotates it in place).

### In production

**Ownership:** platform sets defaults for automount and projected token audiences; app teams declare what they mount.

- Prefer projected SA tokens with short `expirationSeconds` and audience binding when your platform supports it.
- Keep mount paths read-only.
- Document the directory layout so sidecars and main containers agree on paths.

Official concept page: [Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/).

**Before you leave this section**

- **Understand:** Projection merges sources and enables short-lived SA tokens.
- **Try:** List a projected mount that combines ConfigMap + Secret + token.
- **Watch in prod:** Pods still automounting powerful default SA tokens.

---

## 17.5 Encryption at rest

### In plain terms

Even if RBAC is perfect, etcd backups and disk snapshots can leak Secrets. Encryption at rest tells the API server to store Secret payloads encrypted with a key you control (often a KMS plugin). The problem it solves is offline theft of etcd data—not a caller who already has `get secrets`.

You might think encryption at rest means developers can no longer `kubectl get secret` and decode. It does not. RBAC still gates live API access; encryption protects the datastore and its backups.

> ⚠️ **Common Pitfall:** Enabling encryption providers but never rewriting existing Secrets—old plaintext objects remain until you `kubectl get … | kubectl replace`.

### Under the hood

Cluster admins configure an `EncryptionConfiguration` and point `kube-apiserver` at it. Providers include `aescbc`, `aesgcm`, and `kms` (recommended for production so keys live outside etcd hosts).

After enabling, rewrite existing Secrets so they are re-encrypted:

```bash
$ kubectl get secrets --all-namespaces -o json \
  | kubectl replace -f -
```

**What breaks if KMS is unreachable:** API server may fail to read/write Secrets depending on configuration—treat KMS availability as a control-plane dependency and monitor it.

### In production

**Ownership:** cluster/platform admins own EncryptionConfiguration and KMS keys; security owns key rotation drills.

- Prefer KMS providers from your cloud or HSM-backed key services.
- Practice key rotation drills; document who can decrypt backups.
- Encryption at rest does **not** protect against a caller with `get secrets`—RBAC and admission still matter.

**Do:** KMS + tested restore of encrypted etcd snapshots. **Don't:** store the local encryption key next to the etcd backup in the same bucket without controls.

**Before you leave this section**

- **Understand:** Encryption at rest protects etcd/backups, not kubectl getters.
- **Try:** Sketch where EncryptionConfiguration would live on your platform (no enable without approval).
- **Watch in prod:** KMS latency/errors correlated with Secret read failures.

---

## 17.6 External secret management

### In plain terms

Enterprises often already store credentials in Vault, AWS Secrets Manager, GCP Secret Manager, or Azure Key Vault. Kubernetes should **reference** those stores rather than become the system of record. The problem this solves is rotation, audit, and "Secrets never in git" at organizational scale.

You might think syncing into a Kubernetes Secret undoes the benefit. Sync is a delivery mechanism; the *source of truth* and audit trail stay external—if you also lock down who can read the synced Secret.

> ⚠️ **Common Pitfall:** Committing `stringData` Secrets to public repos—or private repos with broad clone access—while also running ESO. Pick one system of record and enforce it.

### Under the hood

Two common patterns:

1. **External Secrets Operator (ESO)** — controllers sync external secrets into Kubernetes `Secret` objects.
2. **Secrets Store CSI Driver** — mounts secrets directly into Pods as volumes (optionally syncing to a Secret).

Both keep rotation and audit trails in the external system while apps keep using familiar files or env vars.

```mermaid
flowchart LR
  vault["External store: Vault / cloud SM"] --> eso["ESO syncs to Secret"]
  vault --> csi["Secrets Store CSI mounts"]
  eso --> k8sSecret["Kubernetes Secret"]
  k8sSecret --> pod["Pod env or volume"]
  csi --> pod
```

*Figure 17.5: External managers remain the system of record; ESO syncs Secrets or CSI mounts values straight into Pods.*

**What breaks if sync fails silently:** Pods keep old credentials after a rotation; databases reject logins while Kubernetes objects look "present"—alert on ExternalSecret / SecretProviderClass status.

### In production

**Ownership:** security owns the external store and rotation policy; platform owns ESO/CSI install; app teams own ExternalSecret manifests that map keys into their namespace.

- Decide whether apps read CSI mounts or synced Secrets.
- Restrict who can create `ExternalSecret` / `SecretProviderClass` objects.
- Monitor sync failures—stale credentials are a common outage class.

**Do:** alert on sync lag after rotation. **Don't:** duplicate the same password in Vault *and* a hand-applied Secret that drifts.

**Before you leave this section**

- **Understand:** ESO syncs vs CSI mounts—and who is system of record.
- **Try:** Write three bullets choosing ESO vs CSI for Task API.
- **Watch in prod:** Stale synced Secrets after external rotation.

---

## 17.7 Wiring the Task API (worked example)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
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
      serviceAccountName: task-api
      containers:
        - name: api
          image: ghcr.io/example/task-api:1.2.0
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef:
                name: task-api-config
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: task-api-secret
                  key: DATABASE_URL
          volumeMounts:
            - name: projected
              mountPath: /var/run/task-api
              readOnly: true
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8000
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
      volumes:
        - name: projected
          projected:
            sources:
              - secret:
                  name: task-api-secret
                  items:
                    - key: API_TOKEN
                      path: api_token
              - serviceAccountToken:
                  path: sa-token
                  expirationSeconds: 3600
```

```bash
$ kubectl apply -f task-api-config.yaml -f task-api-secret.yaml -f task-api-deploy.yaml
$ kubectl rollout status deploy/task-api
```

---

## 17.8 Common pitfalls

> ⚠️ **Common Pitfall:** Expecting ConfigMap env changes to hot-reload. Restart or redesign for file watches.

> ⚠️ **Common Pitfall:** Storing TLS private keys in ConfigMaps “temporarily.” Use `kubernetes.io/tls` Secrets and tight RBAC.

> ⚠️ **Common Pitfall:** Mounting the default service account token into every Pod with broad permissions. Use dedicated ServiceAccounts and projected tokens.

> ⚠️ **Common Pitfall:** Committing `stringData` Secrets to public repos.

---

## 17.9 Hands-on exercises

1. Create a ConfigMap and mount `app.properties` into a busybox Pod; `cat` the file.
2. Create an Opaque Secret and inject one key as an environment variable; verify with `kubectl exec` and `printenv` (then delete the Pod).
3. Build a projected volume that combines ConfigMap + Secret + SA token; list `/var/run/task-api`.
4. (Cluster-admin lab) Read the docs for encryption at rest and sketch where your `EncryptionConfiguration` would live—do not enable on a shared cluster without approval.
5. Compare ESO vs Secrets Store CSI: write three bullets on when you would pick each.

---

## 17.10 Check Your Understanding

**Q1.** Why is base64 in a Secret not enough protection?

<details>
<summary>Show answer</summary>

Base64 is encoding, not encryption. Anyone with permission to read the Secret can decode it instantly. Protect Secrets with RBAC, encryption at rest, and preferably an external KMS-backed store.

</details>

**Q2.** When should you use a projected volume instead of separate mounts?

<details>
<summary>Show answer</summary>

When the application expects a single directory that mixes ConfigMaps, Secrets, tokens, and Downward API data—or when you need short-lived projected service account tokens.

</details>

**Q3.** Do ConfigMap updates restart Pods automatically?

<details>
<summary>Show answer</summary>

No. Environment variables are fixed at start. Mounted files may update later, but processes must reload. Trigger a rollout when in doubt.

</details>

**Q4.** Which Secret type holds registry pull credentials?

<details>
<summary>Show answer</summary>

`kubernetes.io/dockerconfigjson` (often created with `kubectl create secret docker-registry`).

</details>

**Q5.** What problem does encryption at rest solve that RBAC alone does not?

<details>
<summary>Show answer</summary>

It protects Secret payloads on disk and in etcd backups from offline readers who never call the API—assuming they lack the encryption keys.

</details>

---

## 17.11 Key takeaways

- Keep config and secrets **out of images**; inject them at runtime.
- ConfigMaps for non-sensitive data; Secrets for sensitive data—with clear eyes about base64.
- Prefer file mounts and projected volumes for tokens and multi-source config.
- Encrypt Secrets at rest and consider external secret managers for enterprise systems of record.
- Design for rotation: rollouts, short-lived tokens, and audited access.

---

## 17.12 Official documentation map

| Topic | Official page |
|-------|---------------|
| ConfigMaps | [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) |
| Secrets | [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) |
| Good practices for Secrets | [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/) |
| Projected volumes | [Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/) |
| Encrypting data at rest | [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) |
| Configure Pod to use ConfigMap | [Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/) |
| Distribute credentials with Secrets | [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/) |

**Previous:** [Chapter 16 — Ingress and Gateway API](16-ingress-and-gateway-api.md) | **Next:** [Chapter 18 — Kubernetes Storage](18-k8s-storage.md)
