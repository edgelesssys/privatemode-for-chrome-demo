import MarkdownIt from 'markdown-it';
import createDOMPurify from 'dompurify';

// Markdown renderer + sanitizer (shared)
const md = new MarkdownIt({ html: true, linkify: true, breaks: true });

// Ensure markdown links open in new tab and are safe
const defaultLinkOpen = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const tIdx = tokens[idx].attrIndex('target');
    if (tIdx < 0) tokens[idx].attrPush(['target', '_blank']);
    else tokens[idx].attrs[tIdx][1] = '_blank';

    const rIdx = tokens[idx].attrIndex('rel');
    if (rIdx < 0) tokens[idx].attrPush(['rel', 'noopener noreferrer']);
    else tokens[idx].attrs[rIdx][1] = 'noopener noreferrer';

    return defaultLinkOpen(tokens, idx, options, env, self);
};

const DOMPurify = createDOMPurify(window);

export function renderMarkdown(text) {
    return DOMPurify.sanitize(md.render(text || ''));
}

export { md, DOMPurify };
