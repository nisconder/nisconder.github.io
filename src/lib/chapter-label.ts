export function chapterLabel(title: string) {
  const match = title.match(/(?:^|\s)(\d{2,3}[a-z]?)\s*[：:]\s*(.+)$/i) ?? title.match(/(附录)\s*[：:]\s*(.+)$/)
  return match ? { number: match[1], title: match[2] } : { number: '', title }
}
