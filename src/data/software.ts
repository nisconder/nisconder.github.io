export type SoftwareKind = 'tool' | 'integration' | 'game' | 'site' | 'service' | 'data'
export type SoftwareStatus = 'active' | 'stable' | 'experimental' | 'maintenance'

export const softwareKindLabels: Record<SoftwareKind, string> = {
  tool: '开发工具',
  integration: '生态集成',
  game: '互动作品',
  site: '网站',
  service: '站点服务',
  data: '数据项目',
}

export const softwareStatusLabels: Record<SoftwareStatus, string> = {
  active: '持续开发',
  stable: '稳定可用',
  experimental: '实验中',
  maintenance: '维护中',
}

export const softwareKindOrder: SoftwareKind[] = [
  'tool',
  'integration',
  'game',
  'site',
  'service',
  'data',
]

export const softwareStatusOrder: SoftwareStatus[] = [
  'active',
  'stable',
  'experimental',
  'maintenance',
]

export type SoftwareSort = 'priority' | 'updated' | 'name'

export interface SoftwareProject {
  slug: string
  name: string
  label: string
  summary: string
  kind: SoftwareKind
  status: SoftwareStatus
  tags: string[]
  language?: string
  stars?: number
  updatedAt: string
  sourceUrl?: string
  projectUrl?: string
  actionLabel?: string
  featured?: boolean
  fork?: boolean
  archived?: boolean
}

const softwareCatalog: SoftwareProject[] = [
  {
    slug: 'paste-xray',
    name: 'Paste X-Ray',
    label: 'PX',
    summary: '在浏览器本地检查零宽字符、Bidi 控制符、异常空白、隐藏 HTML 与换行差异，文本不会上传。',
    kind: 'tool',
    status: 'active',
    tags: ['Unicode', '剪贴板', '隐私', '文本分析'],
    language: 'JavaScript',
    stars: 3,
    updatedAt: '2026-08-29',
    sourceUrl: 'https://github.com/nisconder/paste-xray',
    projectUrl: 'https://nisconder.github.io/paste-xray/',
    actionLabel: '在线使用',
  },
  {
    slug: 'npm-safe',
    name: 'npm-safe',
    label: 'NS',
    summary: '安装 npm 包前先做本地供应链风险扫描，覆盖 CLI、桌面端、CI 与可选的 AI 分析。',
    kind: 'tool',
    status: 'active',
    tags: ['供应链安全', 'TypeScript', 'SQLite', 'CLI'],
    language: 'TypeScript',
    stars: 5,
    updatedAt: '2026-08-29',
    sourceUrl: 'https://github.com/nisconder/npm-safe',
    projectUrl: 'https://github.com/nisconder/npm-safe/releases',
    actionLabel: '下载版本',
    featured: true,
  },
  {
    slug: 'git-auto-updater',
    name: 'Git Auto Updater',
    label: 'GU',
    summary: '安全地批量同步本地 Git 仓库；发现未提交内容会自动停下，只接受快进更新。',
    kind: 'tool',
    status: 'stable',
    tags: ['Git', 'Python', '自动同步', '跨平台'],
    language: 'Python',
    stars: 4,
    updatedAt: '2026-08-01',
    sourceUrl: 'https://github.com/nisconder/git-auto-updater',
  },
  {
    slug: 'jcli-toolkit',
    name: 'JCLI Toolkit',
    label: 'JC',
    summary: '面向 Java 开发者的轻量 CLI，处理文件检索、批量重命名、同步对比与代码脚手架。',
    kind: 'tool',
    status: 'stable',
    tags: ['Java', 'CLI', '文件工具', '代码生成'],
    language: 'Java',
    stars: 3,
    updatedAt: '2026-08-01',
    sourceUrl: 'https://github.com/nisconder/jcli-toolkit',
  },
  {
    slug: 'ai-draw-guess',
    name: '生存竞速',
    label: 'AI',
    summary: '由 AI 生成文字描述的猜词生存游戏，包含三档难度、连击回血、成就和段位系统。',
    kind: 'game',
    status: 'experimental',
    tags: ['Next.js', 'TypeScript', 'AI 游戏', 'OpenAI API'],
    language: 'TypeScript',
    stars: 4,
    updatedAt: '2026-07-02',
    sourceUrl: 'https://github.com/nisconder/ai-draw-guess',
  },
  {
    slug: 'npm-safe-for-dsh',
    name: 'npm-safe for DSH',
    label: 'DS',
    summary: '把 npm-safe 的能力映射为 14 个 DeepSeek Harness 工具，让 Agent 在安装前直接完成安全检查。',
    kind: 'integration',
    status: 'active',
    tags: ['DeepSeek Harness', 'Agent Tools', 'TypeScript', '安全'],
    language: 'TypeScript',
    stars: 5,
    updatedAt: '2026-08-29',
    sourceUrl: 'https://github.com/nisconder/npm-safe-forDSH',
  },
  {
    slug: 'nisconder-blog',
    name: 'Nisconder Blog',
    label: 'NB',
    summary: '这个持续重写的个人站本身：文章、音乐、搜索、项目索引和主要页面末尾的讨论区。',
    kind: 'site',
    status: 'active',
    tags: ['Astro', 'Cloudflare Pages', '静态站点', 'Waline'],
    language: 'JavaScript',
    stars: 3,
    updatedAt: '2026-08-27',
    sourceUrl: 'https://github.com/nisconder/nisconder.github.io',
    projectUrl: '/',
    actionLabel: '访问本站',
  },
]

const nameCollator = new Intl.Collator(['zh-CN', 'en'], {
  numeric: true,
  sensitivity: 'base',
})

const compareFeatured = (left: SoftwareProject, right: SoftwareProject) =>
  Number(Boolean(right.featured)) - Number(Boolean(left.featured))

const compareUpdated = (left: SoftwareProject, right: SoftwareProject) =>
  right.updatedAt.localeCompare(left.updatedAt)

const compareName = (left: SoftwareProject, right: SoftwareProject) =>
  nameCollator.compare(left.name, right.name)

const compareSlug = (left: SoftwareProject, right: SoftwareProject) =>
  left.slug.localeCompare(right.slug)

export const softwareProjects = softwareCatalog.filter(
  (project) => project.fork !== true && project.archived !== true,
)

export function sortSoftwareProjects(
  projects: readonly SoftwareProject[],
  order: SoftwareSort = 'priority',
) {
  return [...projects].sort((left, right) => {
    if (order === 'name') {
      return compareName(left, right) || compareSlug(left, right)
    }

    if (order === 'updated') {
      return compareUpdated(left, right)
        || compareName(left, right)
        || compareSlug(left, right)
    }

    return compareFeatured(left, right)
      || compareUpdated(left, right)
      || compareName(left, right)
      || compareSlug(left, right)
  })
}

export const sortedSoftwareProjects = sortSoftwareProjects(softwareProjects, 'priority')

export const featuredSoftware =
  sortedSoftwareProjects.find((project) => project.featured) ?? sortedSoftwareProjects[0]
