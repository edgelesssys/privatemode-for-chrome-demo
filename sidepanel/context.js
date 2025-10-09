// Page context management and domain tracking (no UI side-effects)
import { parseBaseDomainFromUrl as parseBase, getBaseDomain as getBase } from './domain.js';
import { saveAndEmbedDoc } from './document_store.js';
import { pdfBytesToText } from './pm_client.js';

const CONTEXT_TTL_MS = 60 * 1000; // 1 minute

let pageContext = { url: null, content: null, lastFetchedAt: 0 };
let currentPageTitle = null; // cache current page title without repeated parsing
let currentBaseDomain = null;
let currentPageSize = null;
let lastStoredUrls = []; // track multiple stored URLs to avoid unnecessary updates

// Track per-URL starred state in-memory (ephemeral)
// TODO: store in chat instead and save with chat
const starredUrls = new Set();

const baseDomainChangeListeners = new Set(); // subscribers to base-domain changes
const urlChangeListeners = new Set(); // subscribers to URL changes

function isRestrictedUrl(url) {
    if (!url) return false;
    return (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('chrome-search://') ||
        url.startsWith('chrome-untrusted://') ||
        url.startsWith('devtools://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.startsWith('view-source:')
    );
}

// --- Helpers ---
function b64url(s) {
    try {
        const bytes = new TextEncoder().encode(String(s));
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    } catch (_) {
        return encodeURIComponent(String(s));
    }
}

function buildMinimalContext({ title, url, restricted = false, note }) {
    return {
        title: title || (restricted ? 'Restricted page' : 'Page'),
        url,
        restricted: restricted || undefined,
        note: note || (restricted ? 'Restricted page' : undefined)
    };
}

async function setPageContext(url, contentObject, sizeBytes) {
    pageContext = {
        url,
        content: JSON.stringify(contentObject || {}),
        lastFetchedAt: Date.now(),
        contentLength: sizeBytes || null
    };
    try {
        currentPageTitle = (contentObject && typeof contentObject.title === 'string' && contentObject.title.trim())
            ? contentObject.title.trim()
            : null;
    } catch (_) { currentPageTitle = null; }
    return pageContext;
}

function buildPageText(contentObj = {}) {
    const blocks = [];
    if (contentObj.title) blocks.push(`# ${contentObj.title}`);
    if (contentObj.metaDescription) blocks.push(contentObj.metaDescription);
    if (Array.isArray(contentObj.headings) && contentObj.headings.length) {
        blocks.push(contentObj.headings.map((h) => `- ${h}`).join('\n'));
    }
    if (contentObj.text) blocks.push(contentObj.text);
    return blocks.filter(Boolean).join('\n\n');
}

function makePageMetadata(contentObj = {}, url) {
    const meta = {
        title: contentObj.title || undefined,
        url,
        base_domain: currentBaseDomain || undefined,
        namespace: 'pages',
        source: 'pm4chrome'
    };
    Object.keys(meta).forEach((k) => (meta[k] == null) && delete meta[k]);
    return meta;
}

// PDF processing: send bytes to backend unstructured parser and return extracted text.
// Falls back to a small diagnostic string if extraction fails.
async function processPdfBytes(pdfBytes) {
    try {
        if (!pdfBytes || typeof pdfBytes.byteLength !== 'number') return 'PDF (unavailable)';
        const text = await pdfBytesToText(pdfBytes).catch(() => '');
        if (text && text.trim()) return text.trim();

        // Fallback minimal diagnostic (previous placeholder style)
        const view = new Uint8Array(pdfBytes.slice(0, 16));
        const ascii = Array.from(view).map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
        return `PDF (${pdfBytes.byteLength} bytes) - text extraction failed. First16='${ascii}'`;
    } catch (e) {
        console.warn('processPdfBytes: failed', e?.message || e);
        return 'PDF (unavailable)';
    }
}

// Safe wrapper for chrome.scripting.executeScript to handle stale/closed tab errors
async function safeExecuteScript(tabId, details) {
    try {
        return await chrome.scripting.executeScript({
            target: { tabId },
            ...details
        });
    } catch (e) {
        console.warn('[context] executeScript failed', { tabId, error: e?.message });
        if (e && /no tab with id/i.test(e.message || '')) {
            // Tab likely changed/closed. Return null sentinel.
            return [{ result: null, __error: 'no-tab' }];
        }
        return [{ result: null, __error: e?.message || 'exec-failed' }];
    }
}

// Try to fetch active tab content (works in extension; in web test env chrome.* may not exist)
async function fetchTabContent(tab) {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) return null;
    try {
        if (!tab?.id || !tab.url) return null;
        const url = tab.url;
        // Avoid injecting on restricted pages; store minimal context instead
        if (isRestrictedUrl(url)) return null;

        const tabId = tab.id; // capture early for logging
        const [{ result: domResult, __error: domError } = {}] = await safeExecuteScript(tabId, {
            func: () => {
                try {
                    const get = (sel) => document.querySelector(sel);
                    const metaDesc = get('meta[name="description"]')?.content || null;
                    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
                        .slice(0, 50)
                        .map((h) => (h.textContent || '').trim())
                        .filter(Boolean);
                    const text = (document.body?.innerText || '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    return {
                        title: document.title,
                        url: location.href,
                        metaDescription: metaDesc,
                        headings,
                        contentLength: document.documentElement.outerHTML.length,
                        text
                    };
                } catch (err) {
                    return { error: err?.message || 'dom-capture-failed' };
                }
            },
            args: []
        });
        if (domError === 'no-tab') {
            // Tab vanished; attempt to re-query active tab to confirm
            try {
                const [activeAgain] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!activeAgain || activeAgain.id !== tabId) {
                    const minimal = buildMinimalContext({
                        title: (tab.title && tab.title.trim()) || 'Page',
                        url,
                        note: 'Tab changed or closed before content capture.'
                    });
                    return await setPageContext(url, minimal);
                }
            } catch (_) { /* ignore */ }
        }
        const result = domResult;
        // Determine if the DOM result is meaningfully populated
        const domHasMeaningfulText = !!(result && (
            (result.title && result.title.trim()) ||
            (Array.isArray(result.headings) && result.headings.length) ||
            (result.text && result.text.trim())
        ));

        if (!domHasMeaningfulText) {
            // Fallback: try fetching the URL directly and inspect content-type for PDF
            try {
                const [{ result: probe } = {}] = await safeExecuteScript(tabId, {
                    func: async (url) => {
                        try {
                            const resp = await fetch(url, { credentials: 'include' });
                            const ct = resp.headers.get('content-type') || null;
                            if (ct && ct.includes('application/pdf')) {
                                const buf = await resp.arrayBuffer();
                                return { contentType: ct, pdf: true, byteLength: buf.byteLength, pdfBytes: buf };
                            }
                            return { contentType: ct, pdf: false };
                        } catch (e) {
                            return { error: e?.message || 'fetch-failed' };
                        }
                    },
                    args: [url]
                });
                if (probe && probe.pdf) {
                    const extracted = await processPdfBytes(probe.pdfBytes || null);
                    return await setPageContext(url, {
                        title: tab.title || 'PDF Document',
                        url,
                        pdf: true,
                        pdfByteLength: probe.byteLength,
                        text: extracted
                    }, probe.byteLength);
                }
                // Not a PDF or failed; store minimal context so callers know we tried
                const derivedTitle = (tab.title && tab.title.trim()) || (() => {
                    try { const uObj = new URL(url); return uObj.pathname.split('/').filter(Boolean).pop() || 'Page'; } catch (_) { return 'Page'; }
                })();
                const minimal = buildMinimalContext({
                    title: derivedTitle,
                    url,
                    note: 'No textual content extracted.'
                });
                return await setPageContext(url, minimal);
            } catch (e) {
                console.warn('[context] PDF probe or extraction fallback failed', { url, error: e?.message || e });
                // As last resort store minimal context
                const minimal = buildMinimalContext({ title: tab.title, url, note: 'No textual content extracted.' });
                return await setPageContext(url, minimal);
            }
        }
        return await setPageContext(url, result, result.contentLength || null);
    } catch (e) {
        // Fall back to minimal context if we have the URL (e.g., unexpected restriction)
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const url = tab?.url || null;
            if (url) {
                const minimal = buildMinimalContext({
                    title: tab.title,
                    url,
                    restricted: isRestrictedUrl(url) || false,
                    note: 'Page content not available.'
                });
                return await setPageContext(url, minimal);
            }
        } catch (_) { }
        console.warn('Failed to fetch active tab content:', e);
        return null;
    }
}

function needsContextRefresh(currentUrl) {
    if (!pageContext.url || pageContext.url !== currentUrl) return true;
    if (Date.now() - pageContext.lastFetchedAt > CONTEXT_TTL_MS) return true;
    return false;
}

// --- Domain helpers (moved to domain.js) ---
const parseBaseDomainFromUrl = (urlStr) => parseBase(urlStr);
const getBaseDomain = (hostname) => getBase(hostname);

async function ensurePageContext() {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        // not running as Chrome extension (e.g. web test), just store the url
        const url = window.location?.href || null;
        if (url) {
            pageContext.url = url;
            pageContext.lastFetchedAt = Date.now();
        }
        currentBaseDomain = "chat-as-page";
        return pageContext;
    }
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || null;
        if (!url) return null;

        // This will already update pageContext if needed
        if (!needsContextRefresh(url)) {
            return null;
        }

        const oldUrl = pageContext.url;

        // update now such that even if fetchActiveTabContent fails we have the URL recorded
        // and also avoid repeating the fetch if called multiple times in parallel
        const minimal = buildMinimalContext({ title: tab.title, url, restricted: isRestrictedUrl(url) });
        await setPageContext(url, minimal);

        // Now the actual update
        await fetchTabContent(tab);

        // Notify about base domain changes, e.g., to reset chat state
        const newBase = parseBaseDomainFromUrl(url);
        if (newBase && newBase !== currentBaseDomain) {
            const old = currentBaseDomain;
            currentBaseDomain = newBase;
            // Notify listeners
            for (const cb of Array.from(baseDomainChangeListeners)) {
                try { cb(newBase, old); } catch (_) { }
            }
        }

        // Notify about URL changes
        if (oldUrl !== pageContext.url) {
            for (const cb of Array.from(urlChangeListeners)) {
                try { cb(url, oldUrl); } catch (_) { }
            }
        }
        return pageContext;
    } catch (e) {
        console.warn('ensurePageContext error:', e);
        return null;
    }
}

// Internal: post current page to document store once per URL
async function maybeStoreCurrentPage() {
    if (["newtab", "extensions"].includes(currentBaseDomain)) return;
    const url = pageContext?.url || null;
    const contentStr = pageContext?.content || null;
    if (!url || !contentStr) return;
    if (lastStoredUrls.includes(url)) return;
    let contentObj;
    try { contentObj = JSON.parse(contentStr); } catch (_) { contentObj = null; }
    if (!contentObj) return;

    // Update cached title here since we've already parsed content
    try {
        if (typeof contentObj.title === 'string' && contentObj.title.trim()) {
            currentPageTitle = contentObj.title.trim();
        }
    } catch (_) { /* ignore */ }
    const id = `page:${b64url(url)}`;
    const textBody = buildPageText(contentObj);
    const metadata = makePageMetadata(contentObj, url);
    const titleShort = metadata.title.slice(0, 25);
    const domainShort = currentBaseDomain.slice(0, 30);
    const chunkPrefix = `${titleShort}; ${domainShort}`;

    const { status } = await saveAndEmbedDoc({
        collection: 'docs',
        id,
        text: textBody || contentStr,
        chunkPrefix,
        metadata
    });
    if (status >= 200 && status < 300) {
        lastStoredUrls.push(url);

        // limit to last 20 stored URLs to avoid unbounded growth
        if (lastStoredUrls.length > 20) {
            lastStoredUrls = lastStoredUrls.slice(-20);
        }
    }
}

onUrlChange(() => {
    // Fire-and-forget: don't await to avoid delaying the listener
    // Errors are handled on the promise to avoid unhandled rejections
    maybeStoreCurrentPage().catch((e) => {
        console.error('Failed to store current page:', e);
    });
});

function onBaseDomainChange(cb) {
    if (typeof cb === 'function') {
        baseDomainChangeListeners.add(cb);
        return () => baseDomainChangeListeners.delete(cb);
    }
    return () => { };
}

function onUrlChange(cb) {
    if (typeof cb === 'function') {
        urlChangeListeners.add(cb);
        return () => urlChangeListeners.delete(cb);
    }
    return () => { };
}

function initContextMonitoring() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return; // skip in web test
    // Initial fetch
    (async () => { await ensurePageContext(); })();

    // Poll every 3s to detect URL changes if events aren't sufficient.
    // This should be long enough to recognize it but short enough to still be ok.
    setInterval(() => ensurePageContext(), 3 * 1000);

    // Listen for tab updates (URL change)
    try {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (tab.active && changeInfo.status === 'complete') {
                ensurePageContext();
            }
            if (tab.active && changeInfo.url) {
                ensurePageContext();
            }
        });
        chrome.tabs.onActivated.addListener(() => ensurePageContext());
    } catch (e) {
        console.warn('Context monitoring setup failed:', e);
    }
}

function getCurrentBaseDomain() { return currentBaseDomain; }
function getPageContext() { return pageContext; }

// Convenience: get the current page title from parsed context (or document.title in web test)
function getCurrentPageTitle() {
    if (currentPageTitle && typeof currentPageTitle === 'string') return currentPageTitle;

    // Derive from URL filename (no query/hash, no extension) if available
    try {
        const urlStr = pageContext?.url || (typeof window !== 'undefined' ? window.location?.href : null) || null;
        if (urlStr) {
            const u = new URL(urlStr);
            let segment = (u.pathname || '').split('/').filter(Boolean).pop() || '';
            if (segment) {
                const idx = segment.lastIndexOf('.');
                if (idx > 0) segment = segment.slice(0, idx);
                try { segment = decodeURIComponent(segment); } catch (_) { /* ignore decode errors */ }
                if (segment) return segment;
            }
        }
    } catch (_) { /* ignore */ }

    // Final fallback: document.title in web test
    try {
        if (typeof document !== 'undefined' && document?.title) return document.title;
    } catch (_) { /* ignore */ }
    return null;
}

// Star state helpers for the current page (per-URL)
function getCurrentPageStarred() {
    const url = pageContext?.url || null;
    if (!url) return false;
    return starredUrls.has(url);
}

function setCurrentPageStarred(flag) {
    const url = pageContext?.url || null;
    if (!url) return false;
    if (flag) {
        starredUrls.add(url);
    } else {
        starredUrls.delete(url);
    }
    return flag ? true : false;
}

// Export named functions for IDE completion
export {
    ensurePageContext,
    initContextMonitoring,
    onBaseDomainChange,
    onUrlChange,
    getCurrentBaseDomain,
    getPageContext,
    getCurrentPageTitle,
    getCurrentPageStarred,
    setCurrentPageStarred,
    maybeStoreCurrentPage as storeCurrentPage,
    isRestrictedUrl,
    parseBaseDomainFromUrl,
    getBaseDomain,
};
