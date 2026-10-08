import type { Locator } from 'playwright';

/** Rendered text from this frame only. Screenshots still decide occlusion and active state. */
export async function readVisibleText(target: Locator, maxCharacters = 6000): Promise<string> {
  return target.evaluate((element, requestedLimit) => {
    const document = element.ownerDocument;
    const window = document.defaultView!;
    const limit = Math.min(6000, Math.max(0, Math.floor(requestedLimit)));
    if (!Number.isFinite(limit) || !limit || !document.body) return '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const styles = new Map<Element, CSSStyleDeclaration>();
    const chunks: string[] = [];
    let length = 0, examined = 0;
    while (walker.nextNode() && length < limit && examined++ < 10000) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) continue;
      let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight;
      let hidden = false;
      for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
        let style = styles.get(ancestor);
        if (!style) { style = window.getComputedStyle(ancestor); styles.set(ancestor, style); }
        // Visibility inherits but can be overridden by a rendered child. Opacity
        // and display on any ancestor suppress the entire subtree.
        if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden' ||
          ancestor === parent && (style.visibility === 'hidden' || style.visibility === 'collapse')) {
          hidden = true; break;
        }
        if (/(?:hidden|clip|scroll|auto)/.test(`${style.overflowX} ${style.overflowY}`)) {
          const box = ancestor.getBoundingClientRect();
          if (style.overflowX !== 'visible') { left = Math.max(left, box.left); right = Math.min(right, box.right); }
          if (style.overflowY !== 'visible') { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
        }
      }
      if (hidden || right <= left || bottom <= top) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rendered = Array.from(range.getClientRects()).some(box => box.width > 0 && box.height > 0 &&
        box.right > left && box.left < right && box.bottom > top && box.top < bottom);
      if (!rendered) continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim().slice(0, limit - length - (chunks.length ? 1 : 0));
      if (text) { chunks.push(text); length += text.length + (chunks.length > 1 ? 1 : 0); }
    }
    return chunks.join('\n');
  }, maxCharacters);
}
