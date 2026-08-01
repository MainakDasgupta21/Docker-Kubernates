# Chapter 17 — Configuration and Secrets

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Keep settings out of your image by using ConfigMaps, as environment variables or as files
> - Store and read Secrets safely, and use the built-in Secret types for the right jobs
> - Bring several sources into one directory with **projected volumes**
> - Explain what encrypting Secrets inside etcd does protect, and what it does not
> - Decide when to keep credentials in an outside system such as Vault or a cloud secret manager
> - Keep passwords and tokens out of your image layers for good

---

## 17.1 Why externalize configuration?

### In plain terms

**Externalizing configuration** means keeping settings outside the image and handing them to the container when it starts. Settings are things like the log level, the database address, feature flags, and passwords.

Here is why it matters. If those values live inside the image, you must build a different image for development, staging, and production. Then you can never honestly say "we tested exactly what we shipped," because you shipped a different build. Worse, anyone who can pull that image can read the credentials out of its layers.

Think of the image as an appliance and the configuration as the dial on the front. You buy one kettle, not three kettles pre-set to three temperatures. In Kubernetes, one image moves through every environment, and only the dials change.

> ⚠️ **Common Pitfall:** Baking `DATABASE_URL` into the image "just for the demo" and forgetting it before the image is published to a shared registry.

### Under the hood

Kubernetes gives you two objects for this:

| Object | Intended for | Default visibility |
|--------|--------------|--------------------|
| **ConfigMap** | Non-sensitive config | Readable by anyone with get/list in the namespace |
| **Secret** | Sensitive material | Still base64 in the API by default; extra RBAC and optional etcd encryption |

Both reach a Pod the same two ways: as environment variables, or as files in a mounted directory. Secrets can also arrive through a CSI driver that reads from an outside store.

Lab baseline for this chapter (and the rest of Part II):

```bash
$ kind create cluster --name config --image kindest/node:v1.36.0
```

**What breaks if config lives only in the image:** every config tweak is a rebuild and retag; rollbacks mix binary and config changes; credential rotation requires a new image.

### In production

**Ownership:** app teams own ConfigMap/Secret *keys* and consumption; platform owns encryption-at-rest, external secret managers, and policies that ban Secrets in git.

- A digest names one exact build. Move the **same digest** through every environment and change only the ConfigMaps and Secrets.
- Never commit a production Secret to git in plain form. Use Sealed Secrets, the External Secrets Operator, or your cloud's secret manager.
- Watch the size. ConfigMaps and Secrets live in etcd and top out around **1 MiB** in practice. Large files belong in object storage or a volume, not in a ConfigMap.

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

A **ConfigMap** is a Kubernetes object that holds plain settings: key-value pairs and small text files. Pods read those values at start time, so you can change a setting without building a new image.

Use it for everything that is not a secret. Log levels, feature flags, timeouts, cache sizes, a small properties file. These are the values that genuinely differ between development and production, and none of them are worth a rebuild.

You might think changing a ConfigMap instantly reconfigures every running Pod. It does not, and this trips up nearly everyone. Environment variables are read once, when the container starts, and never change after that. Mounted files *do* get updated eventually, but your process still has to notice and reload them. Without a rollout, you can be convinced production has the new config while every Pod is still running the old value.

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

Note that `data` holds both simple values and a whole file (`app.properties`). There are three ways to get those into a container. First, **pick one key** and name it as an environment variable:

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

Second, take **every key at once** with `envFrom`:

```yaml
          envFrom:
            - configMapRef:
                name: task-api-config
```

Third, mount keys as **files** in a directory:

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

- Changing a ConfigMap does **not** restart your Pods. Environment variables are fixed when the container starts. Mounted files do get refreshed by the kubelet, but the app has to reload them.
- To make a config change take effect, restart the Pods: change an annotation on the Deployment, or run `kubectl rollout restart`.
- Set `immutable: true` on any ConfigMap that must never be edited in place. Changes then require a new object, which removes a whole class of accidents.

**Do:** trigger a rollout after env-based config changes. **Don't:** store passwords in ConfigMaps "temporarily."

**Before you leave this section**

- **Understand:** Env injection is start-time; mounts may update; apps must reload.
- **Try:** Change a ConfigMap key used as env and prove the Pod still has the old value until restart.
- **Watch in prod:** Config drift between Git and live objects after emergency `kubectl edit`.

---

## 17.3 Secrets

### In plain terms

A **Secret** is a Kubernetes object for sensitive values: passwords, API tokens, certificates, and keys. It works almost exactly like a ConfigMap, and it reaches your container the same two ways.

So why have a separate kind at all? Because a separate kind can be protected separately. You can grant read access to ConfigMaps and withhold it for Secrets. You can tell the API server to encrypt only Secrets inside etcd. You can point an outside secret manager at them. None of that is possible if passwords are mixed into ConfigMaps.

Now the single most important sentence in this chapter. **Base64 is encoding, not encryption.** Encoding just rewrites bytes into a safe alphabet, and anyone can reverse it. Encryption needs a key that an attacker does not have. Kubernetes stores Secret values in base64 for transport reasons only, and that is exactly what the `base64 -d` command below undoes in a fraction of a second.

You might think base64 makes a Secret safe enough to commit to a private repository. It does not. Treat a Secret YAML file in git as a password published in plain text, because that is what it is. Anyone who can clone the repo — today, or from history, or a contractor next year — has your credential.

> 💡 **In one line:** A Secret is not encrypted by default. Base64 is a costume, not a lock; RBAC and encryption at rest are the actual protection.

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

You wrote `stringData`, which lets you type plain text. The API server converts it and stores it under `data` as base64. Here is how little that protects you:

```bash
$ kubectl get secret task-api-secret -o jsonpath='{.data.API_TOKEN}' | base64 -d
```

```text
replace-me
```

One command, and the password is on screen. That is the whole story of base64.

**Read it as an environment variable:**

```yaml
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: task-api-secret
                  key: DATABASE_URL
```

**Read it as a file**, which is usually safer. Environment variables show up in crash dumps, in process listings, and in logs that print the whole environment. A file in a directory does none of that:

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

Kubernetes knows a few kinds of Secret by name, and tools look for those names. Use the right type instead of `Opaque` when one fits:

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

- Split the RBAC. The people who may `create` and `update` Secrets are not the same set as the people whose Pods merely mount them.
- Prefer files and short-lived tokens over long-lived environment variables.
- Turn on **encryption at rest** for Secrets in the API server (see §17.5).
- Rotate credentials on a schedule, and make sure your app can reload or restart cleanly when they change.

> 🏭 **Production floor:** Secrets do not belong in git. Not in `stringData`, not "temporarily," not in private repos that every contractor can clone. Use Sealed Secrets, SOPS, External Secrets Operator, or your cloud secret manager; CI injects or syncs at deploy time. If a Secret hits git history, rotate it—removing the file is not enough.

**Do:** mount tokens as files; audit `get secrets` in RBAC. **Don't:** share one Opaque Secret across unrelated apps.

**Before you leave this section**

- **Understand:** Secrets are base64 in the API by default—RBAC and encryption matter.
- **Try:** Create an Opaque Secret, mount it as a file, and prove env vs file trade-offs.
- **Watch in prod:** `CreateContainerConfigError`, broad `get secrets` RoleBindings, and Secrets in git history.

---

## 17.4 Projected volumes

### In plain terms

A **projected volume** puts several different sources into one directory: a file from a ConfigMap, a file from a Secret, a service account token, and some Pod metadata, all under one mount path.

There are two reasons to use one. The plain reason is tidiness: your app reads one directory instead of four mounts scattered across the filesystem. Think of a binder with tabs, where each tab came from a different drawer.

The important reason is the token. A **service account token** is the credential a Pod uses to talk to the Kubernetes API. The old way handed out a token in a Secret that never expired. A projected volume issues one that expires — you set `expirationSeconds` — and is valid only for a stated audience. The kubelet refreshes the file before it runs out. A stolen token that dies in an hour is far less useful to an attacker than one that lives forever.

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

Read the four `sources` entries as four drawers feeding one binder. Each one sets its own `path`, and those paths are relative to the single `mountPath`. This is the modern way to hand a Pod a **short-lived service account token**, and it replaces the long-lived, automatically mounted Secret in most clusters.

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

- Use projected service account tokens with a short `expirationSeconds` and a bound audience wherever your platform supports it.
- Mount every one of these paths read-only.
- Write down the directory layout, so sidecars and the main container agree on where each file lives.

Official concept page: [Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/).

**Before you leave this section**

- **Understand:** Projection merges sources and enables short-lived SA tokens.
- **Try:** List a projected mount that combines ConfigMap + Secret + token.
- **Watch in prod:** Pods still automounting powerful default SA tokens.

---

## 17.5 Encryption at rest

### In plain terms

**Encryption at rest** means the API server encrypts Secret values before writing them into etcd, using a key you control.

Here is the threat it addresses. Your RBAC rules can be perfect and still not help, because there is another copy of every Secret: the etcd database file and every backup of it. Anyone who gets a disk snapshot or a backup tarball can read Secrets straight out of it, without ever touching your cluster or your permissions. Encryption at rest makes that copy useless without the key.

Be precise about what it does *not* do. It does not stop a developer who already has permission to read Secrets. That person calls the API, and the API server decrypts for them as designed. Encryption protects the data sitting on disk. RBAC protects the live API. You need both.

> ⚠️ **Common Pitfall:** Enabling encryption providers but never rewriting existing Secrets—old plaintext objects remain until you `kubectl get … | kubectl replace`.

### Under the hood

Here is how a cluster admin turns it on. You write an `EncryptionConfiguration` file and point `kube-apiserver` at it. The providers are `aescbc`, `aesgcm`, and `kms`. Use `kms` in production, because it keeps the key in an outside key service rather than on the same machines as etcd.

Turning it on only affects future writes. To protect what is already stored, rewrite every existing Secret:

```bash
$ kubectl get secrets --all-namespaces -o json \
  | kubectl replace -f -
```

**What breaks if KMS is unreachable:** API server may fail to read/write Secrets depending on configuration—treat KMS availability as a control-plane dependency and monitor it.

### In production

**Ownership:** cluster/platform admins own EncryptionConfiguration and KMS keys; security owns key rotation drills.

- Use a KMS provider from your cloud, or a key service backed by hardware.
- Rehearse key rotation before you need it, and write down exactly who is able to decrypt a backup.
- Remember the limit: encryption at rest does **not** stop a caller who already has `get secrets`. RBAC and admission policy still carry that weight.

**Do:** KMS + tested restore of encrypted etcd snapshots. **Don't:** store the local encryption key next to the etcd backup in the same bucket without controls.

**Before you leave this section**

- **Understand:** Encryption at rest protects etcd/backups, not kubectl getters.
- **Try:** Sketch where EncryptionConfiguration would live on your platform (no enable without approval).
- **Watch in prod:** KMS latency/errors correlated with Secret read failures.

---

## 17.6 External secret management

### In plain terms

**External secret management** means the real credential lives in a system outside Kubernetes — Vault, AWS Secrets Manager, GCP Secret Manager, or Azure Key Vault — and Kubernetes only fetches a copy.

Most companies need this because they already have one of those systems, with rotation schedules, approval workflows, and an audit log that says who read what and when. Kubernetes Secrets have none of that. Making the cluster the **system of record**, meaning the one authoritative place a value lives, would mean giving all of it up.

You might think copying the value into a Kubernetes Secret throws away the benefit. It does not, as long as you are clear about roles. The copy is delivery. The outside store is still where the value is created, rotated, and audited. What you must add is tight RBAC on the copy, or you have simply moved the problem.

> ⚠️ **Common Pitfall:** Committing `stringData` Secrets to public repos—or private repos with broad clone access—while also running ESO. Pick one system of record and enforce it.

### Under the hood

There are two common ways to wire this up:

1. **External Secrets Operator (ESO)** — controllers sync external secrets into Kubernetes `Secret` objects.
2. **Secrets Store CSI Driver** — mounts secrets directly into Pods as volumes (optionally syncing to a Secret).

Either way, rotation and the audit trail stay in the outside system, and your app keeps reading ordinary files or environment variables. Nothing in the application code has to know where the value came from.

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

- Pick one pattern per platform: apps read CSI mounts, or apps read synced Secrets. Do not leave it to each team.
- Restrict who can create `ExternalSecret` and `SecretProviderClass` objects, because those objects decide which credentials land in a namespace.
- Alert on sync failures. A credential that quietly failed to update is one of the most common causes of a 3 a.m. page.

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

- Keep settings and credentials **out of the image**. Hand them to the container at start time.
- One image digest moves through every environment. Only the ConfigMaps and Secrets change.
- **ConfigMap** for ordinary settings. **Secret** for anything sensitive.
- **Base64 is not encryption.** A Secret in git is a password in plain text.
- Environment variables are frozen at container start. Restart the Pods for a config change to take effect.
- Mount credentials as files rather than environment variables. Files do not leak into logs and process listings.
- A **projected volume** merges sources into one directory and gives you short-lived service account tokens.
- **Encryption at rest** protects etcd and its backups. It does not stop anyone who can already read Secrets.
- Keep the real credential in an outside secret manager, and alert when the copy fails to sync.

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
