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
