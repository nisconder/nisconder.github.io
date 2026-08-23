'use strict'

hexo.extend.generator.register('admin-tag-options', locals => {
  const tags = locals.tags
    .map(tag => tag.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))

  return {
    path: 'admin/tag-options.json',
    data: JSON.stringify(tags)
  }
})
