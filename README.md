# Nisconder

技术文章、个人项目、阅读与音乐记录。

- 线上站点：[nisconder.pages.dev](https://nisconder.pages.dev/)
- 源码仓库：[nisconder/nisconder.github.io](https://github.com/nisconder/nisconder.github.io)
- 管理入口：[站点后台](https://nisconder.pages.dev/admin/)

## 当前实现

本站已经从 Hexo + Butterfly 迁移为 Astro 静态站点。仓库中的 `themes/butterfly`、部分旧 `source` 页面与旧样式仅用于保留历史内容或兼容迁移，不是当前前端的运行主题。

当前技术栈：

- Astro 7 与 Astro Content Collections
- TypeScript、原生 CSS 与少量原生 JavaScript
- Markdown 文章，源文件位于 `source/_posts`
- Decap CMS 写作后台
- Waline 留言系统，服务端与数据库独立部署
- Cloudflare Pages 静态托管

## 站点功能

- 首页展示真实的最新文章，并把置顶文章作为独立推荐，不让置顶状态干扰时间排序。
- 文章页包含预计阅读时长、阅读进度、目录、上一篇与下一篇，以及独立文章留言。
- 文章索引按真实年份归档，并提供分类与主题入口；站内搜索覆盖标题、正文、分类、标签和项目。
- 项目页只展示 Nisconder 的原创公开项目，默认重点项目优先、同组按更新时间倒序；fork、归档项目与部署基础设施不进入项目目录。
- 音乐页提供完整歌单、曲目切换与移动端触控操作。
- 首页、文章、项目、音乐和关于页面均可留言；移动端留言区按需展开并延迟加载。
- `/admin/` 是统一管理门户，可进入文章管理与 Waline 留言管理。
- 支持青、紫、白拼色主题、深色模式和桌面／移动响应式布局。
- 搜索索引只在访客准备搜索时预取，歌单与留言等第三方资源继续按需加载。

## 页面切换与动效

站内页面使用 Astro ClientRouter 切换：旧内容在 220ms 内淡出、轻微缩小并模糊，新内容在 420ms 内恢复到清晰的正常尺寸。页头单独保留为稳定的视觉参照；深浅主题切换只做淡入淡出，不叠加页面缩放。移动端使用更小的缩放和模糊幅度，系统开启“减少动态效果”时关闭这些动画。

搜索、项目筛选、阅读目录、APlayer 和 Waline 都在页面进入时初始化、离开时清理，避免返回页面后失效或重复绑定。新增页面交互时也需要遵守这个生命周期；RSS 使用完整页面导航，不交给站内路由处理。

## 原创项目目录

项目页当前收录 7 个原创公开项目：

- [npm-safe](https://github.com/nisconder/npm-safe)
- [npm-safe for DSH](https://github.com/nisconder/npm-safe-forDSH)
- [Paste X-Ray](https://github.com/nisconder/paste-xray)
- [Nisconder Blog](https://github.com/nisconder/nisconder.github.io)
- [Git Auto Updater](https://github.com/nisconder/git-auto-updater)
- [JCLI Toolkit](https://github.com/nisconder/jcli-toolkit)
- [生存竞速 / ai-draw-guess](https://github.com/nisconder/ai-draw-guess)

项目展示数据维护在 `src/data/software.ts`。默认重点优先，同组按 `updatedAt` 倒序排列，也允许切换为单纯的最近更新或名称排序。

## 本地开发

使用 Node.js 24，与 Cloudflare Pages 的 `NODE_VERSION=24` 和仓库 `.node-version` 保持一致。

安装锁定版本的依赖：

```bash
npm ci
```

启动开发服务器：

```bash
npm run dev
```

默认预览地址为 `http://127.0.0.1:4321/`。本地开发服务器已经处理 `/admin`、`/admin/content` 和 `/admin/comments` 的目录入口，不需要手动补 `index.html`。

生成生产静态文件：

```bash
npm run build
```

构建结果位于 `dist/`。本地检查生产构建：

```bash
npm run preview
```

`dev` 与 `build` 运行前会自动执行 `scripts/prepare-static.mjs`，把后台和媒体资源复制到 `static/`。因此后台源文件应修改 `source/admin/`，不要直接编辑生成的 `static/admin/`。

## 内容与排序规则

文章源文件位于 `source/_posts/`，由 `src/content.config.ts` 载入。公开文章会排除 `draft: true`，其余文章按 `date` 从新到旧排序；日期相同时以文件 ID 作为稳定的次级排序依据。

首页使用以下规则：

1. 首篇主文章始终取时间排序后的第一篇。
2. `sticky: true` 或数字权重的文章显示为独立置顶推荐。
3. 首页不再另放重复的“最近更新”列表，完整的时间归档放在文章索引页。

文章文件名同时作为稳定内容 ID 和公开 URL 的一部分。不要重命名已经发布的文章，否则原链接会改变。

文章索引页会从公开内容自动生成分类、主题和年份导航，不需要手工维护。预计阅读时长根据正文中的中日韩字符与拉丁词数计算，仅作为快速判断篇幅的提示。

## 写作后台

统一入口：

- `/admin/`：管理门户
- `/admin/content/`：Decap CMS 文章与媒体管理
- `/admin/content/#/collections/posts/new`：直接新建文章
- `/admin/comments/`：Waline 留言管理

Decap CMS 使用 GitHub OAuth，并直接向 `nisconder/nisconder.github.io` 的 `main` 分支提交内容。只有拥有仓库写入权限的 GitHub 账户可以发布。

### GitHub 登录与授权服务

授权服务固定使用 `https://netlify-cms-github-oauth-provider-khaki.vercel.app`。`source/admin/config.yml` 的 `backend.base_url` 必须使用这个生产域名，不要使用带部署哈希的 Vercel URL；旧部署不会因为生产环境变量更新而自动改变。

以下三处需要保持一致：

- 博客 `backend.base_url`：`https://netlify-cms-github-oauth-provider-khaki.vercel.app`
- Vercel 授权项目的 `REDIRECT_URL`：`https://netlify-cms-github-oauth-provider-khaki.vercel.app/callback`
- 对应 GitHub OAuth App 的 **Authorization callback URL**：同一个 `/callback` 地址。用 `OAUTH_CLIENT_ID` 对照应用的 Client ID，避免误改其他应用。

Vercel 授权项目的 `ORIGINS` 至少要允许 `nisconder.pages.dev`。保留新旧博客时填写 `nisconder.pages.dev,nisconder-blog.netlify.app`，不要加协议、路径、空格或全域通配符。Secret 类型的变量不会回显旧值，空白编辑框不表示原值为空；覆盖前应确认此授权项目服务哪些网站。

修改授权项目的环境变量后，重新部署该项目，让生产域名指向新部署；修改博客 `config.yml` 则需推送博客并等待 Pages 更新。两者不是同一次部署。GitHub 回调地址修改后，关闭旧登录弹窗，从刷新后的写作后台重新发起登录。

若弹窗停在空白回调页，控制台出现 `Invalid origin: https://nisconder.pages.dev`，检查实际回调部署里的 `ORIGINS`；若回调地址仍带旧部署哈希，先核对以上三处。不要通过关闭来源校验解决登录问题。

新文章文件名由 `source/admin/config.yml` 按以下规则生成：

```text
YYYY-MM-DD-blogHHMMSS.md
```

例如：

```text
2026-08-26-blog230400.md
```

日期字段固定为 `YYYY-MM-DD HH:mm:ss`，并使用作者所在时区的墙上时间，避免排序与旧文章永久链接发生偏移。写作时至少填写标题、摘要、日期、分类和正文；标签、草稿与首页置顶为可选项。

## Waline 留言

前端使用 Waline 3.7.1。服务端独立部署在 Vercel，数据存储在外部 PostgreSQL 数据库，不进入本仓库。

Waline 管理后台位于 `my-waline-pink.vercel.app`，评论前台位于 `nisconder.pages.dev`，浏览器不会直接共享两个域名的本地登录状态。管理员先登录 `/admin/comments/` 后，仍需在前台评论区点击一次“登录”，由 Waline 弹窗安全回传会话。同一浏览器中，后台勾选“记住我”且会话有效时，弹窗可复用已有登录；否则需在弹窗内登录一次。Netlify 旧域名的前台会话也不会自动迁移到 Pages。

这是 Waline 自带的弹窗会话交换流程，不要手动复制令牌，也不要关闭跨域来源校验。GitHub 写作后台的登录与 Waline 账户仍然独立。

- 公开留言由各页面末尾的留言区加载。
- `/admin/comments/` 会转到 Waline 管理界面。
- 管理员在 Waline 后台审核、编辑、置顶或删除留言。
- Waline 服务地址维护在 `src/components/Comments.astro` 与后台跳转页中；更换后端时需要同步修改两处。

## 目录结构

```text
src/
  components/        通用页头、页脚、留言、文章行与音乐组件
  data/              项目和歌单数据
  layouts/           页面基础布局
  lib/               文章读取、排序与 URL 工具
  pages/             首页、文章、项目、音乐、搜索、关于与数据端点
  styles/            全站样式与响应式规则
source/
  _posts/            Markdown 文章源文件
  admin/             管理门户、Decap CMS 与留言管理入口
  img/               站点图片
static/               静态资源与构建前复制产物
scripts/              构建前资源准备脚本
static/_headers       Cloudflare Pages 安全头与缓存配置
static/_redirects     Cloudflare Pages 历史页面跳转规则
netlify.toml          保留给旧 Netlify 站点的兼容配置
```

## 部署

Cloudflare Pages 连接 `nisconder/nisconder.github.io`，生产分支为 `main`，框架预设为 Astro，构建命令为 `npm run build`，输出目录为 `dist`，根目录留空。环境变量设置 `NODE_VERSION=24`。

推送到 `main` 后自动构建部署。Pages 的目录索引处理 `/admin/` 等后台入口，`static/_redirects` 处理历史页面跳转；`static/_headers` 为 `/_astro/*` 设置长期不可变缓存，并为后台禁用缓存及搜索引擎索引。不要给 `/admin/` 添加指向自身的重定向。

站点的规范地址由 `astro.config.mjs` 的 `site` 决定。再次换域名时还需要同步 `static/robots.txt` 和 `source/admin/config.yml` 中的展示地址。OAuth 和 Waline 后端保持独立部署，新域名下的管理员登录仍需单独验证；如后端限制来源域名，应更新其白名单，而不是盲目替换 OAuth 回调。

RSS 正文从 Markdown 渲染结果生成，不包含网页目录或阅读进度控件。`src/lib/feed-identity.ts` 保留迁移前两篇文章的原 GUID，仅文章链接切到新域名；新文章使用不依赖域名的标识。请勿为了清除旧域名文字而改写历史 GUID。

`netlify.toml` 暂时保留，旧 Netlify 入口与先前创建的 Pages 项目未自动删除或停用。确认新站后，应在各平台关闭不再使用项目的自动部署，避免重复构建。旧 RSS 地址和旧站跳转仍需在原托管平台可部署时另行处理。

### 导航加载

Astro 已默认在悬停链接时预取。顶部四个主导航入口进一步使用可见时预取，让小体积 HTML 提前进入浏览器缓存；其余链接不做全站批量预加载。Astro 在省流量或慢速连接下会限制预取。

页面请求超过 150ms 时，页头青紫分隔线显示等待反馈，加载完成、失败或取消后清除；这不是虚构的百分比，也不阻止继续点击。原有页面切换动画保留。

音乐页的 APlayer 样式和脚本由播放器异步加载，不让外部 CDN 等待阻塞整页切换。播放器独立显示加载/失败状态，版本保持 1.10.1。

回归检查：`node --test scripts/tests/*.test.mjs`，之后运行 `npm run build`。这些修改减少可避免的资源阻塞，但不能保证消除访客到 Pages/Vercel/CDN 的网络延迟。
