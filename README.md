# 不知名博客

个人博客项目，基于 Hexo + Butterfly 主题。

线上地址：
https://nisconder-blog.netlify.app/

## 技术栈

- Hexo 8
- hexo-theme-butterfly
- hexo-tag-aplayer（含 meting 标签支持）

## 本地开发

安装依赖：

```bash
npm install
```

启动本地服务：

```bash
npm run server
```

生成静态文件：

```bash
npm run build
```

清理缓存与产物：

```bash
npm run clean
```

## 常用写作命令

新建文章：

```bash
hexo new "文章标题"
```

常用内容目录：

- 文章：source/_posts
- 标签页：source/tags/index.md
- 分类页：source/categories/index.md
- 音乐页：source/music/index.md
- 自定义样式：source/css/personal-theme.css

## 站点配置

- Hexo 主配置：_config.yml
- Butterfly 主题配置：_config.butterfly.yml

当前站点 URL 已配置为：

```yaml
url: https://nisconder-blog.netlify.app/
```

## 发布说明

本项目输出静态文件到 public 目录，可直接用于 Netlify 部署。

## Waline 评论部署

本博客使用 [Waline](https://waline.js.org/) 提供评论与浏览量服务。Waline 后端独立部署在 Vercel，评论数据存储在 Neon PostgreSQL 数据库，不放入本仓库。以下为一次性部署步骤（约 15 分钟）：

### 1. 部署 Waline 服务端到 Vercel

1. 打开 [Waline Vercel 部署页面](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwalinejs%2Fwaline%2Ftree%2Fmain%2Fexample)，使用 GitHub 账户登录 Vercel。
2. 输入一个喜欢的项目名称（如 `my-waline`），点击 `Create`。Vercel 会基于 Waline 模板自动创建并初始化仓库。
3. 等待一两分钟，部署成功后点击 `Go to Dashboard` 进入控制台。

### 2. 创建 Neon 数据库并建表

1. 在 Vercel 控制台点击顶部 `Storage` → `Create Database`，在 `Marketplace Database Providers` 中选择 `Neon`，点击 `Continue`。
2. 按提示创建 Neon 账号（选择 `Accept and Create`），地区和额度可保持默认，点击 `Continue`。
3. 定义数据库名称（可保持默认），点击 `Continue`。
4. 在 `Storage` 下点击刚创建的数据库，选择 `Open in Neon` 跳转到 Neon 控制台。
5. 在 Neon 左侧选择 `SQL Editor`，将 [waline.pgsql](https://github.com/walinejs/waline/blob/main/assets/waline.pgsql) 中的建表 SQL 粘贴进编辑器，点击 `Run` 执行。等待提示创建成功。

### 3. 重新部署使数据库生效

1. 回到 Vercel 控制台，点击顶部 `Deployments`，在最新一次部署右侧点击 `Redeploy`。
2. 等待 `STATUS` 变为 `Ready`，点击 `Visit` 打开部署地址——此地址即为 Waline 服务端地址（形如 `https://your-waline-backend.vercel.app`）。

### 4. 注册管理员

1. 访问 `<服务端地址>/ui/register`，使用管理员邮箱注册。**首个注册的用户自动成为管理员**。
2. 登录后即可在 `/ui` 管理面板中审核、编辑、标记或删除评论。

### 5. 将真实地址填入博客配置

1. 将 `_config.butterfly.yml` 中 `waline.serverURL` 的占位符 `https://your-waline-backend.vercel.app` 替换为上一步获得的真实 Vercel 地址。
2. 提交并推送到 GitHub（`git push`），Netlify 会自动触发重建，评论区即可上线。

> 参考文档：[Waline Vercel 部署](https://waline.js.org/guide/deploy/vercel.html) | [Waline 多数据库支持](https://waline.js.org/guide/database.html)

## GitHub 登录认证设置（写作后台）

Decap CMS 写作后台已切换为 GitHub OAuth 认证，使用免费的第三方 OAuth Provider 替代需要付费的 Netlify Identity。

### 前置准备（已完成）

1. **GitHub OAuth App** 已创建，Callback URL 设置为 `https://netlify-cms-github-oauth-provider-qt36928cs-nisconders-projects.vercel.app/callback`。
2. **OAuth Provider** 已部署到 Vercel：`https://netlify-cms-github-oauth-provider-qt36928cs-nisconders-projects.vercel.app`，环境变量包含 `OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`、`ORIGINS`、`REDIRECT_URL`。
3. Vercel 项目部署保护已设为 Public（确保 `/auth` 端点可公开访问）。

### 使用方式

1. 浏览器访问 `https://nisconder-blog.netlify.app/admin/`。
2. 点击 **"Login with GitHub"** 按钮，授权 GitHub OAuth。
3. 授权完成后即可在线新建和编辑文章，所有操作直接提交到 GitHub 仓库。

> 只有对 `nisconder/nisconder.github.io` 仓库有写入权限的 GitHub 账户才能保存内容，即仅管理员可操作。

### 注意

此方式完全替代了 Netlify Identity 邀请制方案。Netlify Identity 需要付费套餐才可使用，而 GitHub OAuth 方案免费且无需在 Netlify 后台进行额外配置。

## Decap CMS 写作说明

本博客集成了 [Decap CMS](https://decapcms.org/) 写作后台，管理员可通过浏览器在线新建和编辑文章，无需本地环境。

### 访问写作后台

1. 浏览器打开 `https://nisconder-blog.netlify.app/admin/`。
2. 使用被 Netlify Identity 邀请的管理员邮箱和密码登录。

### 新建 / 编辑文章

1. 登录后左侧菜单选择 `Posts`，点击 `New Post` 新建文章，或点击已有文章进行编辑。
2. 填写标题、日期、分类、标签和正文。**文章 slug 使用纯 `{{slug}}`（不带日期前缀）**，Decap CMS 会根据标题自动生成 slug，编辑现有文章时不会因日期变化而重命名文件。
3. 日期格式固定为 `YYYY-MM-DD HH:mm:ss`，避免时区偏移导致文章排序错乱。
4. 点击右上角 `Publish` → 选择 `Publish now`，Decap CMS 会自动提交一个 commit 到 GitHub `main` 分支。
5. GitHub 收到 commit 后自动触发 Netlify 重建，几分钟后文章即上线。

### 注意事项

- **不要手动改动文章 slug 的前缀约定**：Decap CMS 配置中 slug 为纯 `{{slug}}`（无日期前缀），文件名由 slug 决定。如果手动在文件名前加日期前缀，下次用 Decap CMS 编辑时文件会被重命名。
- 图片上传功能（`media_folder`）已配置占位字段 `source/images/uploads`，如需启用图片上传请在 Decap CMS 配置中补充实际路径。
- 所有写作操作通过 Git Gateway 直接提交到 GitHub，可在 GitHub 仓库的 commit 历史中查看。
