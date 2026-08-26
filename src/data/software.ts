export interface SoftwareProject {
  slug: string
  name: string
  label: string
  summary: string
  status: string
  tags: string[]
  sourceUrl: string
  projectUrl?: string
  featured?: boolean
}

export const softwareProjects: SoftwareProject[] = [
  {
    slug: 'npm-safe',
    name: 'npm-safe',
    label: 'NS',
    summary: '本地优先的 npm 包供应链安全分析引擎，提供 CLI、桌面端与 AI Skill。',
    status: '持续开发',
    tags: ['TypeScript', 'Node.js', 'SQLite'],
    sourceUrl: 'https://github.com/nisconder/npm-safe',
    projectUrl: 'https://github.com/nisconder/npm-safe/releases',
    featured: true,
  },
  {
    slug: 'ai-draw-guess',
    name: '生存竞速',
    label: 'AI',
    summary: '基于 AI 文字描述的猜词生存游戏，支持多种兼容 OpenAI API 的模型服务。',
    status: '实验项目',
    tags: ['Next.js', 'TypeScript', 'AI 游戏'],
    sourceUrl: 'https://github.com/nisconder/ai-draw-guess',
  },
  {
    slug: 'nisconder-blog',
    name: 'Nisconder Blog',
    label: 'NB',
    summary: '这个正在被持续重写的个人站：文章、音乐、搜索，以及正在扩展的软件园。',
    status: '本站',
    tags: ['Astro', 'Netlify', '静态站点'],
    sourceUrl: 'https://github.com/nisconder/nisconder.github.io',
    projectUrl: '/',
  },
]

export const featuredSoftware =
  softwareProjects.find((project) => project.featured) ?? softwareProjects[0]
