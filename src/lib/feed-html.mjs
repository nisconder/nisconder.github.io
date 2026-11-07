const namedEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const rawTextTags = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'])

// Decode once before URL resolution: decoding a newly produced entity again would
// change the destination of URLs that intentionally contain literal entity text.
const decodeAttribute = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name) => {
  if (!name.startsWith('#')) return namedEntities[name.toLowerCase()]
  const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
    ? String.fromCodePoint(point)
    : '\ufffd'
})

const escapeAttribute = value => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

export function absolutizeFeedHtml(html, postUrl) {
  let rawTextTag
  // Scan complete tags, keeping quoted '>' characters inside their attributes.
  // Text, escaped code examples, comments and raw-text elements are left intact.
  return html.replace(/<!--[\s\S]*?(?:-->|$)|<![^>]*>|<(\/?)([a-z][\w:-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (tag, closing, name) => {
    if (!name) return tag
    const tagName = name.toLowerCase()
    if (rawTextTag) {
      if (closing && tagName === rawTextTag && rawTextTag !== 'plaintext') rawTextTag = undefined
      return tag
    }
    if (closing) return tag
    if (rawTextTags.has(tagName)) rawTextTag = tagName

    // Consume all complete attribute values so text such as data-example='href="/"'
    // cannot be mistaken for a second attribute. Match exact names, not data-src.
    return tag.replace(/([\t\n\f\r ]+)([^\t\n\f\r "'<>/=]+)([\t\n\f\r ]*=[\t\n\f\r ]*)(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'=<>`]+))/g, (attribute, space, key, equals, double, single, unquoted) => {
      if (!/^(href|src)$/i.test(key)) return attribute
      const value = decodeAttribute(double ?? single ?? unquoted).trim()
      if (!value || /^[a-z][a-z\d+.-]*:/i.test(value)) return attribute
      try {
        const quote = single === undefined ? '"' : "'"
        return `${space}${key}${equals}${quote}${escapeAttribute(new URL(value, postUrl).href)}${quote}`
      } catch {
        return attribute
      }
    })
  })
}
