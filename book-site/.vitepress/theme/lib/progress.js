const STORAGE_KEY = 'z2p-progress'
const FOCUS_KEY = 'z2p-focus'

/** Chapter paths that count toward overall progress (exclude home, style guide, assets). */
export const TRACKED_CHAPTERS = [
  '00-preface.md',
  '01-docker-why-and-what.md',
  '02-docker-installation-and-architecture.md',
  '03-docker-images-deep-dive.md',
  '04-dockerfiles-and-builds.md',
  '05-docker-containers-management.md',
  '06-docker-networking.md',
  '07-docker-volumes-and-data.md',
  '08-docker-compose.md',
  '09-docker-swarm-intro.md',
  '10-docker-security-basics.md',
  '11-kubernetes-introduction.md',
  '12-k8s-architecture.md',
  '13-pods-the-fundamental-unit.md',
  '14-workloads-deployments-and-beyond.md',
  '15-k8s-services.md',
  '16-ingress-and-gateway-api.md',
  '17-configuration-and-secrets.md',
  '18-k8s-storage.md',
  '19-k8s-networking-cni-and-policies.md',
  '20-scheduling-and-advanced-placement.md',
  '21-rbac-and-security.md',
  '22-observability.md',
  '23-helm.md',
  '24-production-best-practices.md',
  '25-docker-build-deep-dive.md',
  '26-supply-chain-and-trusted-content.md',
  '27-docker-engine-operations.md',
  '28-cluster-lifecycle-kubeadm.md',
  '29-extending-kubernetes.md',
  '30-object-management-advanced.md',
  '31-multitenancy-policy-governance.md',
  '32-advanced-networking-traffic.md',
  '33-day2-operations-and-sre.md',
]

export function normalizePath(relativePath) {
  if (!relativePath) return ''
  return relativePath.replace(/\\/g, '/')
}

export function getRawProgress() {
  if (typeof localStorage === 'undefined') return { visited: {}, last: null }
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"visited":{},"last":null}')
  } catch {
    return { visited: {}, last: null }
  }
}

export function getProgress() {
  const raw = getRawProgress()
  const visitedSet = new Set(Object.keys(raw.visited || {}))
  const done = TRACKED_CHAPTERS.filter((c) => visitedSet.has(c)).length
  const percent = Math.round((done / TRACKED_CHAPTERS.length) * 100)
  return {
    percent,
    done,
    total: TRACKED_CHAPTERS.length,
    last: raw.last,
    visited: raw.visited || {},
  }
}

export function trackProgress(relativePath) {
  if (typeof localStorage === 'undefined') return
  const path = normalizePath(relativePath)
  if (!path || path === 'index.md' || path.includes('STYLE-GUIDE')) return

  const raw = getRawProgress()
  raw.visited = raw.visited || {}
  raw.visited[path] = Date.now()
  if (TRACKED_CHAPTERS.includes(path) || path.startsWith('appendices/')) {
    raw.last = {
      path,
      href: '/' + path.replace(/\.md$/, ''),
      title: path.replace(/\.md$/, '').replace(/^appendices\//, '').replace(/-/g, ' '),
      at: Date.now(),
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw))
  window.dispatchEvent(new Event('z2p-progress'))
}

export function isFocusMode() {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(FOCUS_KEY) === '1'
}

export function setFocusMode(on) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(FOCUS_KEY, on ? '1' : '0')
  document.documentElement.classList.toggle('z2p-focus', on)
}
