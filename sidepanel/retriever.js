import * as DocStore from './document_store.js';


// New method with RAG on server
export async function retrieveContext(messages, pageContext) {
    try {
        const md = DocStore.retrieveContext({
            messages,
            pageContext,
            collection: 'docs',
            top_k: 8,
            weightsReversed: [1.0, 0.85, 0.7, 0.55],
        });
        return md;
    } catch (e) {
        console.warn('retrieval: failed to build context', e);
        return '';
    }
}

/**
 * Get the browse‑history documents for the default “docs” collection.
 *
 * @param {Object} [options]
 * @param {string} [options.baseURL]   - base URL of the document service (defaults to the one in document_store)
 * @param {number} [options.limit]    - max number of history entries to return
 * @param {number} [options.timeoutMs] - request timeout in ms (default 10 000)
 * @param {AbortSignal} [options.signal] - optional abort signal
 * @returns {Promise<Object[]>} array of document descriptors
 */
export async function getBrowseHistory({
    baseURL,
    limit,
    timeoutMs = 10000,
    signal
} = {}) {
    // Re‑use the listDocuments helper from document_store.js
    return await DocStore.listDocuments({
        collection: 'docs',
        limit,
        baseURL,
        timeoutMs,
        signal
    });
}
