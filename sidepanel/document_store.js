// Document store & retrieval client for the local service
// Query:    POST {baseURL}/retrieval/query
// Upsert:   POST {baseURL}/documents

import { getDocumentStoreApiKey } from './key_manager.js';

export const PM_SEARCH_BASE_URL = 'http://localhost:8081';

/**
 * @typedef {Object} RetrievalHit
 * @property {string} doc_id
 * @property {string} chunk_id
 * @property {number} score
 * @property {Object.<string, number>} [raw_scores]
 * @property {string} text
 * @property {{ start: number, end: number }} [offset]
 * @property {Record<string, any>} [metadata]
 */

/**
 * @typedef {Object} RetrievalResponse
 * @property {number} took_ms
 * @property {RetrievalHit[]} hits
 * @property {Object[]} history_content
 * @property {Object[]} history_summary
 * @property {Object[]} history_overview
 * @property {boolean} exhaustive
 * @property {string} [embedding_model]
 * @property {string} [index_version]
 */

export async function retrieveContext({
    messages,   // full chat history except system message with last message = current user query
    collection = 'docs',
    top_k = 7,
    baseURL = PM_SEARCH_BASE_URL,
    timeoutMs = 10000,
    signal
}) {
    if (!messages || !Array.isArray(messages)) throw new Error('retrieveContext: messages are required');
    const url = `${baseURL.replace(/\/$/, '')}/retrieval/query-advanced`;

    const controller = !signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const apiKey = await getDocumentStoreApiKey();
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ collection, messages, top_k }),
            signal: signal || controller?.signal
        });
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
        if (!res.ok) {
            const msg = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
            throw new Error(`Retrieval failed: ${msg}`);
        }
        return /** @type {RetrievalResponse} */(data);
    } catch (e) {
        const msg = String(e?.message || e);
        if (/aborted|abort/i.test(msg)) throw new Error('Retrieval request timed out');
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
            throw new Error('Cannot reach retrieval service at ' + url);
        }
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function hitsToMarkdown(hits = []) {
    if (!hits.length) return '*No supporting documents found.*';
    const lines = ['> Retrieved pages:', ''];
    for (const h of hits) {
        const title = h?.metadata?.title || h.doc_id || 'Document';
        const url = h?.metadata?.url || h?.metadata?.link || null;
        const ns = h?.metadata?.namespace ? ` (${h.metadata.namespace})` : '';
        const heading = url ? `[${title}](${url})` : title;
        lines.push(`- ${heading}${ns}`);
        const snippet = (h.text || '').trim();
        if (snippet && snippet !== title) {
            lines.push(`  ${snippet}`);
        }
    }
    //console.log('hitsToMarkdown:', lines.join('\n'));
    return lines.join('\n');
}

export async function saveAndEmbedDoc({
    collection,
    id,
    text,
    chunkPrefix,
    metadata,
    docUrl,
    baseURL = PM_SEARCH_BASE_URL,
    timeoutMs = 30000,
    signal
}) {
    if (!collection) throw new Error('saveAndEmbedDoc: collection is required');
    if (!id) throw new Error('saveAndEmbedDoc: id is required');
    if (!text) throw new Error('saveAndEmbedDoc: text is required');
    if (!metadata) throw new Error('saveAndEmbedDoc: metadata is required');

    const url = `${baseURL.replace(/\/$/, '')}/documents`;
    const controller = !signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const apiKey = await getDocumentStoreApiKey();
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ collection, id, text, docUrl, metadata }),
            signal: signal || controller?.signal
        });
        const textResp = await res.text();
        let data;
        try { data = textResp ? JSON.parse(textResp) : {}; } catch (_) { data = { raw: textResp }; }
        const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const durationMs = Math.round(t1 - t0);

        // Example response:
        // "status": "ok",
        // "id": "doc-kafka",
        // "chunks": 1

        if (!res.ok || !data || data.status !== 'ok') {
            const msg = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
            throw new Error(`saveAndEmbedDoc failed: ${msg}`);
        }

        console.log('[document_store] Document updated', {
            id,
            status: res.status,
            collection,
            endpoint: url,
            title: metadata?.title,
            chunks: data?.chunks,
            length: typeof text === 'string' ? text.length : 0,
            text: text?.slice(0, 150).replace(/\s+/g, ' '),
            note: metadata?.note,
            duration_ms: durationMs,
            chunk_prefix: chunkPrefix,
        });

        return { status: res.status, data };
    } catch (e) {
        const msg = String(e?.message || e);
        if (/aborted|abort/i.test(msg)) throw new Error('saveAndEmbedDoc request timed out');
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
            throw new Error('Cannot reach document store at ' + url);
        }
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function saveFullDocument({
    collection,
    id,
    text,
    baseURL = PM_SEARCH_BASE_URL,
    timeoutMs = 30000,
    signal
}) {
    if (!collection) throw new Error('saveFullDocument: collection is required');
    if (!id) throw new Error('saveFullDocument: id is required');
    if (!text) throw new Error('saveFullDocument: text is required');

    const url = `${baseURL.replace(/\/$/, '')}/documents`;
    const controller = !signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const apiKey = await getDocumentStoreApiKey();
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ collection, id, text, embed: false }),
            signal: signal || controller?.signal
        });
        const textResp = await res.text();
        let data;
        try { data = textResp ? JSON.parse(textResp) : {}; } catch (_) { data = { raw: textResp }; }
        const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const durationMs = Math.round(t1 - t0);

        if (!res.ok || !data) {
            const msg = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
            throw new Error(`saveFullDocument failed: ${msg}`);
        }

        console.log('[document_store] Full document updated', {
            id,
            status: res.status,
            collection,
            endpoint: url,
            length: typeof text === 'string' ? text.length : 0,
            preview: text.slice(0, 150).replace(/\s+/g, ' '),
            duration_ms: durationMs
        });

        return { status: res.status, data };
    } catch (e) {
        const msg = String(e?.message || e);
        if (/aborted|abort/i.test(msg)) throw new Error('saveFullDocument request timed out');
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
            throw new Error('Cannot reach document store at ' + url);
        }
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function loadFullDocument({
    collection,
    id,
    baseURL = PM_SEARCH_BASE_URL,
    timeoutMs = 15000,
    signal
}) {
    if (!collection) throw new Error('loadFullDocument: collection is required');
    if (!id) throw new Error('loadFullDocument: id is required');

    const base = baseURL.replace(/\/$/, '');
    const url = `${base}/documents/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
    const controller = !signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const apiKey = await getDocumentStoreApiKey();
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            signal: signal || controller?.signal
        });
        const bodyText = await res.text();
        let data;
        try { data = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { data = { raw: bodyText }; }
        const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const durationMs = Math.round(t1 - t0);

        if (!res.ok) {
            const msg = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
            throw new Error(`loadFullDocument failed: ${msg}`);
        }

        const docs = data?.docs || [];
        const doc = docs.length ? docs[0] : null;

        console.log('[document_store] Full document loaded', {
            id,
            status: res.status,
            collection,
            endpoint: url,
            has_text: typeof doc === 'string',
            text_length: typeof doc === 'string' ? doc.length : 0,
            duration_ms: durationMs
        });

        return { status: res.status, doc };
    } catch (e) {
        const msg = String(e?.message || e);
        if (/aborted|abort/i.test(msg)) throw new Error('loadFullDocument request timed out');
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
            throw new Error('Cannot reach document store at ' + url);
        }
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Retrieve a list of documents for a collection.
 *
 * @param {Object} params
 * @param {string} params.collection - collection name (required)
 * @param {number} [params.limit]    - optional limit (1‑100)
 * @param {string} [params.baseURL] - base URL of the service
 * @param {number} [params.timeoutMs] - request timeout (ms)
 * @param {AbortSignal} [params.signal] - optional abort signal
 * @returns {Promise<Object[]>} array of document descriptors
 */
export async function listDocuments({
    collection,
    limit,
    baseURL = PM_SEARCH_BASE_URL,
    timeoutMs = 10000,
    signal
}) {
    if (!collection) throw new Error('listDocuments: collection is required');

    const base = baseURL.replace(/\/$/, '');
    let url = `${base}/documents/${encodeURIComponent(collection)}`;
    if (limit !== undefined) url += `?limit=${encodeURIComponent(limit)}`;

    const controller = !signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const apiKey = await getDocumentStoreApiKey();
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            signal: signal || controller?.signal
        });
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }

        if (!res.ok) {
            const msg = data?.error?.message || data?.message || `${res.status} ${res.statusText}`;
            throw new Error(`listDocuments failed: ${msg}`);
        }

        // API returns { documents: [...] }
        return data?.documents ?? [];
    } catch (e) {
        const msg = String(e?.message || e);
        if (/aborted|abort/i.test(msg)) throw new Error('listDocuments request timed out');
        if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
            throw new Error('Cannot reach document store at ' + url);
        }
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
    }
}
