# Chapter 22 — Observability

> **Learning Objectives**
>
> By the end of this chapter, you will be able to:
>
> - Explain metrics, logs, and traces in a Kubernetes context
> - Install and use metrics-server for resource metrics and `kubectl top`
> - Approach the Kubernetes Dashboard safely (or choose safer alternatives)
> - Design a logging architecture with node agents, optional sidecars, and node log query
> - Describe Prometheus and Grafana as the common metrics stack
> - Outline OpenTelemetry for distributed traces
> - Use PSI metrics (cgroup v2, GA in Kubernetes 1.36) as contention signals
> - Avoid monitoring anti-patterns that create blind spots or security holes

---

## 22.1 Flying blind versus instrument panels

You would not fly a passenger jet with taped-over gauges. CPU spikes, memory leaks, crashing containers, and slow API calls are the turbulence of production systems. **Observability** is the discipline of making a system’s internal state visible from the outside through **metrics**, **logs**, and **traces**.

Kubernetes gives you building blocks (Events, container logs, resource metrics APIs, kubelet Summary API). Production teams usually add a metrics stack (often **Prometheus** + **Grafana**), a log pipeline, and eventually **OpenTelemetry** traces. This chapter builds the mental model and the first practical tools—without pretending a single dashboard solves reliability.

---

## 22.2 The three pillars (Kubernetes flavor)

### In plain terms

**Metrics** tell you *how much* and *how often*. **Logs** tell you *what happened* in words. **Traces** tell you *where time went* across services. You need all three for different questions; none replaces the others.

### Under the hood

| Pillar | Questions answered | Typical tools |
|--------|--------------------|---------------|
| **Metrics** | How hot? How saturated? How many errors per second? | metrics-server, Prometheus, kube-state-metrics, PSI |
| **Logs** | What exactly happened in this request/process? | stdout/stderr, node log query, Loki/ELK, cloud logs |
| **Traces** | Where did time go across services? | OpenTelemetry, Jaeger, Tempo, cloud APM |

<!-- VISUAL: Triangle labeled Metrics / Logs / Traces with Kubernetes API server and apps in the center -->

### In production

1. Start with metrics and logs; add traces as service count and latency mysteries grow.
2. Define golden signals (latency, traffic, errors, saturation) per user-facing Service.
3. Prefer symptom-based alerts over “Pod restarted once.”

---

## 22.3 metrics-server: resource metrics for the control plane

### In plain terms

**metrics-server** scrapes kubelets for CPU and memory usage and exposes the **Metrics API** (`metrics.k8s.io`). It powers `kubectl top` and resource-based Horizontal Pod Autoscalers. It is a live gauge cluster, not a historical archive.

### Under the hood

```bash
$ kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

On local clusters you may need flags such as `--kubelet-insecure-tls`—follow current metrics-server docs for your environment.

```bash
$ kubectl top nodes
NAME       CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-1   120m         6%     1200Mi          35%
worker-2   80m          4%     900Mi           28%

$ kubectl top pods -n tasks
NAME                        CPU(cores)   MEMORY(bytes)
task-api-6d7f8c9b5d-xk2m9   15m          64Mi
task-api-6d7f8c9b5d-qw8pz    12m          58Mi
```

> ⚠️ **Common Pitfall:** HPA on CPU/memory will not work without a functioning Metrics API. If `kubectl top` fails, fix metrics-server before debugging HPA formulas.

> 💡 **Tip:** metrics-server is **not** long-term metrics storage. Historical graphs need Prometheus (or a cloud metrics backend).

### In production

1. Treat Metrics API outages as autoscaling outages—monitor metrics-server itself.
2. Do not use metrics-server as your only capacity signal; combine with Prometheus and PSI (below).
3. On managed clouds, use the provider’s equivalent if they replace metrics-server.

---

## 22.4 Kubernetes Dashboard: powerful and easy to misuse

### In plain terms

A web UI that can list workloads and logs is convenient. The same UI with `cluster-admin` on the public internet is a root shell with a paint job.

### Under the hood

Safety guidelines:

1. Prefer **read-only** RBAC bindings for dashboard users
2. Do not expose the Dashboard on a public LoadBalancer without strong auth
3. Prefer authenticated reverse proxies, VPN, or cloud IAM integrations
4. On learning clusters, use `kubectl proxy` temporarily rather than permanent NodePorts
5. Many production teams skip Dashboard entirely and use Grafana + GitOps UIs

```bash
$ kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml
# Pin a release you trust and read its install guide—versions change

$ kubectl -n kubernetes-dashboard create token admin-user
$ kubectl proxy
Starting to serve on 127.0.0.1:8001
```

### In production

1. Prefer not installing Dashboard on production clusters unless there is a clear, audited need.
2. Short-lived tokens only; never long-lived admin kubeconfigs in browsers.
3. Audit Dashboard access via API audit logs ([Chapter 21](21-rbac-and-security.md)).

---

## 22.5 Logging architecture and node log query

### In plain terms

Applications should write to **stdout/stderr**. The kubelet keeps runtime logs on the node; `kubectl logs` reads them. Cluster-wide search needs a shipper. When you need **node** or **systemd**-style logs without SSH, Kubernetes **node log query** (stable in **1.36**) exposes a kubelet API for selected system logs.

### Under the hood

```bash
$ kubectl logs deploy/task-api -n tasks --tail=100
$ kubectl logs task-api-6d7f8c9b5d-xk2m9 -c api -n tasks --previous
```

`--previous` shows logs from the last terminated container—gold for CrashLoopBackOff.

**Collection patterns:**

1. **Node agent / DaemonSet** (most common): Fluent Bit, Fluentd, or Vector on every node
2. **Sidecar**: helper container for apps that only write files
3. **Direct app ship**: SDKs push to a backend (use sparingly)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: task-api-with-log-sidecar
  namespace: tasks
spec:
  containers:
    - name: api
      image: ghcr.io/mastering-k8s/task-api:1.1
      volumeMounts:
        - name: applogs
          mountPath: /var/log/task-api
    - name: log-shipper
      image: fluent/fluent-bit:3.0
      volumeMounts:
        - name: applogs
          mountPath: /var/log/task-api
          readOnly: true
  volumes:
    - name: applogs
      emptyDir: {}
```

**Node log query** (kubelet must allow it; GA/locked on in 1.36 when platform-enabled):

```bash
$ kubectl get --raw "/api/v1/nodes/worker-1/proxy/logs/?query=kubelet"
```

Use this to inspect kubelet or other permitted system services without SSH. Access is still gated by RBAC on the node proxy/logs subresource—treat it as privileged.

<!-- VISUAL: Nodes with DaemonSet agents shipping to a central log store; optional sidecar; node log query arrow from kubectl to kubelet -->

### In production

1. Prefer stdout + node agents for new apps; sidecars only when you cannot change the app.
2. Ship logs off-node; local rotation is not a retention strategy.
3. Restrict who can query node logs—same blast radius class as node shell access.
4. Structure app logs as JSON with request IDs for correlation with traces.

---

## 22.6 Events and probes as signals

Do not ignore first-class Kubernetes signals:

```bash
$ kubectl get events -n tasks --sort-by=.lastTimestamp
$ kubectl describe pod task-api-6d7f8c9b5d-xk2m9 -n tasks
```

FailedScheduling, OOMKilled, Unhealthy probes, and FailedMount often explain outages before you open Grafana. Instrument apps with readiness/liveness/startup probes ([Chapter 13](13-pods-the-fundamental-unit.md)) so orchestration and observability agree on “healthy.”

---

## 22.7 Prometheus and Grafana

### In plain terms

**Prometheus** scrapes HTTP metrics endpoints on a schedule, stores time series, and evaluates alert rules. **Grafana** turns those series into dashboards humans can use at 3 a.m. Together with **kube-state-metrics** and node exporters, they form the de facto open-source Kubernetes metrics stack.

### Under the hood

Typical components (often installed via Helm—[Chapter 23](23-helm.md)):

- Prometheus (or Grafana Mimir / managed Prometheus)
- kube-state-metrics — object state as metrics
- node-exporter (or equivalent) — node OS/hardware metrics
- Grafana dashboards and Alertmanager

Application metrics:

```text
http_requests_total{method="GET",path="/tasks",status="200"} 1240
```

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8000"
    prometheus.io/path: "/metrics"
```

(Exact discovery depends on your Prometheus configuration—annotations are a common beginner pattern; operators prefer PodMonitor/ServiceMonitor CRDs.)

> 📘 **Deep Dive (optional):** Alertmanager routes alerts to Slack, PagerDuty, email. Good alerts are symptom-based (“error rate high”) rather than “pod restarted once.”

### In production

1. Budget cardinality—high-label metrics can melt Prometheus.
2. Alert on user symptoms first; page on saturation second.
3. Keep recording rules and dashboards in Git with the chart that deploys them.

---

## 22.8 Traces and OpenTelemetry overview

### In plain terms

When a single user request fans out across the Task API, a database, and a cache, logs from each piece do not show *which* hop was slow. A **distributed trace** is a tree of **spans** tied by a trace ID—like a baggage tag that follows the request through every airport. **OpenTelemetry (OTel)** is the vendor-neutral standard for producing those spans (and metrics/logs) from applications and infrastructure.

### Under the hood

Core ideas:

- **Trace** — one end-to-end request
- **Span** — a unit of work (HTTP handler, DB query) with timestamps and attributes
- **Context propagation** — W3C `traceparent` (or similar) headers carry IDs across services
- **Collector** — OpenTelemetry Collector receives, processes, and exports to Jaeger, Tempo, cloud APM, and so on

Minimal application posture for the Task API:

1. Instrument the HTTP server with an OTel SDK or auto-instrumentation for Python
2. Propagate context on outbound calls
3. Export via OTLP to a Collector DaemonSet or Gateway
4. Visualize in Jaeger/Tempo/Grafana

Conceptual Collector pipeline (values vary by chart):

```yaml
# Conceptual — install via an OpenTelemetry Collector chart in real clusters
receivers:
  otlp:
    protocols:
      http:
      grpc:
exporters:
  otlp:
    endpoint: tempo.observability.svc:4317
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlp]
```

Correlate with logs by injecting the trace ID into structured log lines.

### In production

1. Sample traces thoughtfully—100% retention of every span at scale is expensive.
2. Start with ingress and critical Service boundaries before instrumenting every library call.
3. Protect OTLP endpoints; treat them as production data planes.
4. Use traces to answer latency mysteries; keep metrics for SLOs and paging.

---

## 22.9 PSI metrics (cgroup v2, GA in 1.36)

### In plain terms

CPU percentage says “how busy.” **Pressure Stall Information (PSI)** says “how long tasks waited because the resource was contested.” A container can show moderate CPU usage and still be starving. PSI (GA in Kubernetes **1.36**) exposes that wait time for CPU, memory, and I/O—when nodes run **cgroup v2** and a supporting Linux kernel.

### Under the hood

Requirements:

- Linux kernel 4.20+ with PSI enabled (not booted with `psi=0`)
- **cgroup v2**
- Kubernetes 1.36+ kubelet PSI support (stable; no feature-gate opt-in required on 1.36)

Metrics appear in the kubelet Summary API and Prometheus-style `/metrics/cadvisor` endpoints (`container_pressure_*` families).

```bash
$ NODE=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
$ kubectl get --raw "/api/v1/nodes/${NODE}/proxy/stats/summary" | \
  jq '.pods[].containers[] | select(.name=="api") | {name, cpu:.cpu.psi, memory:.memory.psi, io:.io.psi}'
```

Interpret `some` versus `full` pressure averages (10s / 60s / 5m): sustained high pressure is a contention signal worth alerting on—even when utilization charts look “fine.”

> 💡 **Tip:** PSI complements, not replaces, classic CPU/memory metrics. Use both when diagnosing noisy neighbors and false “plenty of headroom” assumptions.

### In production

1. Confirm cgroup v2 on node images before building alerts on PSI.
2. Windows nodes omit PSI—expect mixed clusters to report unevenly.
3. Feed PSI into capacity and rightsizing conversations with HPA/VPA ([Chapter 24](24-production-best-practices.md)) and node-pressure eviction ([Chapter 20](20-scheduling-and-advanced-placement.md)).
4. Alert on sustained full pressure for latency-critical namespaces.

---

## 22.10 A practical observability starter kit

For the Task API in production-minded labs:

1. Confirm metrics-server: `kubectl top pods`
2. Structured JSON logs to stdout (request ID, latency, status)
3. `kubectl logs` + a DaemonSet log shipper if you have a backend
4. Expose Prometheus metrics for request rate, errors, duration
5. Import a Grafana dashboard for Deployment CPU/memory and app SLIs
6. Add OTel traces for multi-hop paths when latency debugging stalls
7. On cgroup v2 nodes, graph PSI alongside utilization
8. Alert on high error rate and sustained elevated latency—not on every restart

---

## 22.11 Common pitfalls

> ⚠️ **Common Pitfall:** Assuming `kubectl logs` history lasts forever. Node log rotation drops old data.

> ⚠️ **Common Pitfall:** Scraping every Pod without cardinality budgets.

> ⚠️ **Common Pitfall:** Metrics without requests/limits context—200Mi used against a 256Mi limit is an OOM waiting to happen.

> ⚠️ **Common Pitfall:** Equating “Dashboard installed” with “observability done.”

> ⚠️ **Common Pitfall:** Alerting on raw CPU% alone while ignoring PSI contention on busy nodes.

---

## 22.12 Hands-on exercises

1. **metrics-server.** Run `kubectl top nodes` and `kubectl top pods -A`. Repair if needed.
2. **App logs.** Generate traffic and fetch logs with `kubectl logs deploy/task-api --tail=50`. Use `--previous` after a crash.
3. **Events.** Break a ConfigMap reference in a scratch env and watch Events explain the failure.
4. **Node log query.** If enabled on your cluster, query kubelet logs via the node proxy logs API and note the RBAC required.
5. **Metrics endpoint.** Expose `/metrics` on Task API (or a demo exporter) and verify a scrape.
6. **PSI check.** On a cgroup v2 node, pull Summary API PSI fields for a container. If absent, document why (OS/cgroup).

---

## 22.13 Check Your Understanding

**Q1.** What API does metrics-server provide, and what everyday command depends on it?

<details>
<summary>Show answer</summary>

The **Metrics API** (`metrics.k8s.io`). `kubectl top` (and resource-based HPA) depend on it.

</details>

**Q2.** Why is metrics-server insufficient as your only metrics system?

<details>
<summary>Show answer</summary>

It stores only recent resource usage for operational APIs—not long-term retention, rich app metrics, or flexible alerting.

</details>

**Q3.** Where should twelve-factor style apps write logs in Kubernetes?

<details>
<summary>Show answer</summary>

**stdout/stderr**, so kubelet and log agents can collect them uniformly.

</details>

**Q4.** What does OpenTelemetry primarily standardize for distributed systems?

<details>
<summary>Show answer</summary>

Vendor-neutral **telemetry**—especially **traces** (and also metrics/logs)—including context propagation and export via collectors to backends such as Jaeger or Tempo.

</details>

**Q5.** What do PSI metrics measure that simple CPU utilization may miss, and what OS requirement applies?

<details>
<summary>Show answer</summary>

PSI measures **time tasks spend stalled** waiting for CPU, memory, or I/O under contention. It requires **cgroup v2** (and a supporting Linux kernel). It became **GA in Kubernetes 1.36**.

</details>

---

## 22.14 Key takeaways

- Observability needs metrics, logs, and traces—wired into alerts you will actually act on.
- metrics-server enables `kubectl top` and CPU/memory autoscaling; it is not a full monitoring platform.
- Log to stdout; collect with node agents; use node log query for kubelet/system logs without SSH when enabled.
- Prometheus + Grafana remain the common open-source metrics stack; OpenTelemetry is the path for traces.
- PSI (cgroup v2, GA in 1.36) surfaces contention that utilization charts can hide.

---

## 22.15 Official documentation map

| Topic | Official page |
|-------|---------------|
| Tools for Monitoring | [Tools for Monitoring Resources](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) |
| Metrics Server | [Kubernetes Metrics Server](https://github.com/kubernetes-sigs/metrics-server) |
| Logging Architecture | [Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) |
| System Logs / node log query | [System Logs](https://kubernetes.io/docs/concepts/cluster-administration/system-logs/) |
| Node metrics / PSI | [Node metrics data](https://kubernetes.io/docs/reference/instrumentation/node-metrics/) |
| PSI GA blog | [PSI Metrics GA](https://kubernetes.io/blog/2026/05/12/kubernetes-v1-36-psi-metrics-ga/) |
| OpenTelemetry | [OpenTelemetry](https://opentelemetry.io/docs/) |
| Prometheus | [Prometheus](https://prometheus.io/docs/introduction/overview/) |

**Previous:** [Chapter 21 — RBAC and Security](21-rbac-and-security.md) | **Next:** [Chapter 23 — Helm](23-helm.md)
