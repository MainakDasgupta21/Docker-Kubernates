import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const partI = [
  { text: '01 — Docker: Why and What', link: '/01-docker-why-and-what' },
  { text: '02 — Installation and Architecture', link: '/02-docker-installation-and-architecture' },
  { text: '03 — Images Deep Dive', link: '/03-docker-images-deep-dive' },
  { text: '04 — Dockerfiles and Builds', link: '/04-dockerfiles-and-builds' },
  { text: '05 — Container Management', link: '/05-docker-containers-management' },
  { text: '06 — Docker Networking', link: '/06-docker-networking' },
  { text: '07 — Volumes and Data', link: '/07-docker-volumes-and-data' },
  { text: '08 — Docker Compose', link: '/08-docker-compose' },
  { text: '09 — Docker Swarm Intro', link: '/09-docker-swarm-intro' },
  { text: '10 — Docker Security Basics', link: '/10-docker-security-basics' },
]

const partII = [
  { text: '11 — Kubernetes Introduction', link: '/11-kubernetes-introduction' },
  { text: '12 — Kubernetes Architecture', link: '/12-k8s-architecture' },
  { text: '13 — Pods', link: '/13-pods-the-fundamental-unit' },
  { text: '14 — Workloads', link: '/14-workloads-deployments-and-beyond' },
  { text: '15 — Services', link: '/15-k8s-services' },
  { text: '16 — Ingress and Gateway API', link: '/16-ingress-and-gateway-api' },
  { text: '17 — Configuration and Secrets', link: '/17-configuration-and-secrets' },
]

const partIII = [
  { text: '18 — Storage', link: '/18-k8s-storage' },
  { text: '19 — CNI and Policies', link: '/19-k8s-networking-cni-and-policies' },
  { text: '20 — Scheduling and Placement', link: '/20-scheduling-and-advanced-placement' },
  { text: '21 — RBAC and Security', link: '/21-rbac-and-security' },
  { text: '22 — Observability', link: '/22-observability' },
  { text: '23 — Helm', link: '/23-helm' },
  { text: '24 — Production Best Practices', link: '/24-production-best-practices' },
]

const partIV = [
  { text: '25 — Docker Build Deep Dive', link: '/25-docker-build-deep-dive' },
  { text: '26 — Supply Chain', link: '/26-supply-chain-and-trusted-content' },
  { text: '27 — Engine Operations', link: '/27-docker-engine-operations' },
  { text: '28 — Cluster Lifecycle', link: '/28-cluster-lifecycle-kubeadm' },
  { text: '29 — Extending Kubernetes', link: '/29-extending-kubernetes' },
  { text: '30 — Object Management', link: '/30-object-management-advanced' },
  { text: '31 — Multi-tenancy', link: '/31-multitenancy-policy-governance' },
  { text: '32 — Advanced Networking', link: '/32-advanced-networking-traffic' },
  { text: '33 — Day-2 Ops and SRE', link: '/33-day2-operations-and-sre' },
]

const appendices = [
  { text: 'A — Docker Cheatsheet', link: '/appendices/a-cheatsheet-docker' },
  { text: 'B — kubectl Cheatsheet', link: '/appendices/b-cheatsheet-kubectl' },
  { text: 'C — Further Resources', link: '/appendices/c-further-resources' },
  { text: 'D — Answers and Capstone', link: '/appendices/d-answers' },
  { text: 'E — Glossary', link: '/appendices/e-glossary' },
  { text: 'F — Official Docs Map', link: '/appendices/f-official-docs-map' },
  { text: 'G — Version Migration', link: '/appendices/g-version-migration' },
  { text: 'H — Figure Index', link: '/appendices/h-figure-index' },
]

export default withMermaid(
  defineConfig({
    title: 'Zero to Production',
    description:
      'Mastering Docker and Kubernetes — from first principles to day-2 SRE, taught plain → hood → production floor.',
    srcDir: 'docs',
    srcExclude: ['**/.synced-from', '**/STYLE-GUIDE.md', '**/assets/README.md'],
    cleanUrls: true,
    lastUpdated: true,
    ignoreDeadLinks: true,
    appearance: 'dark',

    head: [
      [
        'link',
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap',
        },
      ],
      ['meta', { name: 'theme-color', content: '#0b1220' }],
    ],

    themeConfig: {
      logo: '/brand-mark.svg',
      siteTitle: 'Zero to Production',
      nav: [
        { text: 'Start', link: '/00-preface' },
        { text: 'Docker', link: '/01-docker-why-and-what' },
        { text: 'Kubernetes', link: '/11-kubernetes-introduction' },
        { text: 'Production', link: '/24-production-best-practices' },
        { text: 'Appendices', link: '/appendices/a-cheatsheet-docker' },
      ],
      sidebar: [
        {
          text: 'Front matter',
          items: [
            { text: 'Home', link: '/' },
            { text: 'Preface', link: '/00-preface' },
          ],
        },
        { text: 'Part I — Docker Foundations', collapsed: false, items: partI },
        { text: 'Part II — Kubernetes Foundations', collapsed: true, items: partII },
        { text: 'Part III — Toward Production', collapsed: true, items: partIII },
        { text: 'Part IV — Advanced Ops and SRE', collapsed: true, items: partIV },
        { text: 'Appendices', collapsed: true, items: appendices },
      ],
      search: {
        provider: 'local',
        options: {
          detailedView: true,
        },
      },
      outline: {
        level: [2, 3],
        label: 'On this page',
      },
      socialLinks: [],
      footer: {
        message: 'Plain → hood → production floor',
        copyright: 'Mastering Docker and Kubernetes · Docker Engine 29.x · Kubernetes 1.36',
      },
      docFooter: {
        prev: 'Previous chapter',
        next: 'Next chapter',
      },
      returnToTopLabel: 'Back to top',
      sidebarMenuLabel: 'Chapters',
      darkModeSwitchLabel: 'Appearance',
      lightModeSwitchTitle: 'Switch to light',
      darkModeSwitchTitle: 'Switch to dark',
    },

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
      lineNumbers: false,
    },

    vite: {
      resolve: {
        dedupe: ['vue'],
      },
      publicDir: resolve(__dirname, 'public'),
      plugins: [
        {
          name: 'z2p-escape-mustache',
          enforce: 'pre',
          transform(code, id) {
            if (!id.includes('.md')) return null
            if (/[\\/]index\.md(?:\?|$)/.test(id)) return null
            if (!code.includes('{{')) return null
            return code
              .replace(/\{\{/g, '&#123;&#123;')
              .replace(/\}\}/g, '&#125;&#125;')
          },
        },
      ],
    },

    mermaid: {
      theme: 'base',
      themeVariables: {
        primaryColor: '#134e4a',
        primaryTextColor: '#e8eef7',
        primaryBorderColor: '#5eead4',
        lineColor: '#7dd3fc',
        secondaryColor: '#0f172a',
        tertiaryColor: '#162033',
        background: '#0b1220',
        mainBkg: '#121a2b',
        nodeBorder: '#5eead4',
        clusterBkg: '#0a1424',
        titleColor: '#e8eef7',
        edgeLabelBackground: '#0b1220',
      },
    },
  }),
)
