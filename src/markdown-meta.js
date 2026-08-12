export function extractHeadings(markdown) {
  return (markdown || '')
    .split(String.fromCharCode(10))
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      return match ? { level: match[1].length, text: match[2], index } : null;
    })
    .filter(Boolean);
}

export function countWords(markdown) {
  const plain = (markdown || '')
    .replace(new RegExp(String.fromCharCode(96) + '{3}[\\s\\S]*?' + String.fromCharCode(96) + '{3}', 'g'), '')
    .replace(new RegExp('[#>*_' + String.fromCharCode(96) + '~\\[\\]()!-]', 'g'), ' ')
    .trim();

  if (!plain) return 0;
  return plain.split(/\s+/).length;
}
