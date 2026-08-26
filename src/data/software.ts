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
}

export const softwareProjects: SoftwareProject[] = [
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
    updatedAt: '2026-08-22',
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
    updatedAt: '2026-08-03',
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
    updatedAt: '2026-08-03',
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
    updatedAt: '2026-08-03',
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
    stars: 4,
    updatedAt: '2026-08-26',
    sourceUrl: 'https://github.com/nisconder/npm-safe-forDSH',
  },
  {
    slug: 'nisconder-blog',
    name: 'Nisconder Blog',
    label: 'NB',
    summary: '这个持续重写的个人站本身：文章、音乐、搜索、软件园和主要页面末尾的讨论区。',
    kind: 'site',
    status: 'active',
    tags: ['Astro', 'Netlify', '静态站点', 'Waline'],
    language: 'JavaScript',
    stars: 3,
    updatedAt: '2026-08-26',
    sourceUrl: 'https://github.com/nisconder/nisconder.github.io',
    projectUrl: '/',
    actionLabel: '访问本站',
  },
  {
    slug: 'my-waline',
    name: 'My Waline',
    label: 'WL',
    summary: '为本站评论与留言提供后端能力的 Waline 服务实例，独立部署在 Vercel。',
    kind: 'service',
    status: 'stable',
    tags: ['Waline', 'Vercel', 'Node.js', '评论服务'],
    language: 'JavaScript',
    stars: 0,
    updatedAt: '2026-08-06',
    projectUrl: 'https://my-waline-pink.vercel.app',
    actionLabel: '服务地址',
  },
]

export const featuredSoftware =
  softwareProjects.find((project) => project.featured) ?? softwareProjects[0]
