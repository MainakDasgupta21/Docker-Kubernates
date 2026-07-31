export function enhanceCallouts(root = document) {
  root.querySelectorAll('.vp-doc blockquote').forEach((bq) => {
    const text = bq.textContent || ''
    if (/Production floor/i.test(text)) {
      bq.classList.add('z2p-callout', 'z2p-callout--floor')
    } else if (/Common Pitfall/i.test(text)) {
      bq.classList.add('z2p-callout', 'z2p-callout--pitfall')
    } else if (/Deep Dive/i.test(text)) {
      bq.classList.add('z2p-callout', 'z2p-callout--dive')
    } else if (/Warning|Tip|Note/i.test(text)) {
      bq.classList.add('z2p-callout')
    }
  })
}
