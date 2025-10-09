// Rendering & chat helpers
import { renderMarkdown } from './markdown.js';
import { getCurrentChat, streamRequest, chats, Chat } from './chat.js';
import { saveAndEmbedDoc } from './document_store.js';
import {
    ensurePageContext,
    initContextMonitoring,
    onBaseDomainChange,
    onUrlChange,
    getCurrentBaseDomain,
    getPageContext,
    parseBaseDomainFromUrl,
    getCurrentPageTitle,
    getCurrentPageStarred,
    setCurrentPageStarred
} from './context.js';

let generationConfig = { temperature: 0.1 };

const inputPrompt = document.body.querySelector('#input-prompt');
const buttonSend = document.body.querySelector('#button-send');
const elementResponse = document.body.querySelector('#response');
const elementLoading = document.body.querySelector('#loading');
const elementError = document.body.querySelector('#error');
const elementDomain = document.body.querySelector('#domain-banner');
const elementDomainText = document.body.querySelector('#domain-text');
const buttonPageStar = document.body.querySelector('#page-star-btn');
const buttonNewTopic = document.body.querySelector('#new-topic-btn');

// Track if auto-scroll is enabled (disabled when user scrolls up)
let autoScrollEnabled = true;

// Chat logic moved to chat.js

inputPrompt.addEventListener('input', () => {
    if (inputPrompt.value.trim()) {
        buttonSend.removeAttribute('disabled');
    } else {
        buttonSend.setAttribute('disabled', '');
    }
});

// Send on Enter; Shift+Enter inserts a newline
inputPrompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (inputPrompt.value.trim()) {
            buttonSend.click();
        }
    }
});

buttonSend.addEventListener('click', async () => {
    const prompt = inputPrompt.value.trim();
    if (!prompt) return;
    // Keep context up to date before sending
    await ensurePageContext?.();
    // Enable auto-scroll for new response
    autoScrollEnabled = true;
    // Snapshot origin (page) at the time of starting the request
    let originUrl = null;
    let originTitle = null;
    try {
        const ctx = getPageContext?.();
        originUrl = ctx?.url || null;
        originTitle = getCurrentPageTitle?.() || null;
    } catch (_) { /* ignore */ }
    // Append user message, render immediately
    const chat = await getCurrentChat();
    chat.messages.push({ role: 'user', content: prompt });
    chat.save();
    await renderChat();
    // Clear input and disable until next input
    inputPrompt.value = '';
    buttonSend.setAttribute('disabled', '');
    showLoading();
    try {
        // Prepare placeholder assistant and stream into it
        const assistantMsg = { role: 'assistant', content: '', streaming: true, origin: (originUrl ? { url: originUrl, title: originTitle || undefined } : undefined) };
        chat.messages.push(assistantMsg);
        await renderChat();
        const bubble = (() => {
            const nodes = document.querySelectorAll('.message.assistant .bubble');
            return nodes[nodes.length - 1] || null;
        })();
        const updateBubble = () => {
            if (bubble) {
                // Sanitize + render markdown while streaming
                bubble.innerHTML = renderMarkdown(assistantMsg.content || '');
                // Enhance code blocks with language badges
                decorateCodeLanguages(bubble);
                const root = document.querySelector('.chat-root');
                if (root && autoScrollEnabled) root.scrollTop = root.scrollHeight;
            }
        };

        let firstTokenShown = false;
        const assistantText = await streamRequest(chat, generationConfig, (delta) => {
            assistantMsg.content += delta;

            if (!firstTokenShown && assistantMsg.content.trim().length > 0) {
                firstTokenShown = true;
                hide(elementLoading);
            }
            updateBubble();
        });
        // Ensure final text is set (in case no deltas)
        if (assistantMsg.content !== assistantText) {
            assistantMsg.content = assistantText;
            updateBubble();
        }
        // Mark streaming complete and ensure actions row (copy) is visible now
        assistantMsg.streaming = false;
        const wrapperEl = bubble ? bubble.closest('.message.assistant') : null;
        if (wrapperEl && !wrapperEl.querySelector('.actions')) {
            const actionsEl = createAssistantActions(assistantMsg);
            wrapperEl.appendChild(actionsEl);
        }
        hide(elementLoading);
        chat.save();
    } catch (e) {
        showError(e);
        hide(elementLoading);
    }
});

function showLoading() {
    hide(elementError);
    show(elementResponse);
    show(elementLoading);
}

function showError(error) {
    show(elementError);
    show(elementResponse);
    elementError.textContent = toUserMessage(error);
}

function show(element) {
    element.removeAttribute('hidden');
}

function hide(element) {
    element.setAttribute('hidden', '');
}

function toUserMessage(error) {
    if (typeof error === 'string') return error;
    const msg = error?.message || String(error);
    if (/Failed to fetch|NetworkError/i.test(msg)) {
        return "Can't connect to the local AI server at http://localhost:8080. Please make sure it's running and reachable.";
    }
    return msg;
}

async function renderChat() {
    const container = elementResponse;
    container.removeAttribute('hidden');
    container.innerHTML = '';
    updateDomainBanner();
    const chat = await getCurrentChat();
    const messages = chat.messages;
    for (let i = 0; i < messages.length; i++) {
        container.appendChild(renderMessage(messages[i], i));
    }
    // Auto-scroll to bottom of chat area
    const root = document.querySelector('.chat-root');
    if (root) {
        root.scrollTop = root.scrollHeight;
    }
}

function renderMessage(message, index) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
    if (typeof index === 'number') {
        wrapper.dataset.index = String(index);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (message.role === 'assistant') {
        // Render Markdown for assistant responses
        bubble.innerHTML = renderMarkdown(message.content || '');
        decorateCodeLanguages(bubble);
        wrapper.appendChild(bubble);
        // Only show actions when message is completed (not streaming)
        if (!message.streaming) {
            const actions = createAssistantActions(message);
            wrapper.appendChild(actions);
        }
    } else {
        bubble.textContent = message.content;
        wrapper.appendChild(bubble);
    }
    return wrapper;
}

// Add data-lang attribute to pre blocks and inject a copy button
function decorateCodeLanguages(rootEl) {
    try {
        const pres = rootEl.querySelectorAll('pre');
        pres.forEach((pre) => {
            // Set data-lang from inner code class
            if (!pre.hasAttribute('data-lang')) {
                const code = pre.querySelector('code');
                let lang = '';
                if (code) {
                    const cls = code.getAttribute('class') || '';
                    const m = cls.match(/language-([a-z0-9_+-]+)/i);
                    if (m) lang = m[1].toLowerCase();
                }
                pre.setAttribute('data-lang', lang || 'text');
            }

            // Add a copy button once per block
            if (!pre.querySelector('.code-copy-btn')) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'code-copy-btn';
                btn.title = 'Copy code';
                btn.setAttribute('aria-label', 'Copy code');
                // Add text label after masked icon
                const label = document.createElement('span');
                label.textContent = 'Copy';
                label.style.marginLeft = '6px';
                btn.appendChild(label);
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const codeEl = pre.querySelector('code');
                        const text = codeEl ? codeEl.innerText : pre.innerText;
                        if (!text) return;
                        await navigator.clipboard.writeText(text);
                        btn.classList.add('copied');
                        setTimeout(() => btn.classList.remove('copied'), 800);
                    } catch (_) { /* ignore */ }
                });
                pre.appendChild(btn);
            }
        });
    } catch (_) {
        // ignore
    }
}

function createAssistantActions(message) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.type = 'button';
    // Provide clearer tooltip text
    copyBtn.title = 'Copy message';
    copyBtn.setAttribute('aria-label', 'Copy message');
    // icon drawn via CSS via ::before
    actions.appendChild(copyBtn);
    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn';
    starBtn.type = 'button';
    // Favorite (star) button with dynamic tooltip based on state
    const initiallyStarred = !!message?.starred;
    starBtn.title = initiallyStarred ? 'Unstar message' : 'Star message';
    starBtn.setAttribute('aria-label', initiallyStarred ? 'Unstar message' : 'Star message');
    if (message?.starred) {
        starBtn.classList.add('starred');
        starBtn.setAttribute('aria-pressed', 'true');
    } else {
        starBtn.setAttribute('aria-pressed', 'false');
    }
    actions.appendChild(starBtn);

    // Add origin link if present on message
    const originUrl = message?.origin?.url || null;
    if (originUrl) {
        const originTitle = (message.origin.title || originUrl).trim();
        const a = document.createElement('a');
        a.className = 'origin-link';
        a.href = originUrl;
        a.textContent = originTitle;
        a.title = originUrl;
        a.rel = 'noopener';
        // no target here; our global click handler will decide same-window/new-tab
        actions.appendChild(a);
    }
    return actions;
}


// Update the domain banner text/visibility
function updateDomainBanner() {
    if (!elementDomain) return;
    const domain = getCurrentBaseDomain?.() || '';
    const title = getCurrentPageTitle?.() || '';
    const sizeBytes = getPageContext?.()?.contentLength || null;
    const size = __DEBUG__ ? ` (${Math.ceil(sizeBytes / 1024)} kb)` : "";
    const combined = title ? `${domain || ''}${domain ? ' | ' : ''}${title}${size}` : domain;
    if (elementDomainText) elementDomainText.textContent = combined;

    if (combined) {
        // Sync star state for current page
        if (buttonPageStar) {
            const starred = !!getCurrentPageStarred?.();
            buttonPageStar.classList.toggle('starred', starred);
            buttonPageStar.setAttribute('aria-pressed', starred ? 'true' : 'false');
            buttonPageStar.title = starred ? 'Unstar page' : 'Star page';
        }
        show(elementDomain);
    } else {
        hide(elementDomain);
    }
}

// Initialize context monitoring and listen for base-domain changes
initContextMonitoring?.();
onBaseDomainChange?.(async () => {
    updateDomainBanner();
    await renderChat();
});
// Also refresh the banner on URL changes (title may change along with URL)
onUrlChange?.(() => {
    updateDomainBanner();
});

// Toggle star on current page
if (buttonPageStar) {
    buttonPageStar.addEventListener('click', async () => {
        try { await ensurePageContext?.(); } catch (_) { /* noop */ }
        const next = !getCurrentPageStarred?.();
        setCurrentPageStarred?.(next);
        // reflect immediately
        buttonPageStar.classList.toggle('starred', next);
        buttonPageStar.setAttribute('aria-pressed', next ? 'true' : 'false');
        buttonPageStar.title = next ? 'Unstar page' : 'Star page';
    });
}
// initial banner update
(async function initOnce() {
    await ensurePageContext?.();
    updateDomainBanner();
    // Focus the textarea after loading
    setTimeout(() => {
        if (inputPrompt && document.body.contains(inputPrompt)) {
            inputPrompt.focus();
        }
    }, 0);

    // Add scroll listener to disable auto-scroll when user scrolls up
    const root = document.querySelector('.chat-root');
    if (root) {
        root.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = root;
            // If scrolled up more than 10px from bottom, disable auto-scroll
            autoScrollEnabled = scrollTop + clientHeight >= scrollHeight - 10;
        });
    }
})();

// URL changes are monitored inside context.js, which stores pages automatically

// Copy button delegation
if (elementResponse) {
    elementResponse.addEventListener('click', async (e) => {
        // Intercept link clicks: same-domain => navigate current tab; cross-domain => new tab
        const linkEl = e.target && (e.target.closest ? e.target.closest('a[href]') : null);
        if (linkEl) {
            let rawHref = linkEl.getAttribute('href') || linkEl.href;
            if (!rawHref) return;

            // Resolve relative URLs against current page context
            let href = rawHref;
            if (!/^https?:\/\//i.test(href)) {
                const baseUrl = getPageContext?.()?.url;
                if (baseUrl) {
                    try { href = new URL(href, baseUrl).toString(); } catch (_) { /* ignore */ }
                }
            }

            if (href && /^https?:\/\//i.test(href)) {
                e.preventDefault();
                const currentBase = getCurrentBaseDomain?.() || null;
                const linkBase = parseBaseDomainFromUrl?.(href) || null;
                const sameDomain = (currentBase && linkBase && currentBase === linkBase) || currentBase === 'newtab';

                try {
                    if (sameDomain) {
                        // Navigate active tab in same window
                        if (typeof chrome !== 'undefined' && chrome?.tabs?.update && chrome?.tabs?.query) {
                            try {
                                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                                if (tab?.id) {
                                    await chrome.tabs.update(tab.id, { url: href });
                                    return; // done
                                }
                            } catch (_) { /* fall through to fallback */ }
                        }
                        // Fallback for web test env
                        try { window.location.assign(href); } catch (_) { window.open(href, '_self'); }
                    } else {
                        // Cross-domain: open in new tab
                        if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
                            chrome.tabs.create({ url: href });
                        } else {
                            window.open(href, '_blank', 'noopener');
                        }
                    }
                } catch (_) {
                    try { window.open(href, sameDomain ? '_self' : '_blank', sameDomain ? undefined : 'noopener'); } catch (_) { }
                }
                return; // Stop so other handlers don't run
            }
        }

        const copyBtn = e.target && (e.target.closest ? e.target.closest('.copy-btn') : null);
        if (copyBtn) {
            const messageEl = copyBtn.closest('.message.assistant');
            const bubbleEl = messageEl ? messageEl.querySelector('.bubble') : null;
            if (!bubbleEl) return;
            const text = bubbleEl.innerText.trim();
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.classList.add('copied');
                setTimeout(() => copyBtn.classList.remove('copied'), 800);
            } catch (_) {
                // ignore errors silently
            }
            return;
        }

        const starBtn = e.target && (e.target.closest ? e.target.closest('.star-btn') : null);
        if (starBtn) {
            const messageEl = starBtn.closest('.message.assistant');
            const bubbleEl = messageEl ? messageEl.querySelector('.bubble') : null;
            const text = bubbleEl ? bubbleEl.innerText.trim() : '';
            const idx = messageEl && messageEl.dataset ? parseInt(messageEl.dataset.index, 10) : NaN;
            const chat = await getCurrentChat();
            const messages = chat.messages;
            const msg = Number.isInteger(idx) ? messages[idx] : null;
            try {
                // If already starred, just unstar locally (no delete API yet)
                if (starBtn.classList.contains('starred')) {
                    starBtn.classList.remove('starred');
                    starBtn.setAttribute('aria-pressed', 'false');
                    starBtn.title = 'Star message';
                    starBtn.setAttribute('aria-label', 'Star message');
                    if (msg) msg.starred = false;
                    return;
                }
                await storeAssistantResponse(text);
                starBtn.classList.add('starred');
                starBtn.setAttribute('aria-pressed', 'true');
                starBtn.title = 'Unstar message';
                starBtn.setAttribute('aria-label', 'Unstar message');
                if (msg) msg.starred = true;
            } catch (_) {
                // ignore for now
            }
            return;
        }
    });
}

// Store the assistant response text in the document store
async function storeAssistantResponse(answerText) {
    const text = (answerText || '').trim();
    if (!text) throw new Error('Empty assistant response');

    // Ensure context so we can annotate metadata
    try { await ensurePageContext?.(); } catch (_) { }
    const ctx = getPageContext?.();
    const url = ctx?.url || undefined;
    const baseDomain = getCurrentBaseDomain?.() || undefined;

    // Create an ID namespaced by base domain and timestamp
    const safe = (s) => String(s || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
    const id = `answer:${safe(baseDomain)}:${Date.now()}`;

    // Title/preview from first line or first 80 chars
    const firstLine = text.split('\n').find((l) => l.trim().length) || text;
    const title = firstLine.trim().slice(0, 80);

    const metadata = {
        title,
        url,
        base_domain: baseDomain,
        namespace: 'answers',
        length: text.length,
        source: 'pm4chrome'
    };
    Object.keys(metadata).forEach((k) => (metadata[k] == null) && delete metadata[k]);

    const { status } = await saveAndEmbedDoc({
        collection: 'docs',
        id,
        text,
        metadata
    });
    if (status < 200 || status >= 300) throw new Error('Star failed');
}

// New Topic: clear current history and re-render
if (buttonNewTopic) {
    buttonNewTopic.addEventListener('click', async () => {
        const key = getCurrentBaseDomain?.() || 'unknown';
        chats[key] = new Chat();
        await renderChat();
        if (inputPrompt) {
            inputPrompt.value = '';
            buttonSend.setAttribute('disabled', '');
            inputPrompt.focus();
        }
    });
}
