import githubSnapshot from './github-repositories.json' with { type: 'json' }
import { mergeSoftwareProjects } from './software-sync.mjs'

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

// Human-written display metadata; old metrics are used only before the first
// successful GitHub sync. Afterwards GitHub supplies existence and live facts.
const softwareCatalog: SoftwareProject[] = [
  {
    slug: 'paste-xray',
    name: 'Paste X-Ray',
    label: 'PX',
    summary: '粘贴来的文字看着没问题，链接或代码却跑不通。这个小工具把隐藏字符和异常空白标出来，检查都在浏览器里完成。',
    kind: 'tool',
    status: 'active',
    tags: ['Unicode', '剪贴板', '隐私', '文本分析'],
    language: 'JavaScript',
    stars: 3,
    updatedAt: '2026-08-29',
    sourceUrl: 'https://github.com/nisconder/paste-xray',
    projectUrl: 'https://nisconder.github.io/paste-xray/',
    actionLabel: '在线体验',
  },
  {
    slug: 'npm-safe',
    name: 'npm-safe',
    label: 'NS',
    summary: '给准备安装的 npm 包做一次检查，把可疑脚本、发布内容和风险依据列出来，方便在敲下安装命令前多看一眼。',
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
    summary: '本地放着一批 Git 仓库时，用它定期检查并拉取更新。遇到未提交改动或无法快进的情况就停下来，留给人处理。',
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
    summary: '把找文件、批量改名和目录比对这些零碎工作收进一套 Java 命令行工具，也留了生成代码骨架的入口。',
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
    summary: '让 AI 用文字出谜面，在倒计时里猜出答案。答错会掉生命值，连续答对可以回血，是一场可以反复开局的猜词小实验。',
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
    summary: '让 DeepSeek Harness 里的 AI 在选 npm 包时先看看风险和依据。检查结果直接留在对话中，再决定是否安装。',
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
    summary: '你正在浏览的这个站。技术笔记、音乐和零碎想法都放在这里，代码也一起公开，记录它一点点调整的过程。',
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
  {
    // Keep anchors already issued by the automatic catalog.
    slug: 'github-1439832628',
    name: 'Pack Receipt',
    label: 'PR',
    summary: '看看一个 npm 发布包里究竟装了什么，再把两个版本的文件变化摆在一起。检查在浏览器本地完成，结果做成一张小票。',
    kind: 'tool',
    status: 'experimental',
    tags: ['npm', '发布包', '文件对比', '浏览器工具'],
    updatedAt: '2026-10-30',
    sourceUrl: 'https://github.com/nisconder/pack-receipt',
    projectUrl: 'https://nisconder.github.io/pack-receipt/',
    actionLabel: '在线体验',
  },
  {
    slug: 'github-1430976683',
    name: 'Portdoc',
    label: 'PD',
    summary: '本地服务明明启动了，浏览器却连不上时，用它对照 Windows、WSL 和 Docker 里的端口与进程，排查连接问题。',
    kind: 'tool',
    status: 'active',
    tags: ['本地开发', '端口诊断', 'WSL', 'Docker'],
    updatedAt: '2026-10-31',
    sourceUrl: 'https://github.com/nisconder/portdoc',
    projectUrl: 'https://www.npmjs.com/package/portdoc',
    actionLabel: '安装与用法',
  },
  {
    slug: 'github-1365703108',
    name: 'RoboMaster EP · Team 06',
    label: 'EP',
    summary: '课程小组一起做的 RoboMaster EP 项目，把巡线、标签识别和红灯停车接进同一套控制流程，也保留组员协作的接口与约定。',
    kind: 'integration',
    status: 'experimental',
    tags: ['课程项目', '机器人', 'Python', '协作'],
    updatedAt: '2026-09-11',
    sourceUrl: 'https://github.com/nisconder/team06-robomaster-ep',
  },
  {
    slug: 'github-1449359414',
    name: '8086 Step Lab',
    label: '86',
    summary: '配合 ICS 笔记，把一小段汇编逐条跑起来，看看寄存器、标志位和内存怎样变化；走错一步也可以退回去重新观察。',
    kind: 'tool',
    status: 'experimental',
    tags: ['8086', '汇编', '单步执行', '教学实验'],
    updatedAt: '2026-11-07',
    sourceUrl: 'https://github.com/nisconder/8086-step-lab',
    projectUrl: 'https://nisconder.github.io/8086-step-lab/',
    actionLabel: '在线体验',
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

export const softwareProjects: SoftwareProject[] = mergeSoftwareProjects(githubSnapshot, softwareCatalog)

export const softwareSyncInfo = {
  syncedAt: githubSnapshot.syncedAt as string | null,
  status: githubSnapshot.syncedAt === null ? 'pending' as const : 'synced' as const,
}

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
