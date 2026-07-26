# Chapter 25 — Docker Build Deep Dive

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Create and select Buildx builders backed by appropriate drivers
> - Define repeatable multi-target builds with `docker-bake.hcl`
> - Publish one image reference that supports multiple CPU architectures
> - Choose local, registry, inline, and CI-oriented cache backends
> - Generate and preserve SBOM and provenance attestations
> - Diagnose common BuildKit output, emulation, and cache failures

## 25.1 From Recipe to Build Factory

A Dockerfile is a recipe, but a modern image pipeline is a factory. The recipe describes steps; the factory decides where those steps execute, how many architectures are produced, where reusable work is stored, and which evidence accompanies the result.

Docker Engine 29.x uses BuildKit for builds, and Buildx is the Docker CLI interface to BuildKit's advanced capabilities. This separation matters. A developer can send the same build definition to the Engine-integrated builder, a dedicated BuildKit container, a Kubernetes-backed builder, or a remote BuildKit service.

The build output is also broader than "an image on my laptop." It may be a multi-platform image index in a registry, an OCI archive, a cache export, and signed or unsigned metadata describing contents and origin. A production build therefore has four concerns:

1. **Execution** — which builder and driver perform the work?
2. **Coordination** — which targets, variables, and platforms belong together?
3. **Acceleration** — where can BuildKit import and export reusable cache?
4. **Evidence** — which SBOM and provenance attestations travel with the image?

## 25.2 Buildx Builders and Drivers

### In plain terms

A builder is a BuildKit worker, or a group of workers, available to your Docker client. A driver is the arrangement used to host or reach that worker.

Think of Buildx as a dispatcher. The familiar default builder is convenient for local work. A named builder gives you an isolated build environment that can be configured, upgraded, shared, or removed without changing the application Dockerfile.

The principal drivers are:

| Driver | Where BuildKit runs | Typical use |
|--------|---------------------|-------------|
| `docker` | Inside the Docker daemon | Simple local builds |
| `docker-container` | In a dedicated container | Configurable local or CI builds |
| `kubernetes` | In Kubernetes Pods | Elastic or shared build capacity |
| `remote` | At an existing BuildKit endpoint | Centrally operated build service |

```mermaid
flowchart LR
  dockerCli["Docker CLI with Buildx"] --> dockerDriver["docker driver"]
  dockerCli --> containerDriver["docker-container driver"]
  dockerCli --> kubernetesDriver["kubernetes driver"]
  dockerCli --> remoteDriver["remote driver"]
  dockerDriver --> engineWorker["BuildKit in dockerd"]
  containerDriver --> containerWorker["Dedicated BuildKit container"]
  kubernetesDriver --> podWorkers["BuildKit worker Pods"]
  remoteDriver --> remoteWorkers["Remote BuildKit service"]
  engineWorker --> buildOutput["Image, cache, or registry output"]
  containerWorker --> buildOutput
  podWorkers --> buildOutput
  remoteWorkers --> buildOutput
```

*Figure 25.1: Buildx dispatches one build definition to workers hosted by four different driver topologies.*

### Under the hood

List the available builders and inspect the selected one:

```bash
$ docker buildx ls
NAME/NODE       DRIVER/ENDPOINT   STATUS    BUILDKIT   PLATFORMS
default*        docker
  default       default           running   v0.x       linux/amd64

$ docker buildx inspect --bootstrap
Name:          default
Driver:        docker
Status:        running
```

Create a dedicated builder using the `docker-container` driver:

```bash
$ docker buildx create \
    --name textbook-builder \
    --driver docker-container \
    --use
textbook-builder

$ docker buildx inspect --bootstrap
```

`--bootstrap` starts the BuildKit worker if necessary and discovers its capabilities. `--use` selects the builder for subsequent `docker buildx` commands. You can instead select one per command with `--builder textbook-builder` or set `BUILDX_BUILDER`.

The `docker` driver automatically places a compatible result in the local image store. Other drivers do not automatically load output. Make the destination explicit:

```bash
# Load one platform into the local image store.
$ docker buildx build --load -t task-api:dev .

# Push build output directly to a registry.
$ docker buildx build --push -t registry.example.com/team/task-api:1.0 .
```

`--load` is shorthand for a Docker image exporter and is normally a single-platform workflow. `--push` uses the registry exporter and is the normal choice for multi-platform images and persistent attestations.

### In production

Treat builders as infrastructure. Pin or intentionally upgrade BuildKit versions, restrict access to builder endpoints, monitor disk use, and separate untrusted pull-request builds from release builds that hold registry credentials.

Use `docker-container` when a CI runner needs predictable BuildKit configuration and full exporter support. Use `kubernetes` when build concurrency and worker lifecycle justify operating shared capacity. Use `remote` only with authenticated, encrypted connectivity and an ownership model for upgrades and incident response.

Record builder diagnostics in failed CI jobs:

```bash
$ docker buildx inspect
$ docker buildx du
```

Do not place unrelated security domains in one long-lived builder cache. Build contexts, secret mounts, and cache metadata cross job boundaries more easily than teams expect. Ephemeral builders or carefully partitioned caches reduce that risk.

## 25.3 Coordinating Builds with Bake

### In plain terms

Bake is a build orchestrator included with Buildx. Instead of repeating a long command for every image, you describe targets and shared settings in a file. Bake resolves dependencies, deduplicates common work, and can run independent targets in parallel.

It plays a role similar to a build-system file: the Dockerfile still defines image construction, while Bake defines the build matrix.

### Under the hood

Create `docker-bake.hcl` at the repository root:

```hcl
variable "REGISTRY" {
  default = "registry.example.com/textbook"
}

variable "VERSION" {
  default = "dev"
}

group "default" {
  targets = ["task-api", "task-worker"]
}

target "_common" {
  context    = "."
  platforms  = ["linux/amd64", "linux/arm64"]
  pull       = true
  provenance = "mode=max"
  sbom       = true
}

target "task-api" {
  inherits   = ["_common"]
  dockerfile = "docker/api.Dockerfile"
  target     = "runtime"
  tags       = ["${REGISTRY}/task-api:${VERSION}"]
}

target "task-worker" {
  inherits   = ["_common"]
  dockerfile = "docker/worker.Dockerfile"
  target     = "runtime"
  tags       = ["${REGISTRY}/task-worker:${VERSION}"]
}
```

```mermaid
flowchart LR
  bakeFile["docker-bake.hcl"] --> defaultGroup["default group"]
  commonTarget["_common target"]
  defaultGroup --> apiTarget["task-api target"]
  defaultGroup --> workerTarget["task-worker target"]
  commonTarget -->|inherits| apiTarget
  commonTarget -->|inherits| workerTarget
  apiTarget --> apiPlatforms["amd64 and arm64 images"]
  workerTarget --> workerPlatforms["amd64 and arm64 images"]
  apiPlatforms --> registry["Registry"]
  workerPlatforms --> registry
```

*Figure 25.2: Bake expands shared settings into parallel application targets and publishes their platform variants.*

Preview the fully resolved plan before executing it:

```bash
$ VERSION=1.4.0 docker buildx bake --print
$ VERSION=1.4.0 docker buildx bake --push
```

Environment variables override Bake variables of the same name. Command-line `--set` overrides target fields and supports target patterns:

```bash
$ docker buildx bake \
    --set '*.platform=linux/amd64' \
    --set '*.output=type=docker'
```

Bake can read HCL, JSON, and Compose build definitions. HCL is especially useful for inheritance, matrices, and reusable functions. Keep target names stable because CI jobs and developer scripts will depend on them.

### In production

Use Bake as the reviewed contract between application repositories and CI. Put tags, platforms, cache policy, and attestation policy in the file instead of distributing them across shell scripts.

Keep credentials out of `docker-bake.hcl`. Reference BuildKit secret or SSH mounts, and inject the source at execution time:

```hcl
target "task-api" {
  secrets = ["id=pypi_token,env=PYPI_TOKEN"]
}
```

The Dockerfile consumes it without committing it to a layer:

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=pypi_token \
    PIP_INDEX_TOKEN="$(cat /run/secrets/pypi_token)" ./install-private.sh
```

Require `docker buildx bake --print` during reviews of complex variable changes. The resolved plan exposes accidental tag, platform, and output changes before registry writes occur.

## 25.4 Multi-Platform Builds

### In plain terms

An image tagged `task-api:1.0` can represent several platform-specific images. When a client pulls it, the registry and runtime select the matching variant, such as `linux/amd64` for many servers or `linux/arm64` for ARM systems.

The shared reference points to an OCI image index. Each entry in that index points to a normal image manifest with its own layers and configuration.

### Under the hood

Build and push two Linux variants:

```bash
$ docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag registry.example.com/textbook/task-api:1.0 \
    --push .
```

Inspect the published index:

```bash
$ docker buildx imagetools inspect \
    registry.example.com/textbook/task-api:1.0
Name:      registry.example.com/textbook/task-api:1.0
MediaType: application/vnd.oci.image.index.v1+json
Manifests:
  Platform: linux/amd64
  Platform: linux/arm64
```

BuildKit can produce multiple platforms in three ways:

1. **Emulation** uses QEMU through `binfmt_misc`. It is easy to start but may be much slower for compilation.
2. **Multiple native nodes** attach workers of different architectures to one builder.
3. **Cross-compilation** uses a build stage that runs on the builder platform and emits a binary for the target platform.

A cross-compilation Dockerfile can use automatic platform arguments:

```dockerfile
# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -o /out/task-api ./cmd/api

FROM alpine:3.22
RUN adduser -D -u 10001 app
COPY --from=build /out/task-api /usr/local/bin/task-api
USER app
ENTRYPOINT ["task-api"]
```

`BUILDPLATFORM` describes the worker running the build stage. `TARGETOS` and `TARGETARCH` describe the image variant being produced. Pinning the build stage to `$BUILDPLATFORM` avoids emulating the compiler itself.

### In production

Test every published platform. A successful build proves only that files were assembled, not that the binary starts or behaves correctly. Run architecture-specific smoke tests on native runners where possible.

Pin base images by digest when reproducibility is more important than automatic patch pickup. Remember that each platform variant has its own manifest digest, while the multi-platform index has another digest. Deployment policy should identify which digest level it verifies.

Avoid platform claims your dependencies cannot satisfy. Native extensions, system packages, and vendor agents may not exist for every architecture. Fail the release rather than publishing an incomplete index under a production tag.

## 25.5 Cache Backends and Cache Design

### In plain terms

Build cache is saved work. BuildKit calculates whether an operation's inputs match previous inputs; if they do, it can reuse the result instead of running that step again.

An internal builder cache is fast but tied to one builder. An external cache lets fresh CI runners import previous work and lets a completed build publish cache for the next build.

### Under the hood

The main external backends are:

- **Inline** — embeds minimal cache metadata in the image; simple but limited.
- **Registry** — stores a separate cache artifact in an OCI registry.
- **Local** — writes cache to a directory.
- **GitHub Actions** — integrates with GitHub Actions cache services.
- **S3 and Azure Blob** — availability may depend on the BuildKit release and configuration.

A registry cache separates release artifacts from reusable build state:

```bash
$ docker buildx build \
    --tag registry.example.com/textbook/task-api:1.0 \
    --cache-from type=registry,ref=registry.example.com/textbook/task-api:buildcache \
    --cache-to type=registry,ref=registry.example.com/textbook/task-api:buildcache,mode=max \
    --push .
```

`mode=min` exports cache needed for the final image path. `mode=max` exports intermediate-stage cache as well, which improves reuse for multi-stage builds but consumes more storage.

For a local cache:

```bash
$ docker buildx build \
    --cache-from type=local,src=.buildx-cache \
    --cache-to type=local,dest=.buildx-cache-new,mode=max \
    --load -t task-api:dev .
```

Dockerfile structure determines cache quality. Copy dependency metadata before frequently changing source:

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13-slim AS build
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip wheel --wheel-dir=/wheels -r requirements.txt
COPY . .
```

The cache mount accelerates package downloads without copying the package-manager cache into the final layer.

### In production

Give caches a lifecycle. Use a stable cache reference per protected branch and a narrower reference for untrusted branches. Set registry retention rules and monitor builder disk pressure.

Treat cache as untrusted acceleration, not proof of correctness. BuildKit validates cache records against content and operation metadata, but cache policy does not replace dependency verification, locked versions, tests, or attestations.

Never pass secrets through `ARG`, `ENV`, copied files, or cache keys. Use `RUN --mount=type=secret` or `RUN --mount=type=ssh`; BuildKit excludes secret contents from the resulting layer, while your command must still avoid copying them elsewhere.

## 25.6 SBOM and Provenance Attestations

### In plain terms

An SBOM answers, "What software is in this image?" Provenance answers, "How and from what inputs was this image built?" An attestation associates such a statement with an image.

These records are evidence, not a guarantee. An SBOM can be incomplete, and provenance can faithfully describe an unsafe process. Their value comes from generation, preservation, verification, and policy use together.

### Under the hood

Generate SBOM and maximum-detail provenance while pushing:

```bash
$ docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag registry.example.com/textbook/task-api:1.0 \
    --sbom=true \
    --provenance=mode=max \
    --push .
```

The general `--attest` form is useful when configuration becomes more specific:

```bash
$ docker buildx build \
    --attest=type=sbom \
    --attest=type=provenance,mode=max \
    --tag registry.example.com/textbook/task-api:1.0 \
    --push .
```

`--sbom` is shorthand for `--attest=type=sbom`; `--provenance` is shorthand for `--attest=type=provenance`. BuildKit normally creates minimal provenance by default, but explicit release policy avoids depending on defaults.

```mermaid
flowchart LR
  source["Source and locked dependencies"] --> buildKit["BuildKit release build"]
  buildKit --> imageDigest["Immutable image digest"]
  buildKit --> sbom["SBOM attestation"]
  buildKit --> provenance["Provenance attestation"]
  imageDigest --> imageIndex["OCI image index"]
  sbom --> imageIndex
  provenance --> imageIndex
  imageIndex --> registry["OCI registry"]
  registry --> verifier["Signature and policy verifier"]
  verifier --> deployment["Approved deployment"]
```

*Figure 25.3: A release build publishes image bytes and attestations together so downstream policy can verify one immutable subject.*

Attestations are attached through manifests in the image index. With a classic Engine image store, loading an image locally can lose registry-oriented attestation data. Pushing directly preserves it. The containerd image store available in Engine 29.x can retain multi-platform images and attestations locally, but registry publication remains the normal release path.

Be careful with `mode=max`: it provides stronger traceability but may expose build arguments and source metadata. Do not pass secrets as build arguments, and review the generated predicate before making it public.

### In production

Generate evidence in the same trusted CI job that publishes the digest. Then sign the immutable digest and enforce downstream policy against that digest, not a mutable tag.

A practical release gate asks:

- Does the image have an SBOM in an accepted format?
- Does provenance identify the expected repository and builder?
- Was the attestation signature created by an approved identity?
- Were all required platforms produced?
- Does vulnerability policy accept the SBOM's components?

Retain provenance with the release for incident response. When a compromised dependency is announced, the SBOM finds affected images; provenance helps identify which source revision, builder, and process produced them.

## 25.7 Common Pitfalls

> ⚠️ **Common Pitfall:** Using a `docker-container` builder and expecting the image to appear in `docker image ls`. Use `--load` for a local single-platform result or `--push` for registry output.

> ⚠️ **Common Pitfall:** Combining `--platform linux/amd64,linux/arm64` with `--load`. A classic local image load normally represents one platform; push the multi-platform index to a registry.

> ⚠️ **Common Pitfall:** Assuming QEMU performance matches native compilation. Emulation can make CPU-heavy builds dramatically slower; prefer cross-compilation or native workers.

> ⚠️ **Common Pitfall:** Exporting one writable cache reference from many concurrent jobs. Last-writer behavior can discard useful records. Partition caches or serialize the export.

> ⚠️ **Common Pitfall:** Believing an SBOM or provenance statement is automatically trusted. Evidence must be associated with the expected digest and verified against an approved signer or builder policy.

> ⚠️ **Warning:** `provenance=mode=max` may record build arguments. Secrets never belong in build arguments, even when lower-detail provenance is selected.

## 25.8 Hands-on Exercises

1. **Create a builder.** Create `lab-builder` with the `docker-container` driver. Bootstrap it, inspect supported platforms, build a local image with `--load`, and remove the builder when finished.
2. **Define a Bake plan.** Write a `docker-bake.hcl` with a shared target and two application targets. Use `docker buildx bake --print` to verify inheritance, then override the version through an environment variable.
3. **Publish multiple platforms.** Push `linux/amd64` and `linux/arm64` variants to a registry you control. Inspect the index with `docker buildx imagetools inspect`.
4. **Measure cache reuse.** Run a registry-cached build twice. Change only an application source file and identify which steps remain cached. Then change the dependency lock file and compare.
5. **Attach evidence.** Push an image with `--sbom=true --provenance=mode=max`. Inspect the registry result with tooling available in your environment and record the image index digest.

## 25.9 Check Your Understanding

**Q1.** Why might a team choose the `docker-container` driver instead of the default `docker` driver?

<details>
<summary>Show answer</summary>

It provides a dedicated, configurable BuildKit instance with broad support for exporters, external caches, and multi-platform workflows. The tradeoff is that results are not automatically loaded into the local image store.

</details>

**Q2.** What responsibility belongs in Bake rather than in a Dockerfile?

<details>
<summary>Show answer</summary>

Bake coordinates the build matrix: targets, tags, platforms, cache policy, outputs, variables, and shared settings. The Dockerfile describes how an individual image or stage is constructed.

</details>

**Q3.** Why does a multi-platform image have more than one digest?

<details>
<summary>Show answer</summary>

The image index has its own digest, and it references one platform-specific manifest per variant, each with another digest. Policy and deployment tools must be clear about whether they pin or verify the index or a selected platform manifest.

</details>

**Q4.** What is the difference between `mode=min` and `mode=max` for a registry cache?

<details>
<summary>Show answer</summary>

`mode=min` exports cache associated with the final image path. `mode=max` also exports intermediate-stage cache, which can improve reuse but requires more registry storage.

</details>

**Q5.** Do `--sbom` and `--provenance` sign the image?

<details>
<summary>Show answer</summary>

No. They ask BuildKit to generate and attach evidence. Signing and identity verification are separate supply-chain controls covered in the next chapter.

</details>

## 25.10 Key takeaways

- Buildx decouples the Docker client from named BuildKit builders.
- Driver choice controls configuration, scale, output behavior, and operational responsibility.
- Bake makes multi-target build policy repeatable and reviewable.
- Multi-platform publication creates an image index containing platform-specific manifests.
- External caches speed ephemeral CI runners, but require isolation, retention, and careful Dockerfile design.
- SBOM and provenance attestations become useful when preserved, verified, and enforced against immutable digests.

## 25.11 Official documentation map

| Topic | Official page |
|-------|---------------|
| Builders | [Docker Build builders](https://docs.docker.com/build/builders/) |
| Build drivers | [Build drivers](https://docs.docker.com/build/builders/drivers/) |
| Bake | [Bake overview](https://docs.docker.com/build/bake/) |
| Bake file reference | [Bake file definition](https://docs.docker.com/build/bake/reference/) |
| Multi-platform builds | [Multi-platform builds](https://docs.docker.com/build/building/multi-platform/) |
| Cache backends | [Cache storage backends](https://docs.docker.com/build/cache/backends/) |
| Build attestations | [Build attestations](https://docs.docker.com/build/metadata/attestations/) |
| Buildx build flags | [`docker buildx build`](https://docs.docker.com/reference/cli/docker/buildx/build/) |

**Previous:** [Chapter 24 — Production Best Practices](24-production-best-practices.md) | **Next:** [Chapter 26 — Supply Chain and Trusted Content](26-supply-chain-and-trusted-content.md)
