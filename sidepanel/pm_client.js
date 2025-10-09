import OpenAI from 'openai';

// --- Constants moved from index.js ---
// Prefer build-time injected base URL, fall back to default
export const PRIVATEMODE_BASE_URL = (typeof __PRIVATEMODE_BASE_URL__ !== 'undefined' && __PRIVATEMODE_BASE_URL__)
    ? __PRIVATEMODE_BASE_URL__
    : 'http://localhost:8080';

export const PRIVATEMODE_API_BASE = `${PRIVATEMODE_BASE_URL}/v1`;
export const PM_UNSTRUCTURED_GENERAL = `${PRIVATEMODE_BASE_URL}/unstructured/general/v0/general`;
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';
//export const DEFAULT_MODEL = 'qwen3-coder-30b-a3b';
//export const DEFAULT_MODEL = 'leon-se/gemma-3-27b-it-fp8-dynamic';
export const SYSTEM_PROMPT = `You are the Privatemode AI Chrome extension running in the user's browser.
- Below is the content of the current website; further down related context from pages visited in the past.
- Only talk about the content if asked!
- Always respond concisely. If a page summary is requested, provide a brief overview of the main points only.
- Provide links to sources where possible. Some links are shown as "ref_1", "ref_2", etc. to make them short. Use them as references using "ref_1, ref_2" or "[text](ref_1)".
- Never invent any content, only talk about what you really know. Otherwise ask for details.`;
export const HISTORY_CHAR_BUDGET = 12000; // cap chat history sent each turn

// In extensions/local setups, the API might not require a key.
// Prefer build-time injected key, fall back to a dummy.
export const DEFAULT_API_KEY = (typeof __PRIVATEMODE_API_KEY__ !== 'undefined' && __PRIVATEMODE_API_KEY__)
    ? __PRIVATEMODE_API_KEY__
    : 'NONE';

// requestStream: returns an async iterable of ChatCompletionChunk events
export async function requestStream({
    baseURL = PRIVATEMODE_API_BASE,
    apiKey = DEFAULT_API_KEY,
    model = DEFAULT_MODEL,
    messages,
    temperature,
    tools,
    response_format
}) {
    const client = new OpenAI({
        apiKey,
        baseURL,
        dangerouslyAllowBrowser: true,
        fetch: async (input, init) => {
            const sanitize = (h) => (
                !h ? {} : Object.fromEntries(
                    Object.entries(h).filter(([k]) => !k.toLowerCase().startsWith('x-stainless-'))
                )
            );
            try {
                return fetch(input, { ...init, headers: sanitize(init?.headers) });
            } catch (_) {
                // Fallback: if anything goes wrong, just forward the request
                return fetch(input, init);
            }
        }
    });

    const params = {
        model,
        messages,
        temperature,
        stream: true,
        stream_options: {
            include_usage: true
        },
        reasoning_effort: 'low'
    };
    if (Array.isArray(tools) && tools.length) params.tools = tools;
    if (response_format) params.response_format = response_format;

    // This returns an AsyncIterable (SDK-managed stream)
    return client.chat.completions.create(params);
}

// ------------------------------------------------------------
// PDF -> text helper (browser) inspired by provided Python sample
// Accepts a PDF as raw bytes (ArrayBuffer | Uint8Array | Blob)
// and returns plain text extracted by the backend unstructured service.
// The backend is expected to expose a POST /unstructured/general endpoint
// accepting multipart/form-data with fields: files, strategy.
export async function pdfBytesToText(pdfBytes, {
    baseURL = PM_UNSTRUCTURED_GENERAL,
    apiKey = DEFAULT_API_KEY,
    filename = 'file.pdf',
    strategy = 'fast',
    timeoutMs = 120000
} = {}) {
    try {
        if (!pdfBytes) return '';
        let blob;
        if (pdfBytes instanceof Blob) {
            blob = pdfBytes;
        } else if (pdfBytes instanceof ArrayBuffer) {
            blob = new Blob([pdfBytes], { type: 'application/pdf' });
        } else if (ArrayBuffer.isView(pdfBytes)) { // TypedArray
            blob = new Blob([pdfBytes.buffer], { type: 'application/pdf' });
        } else {
            console.warn('pdfBytesToText: unsupported input type');
            return '';
        }

        const form = new FormData();
        form.append('files', blob, filename);
        form.append('strategy', strategy);

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const headers = new Headers({ 'Accept': 'application/json' });
        if (apiKey && apiKey !== 'NONE') {
            headers.set('Authorization', `Bearer ${apiKey}`);
        }
        const resp = await fetch(baseURL, {
            method: 'POST',
            body: form,
            headers, // fetch will merge form boundary automatically
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
            console.warn('pdfBytesToText: backend error', resp.status);
            return '';
        }
        let json;
        try { json = await resp.json(); } catch (e) { return ''; }
        // Some deployments may return { elements: [...] } or a raw array
        const elements = Array.isArray(json) ? json : (Array.isArray(json?.elements) ? json.elements : []);
        if (!elements.length) return '';
        const parts = [];
        for (const el of elements) {
            if (el && typeof el === 'object') {
                const t = el.text || el.Title || el.content || null;
                if (t && typeof t === 'string') parts.push(t);
            }
        }
        console.log('pdfBytesToText: extracted', parts.length, 'elements');
        return parts.join('\n');
    } catch (e) {
        if (e?.name === 'AbortError') {
            console.warn('pdfBytesToText: request timed out');
            return '';
        }
        console.warn('pdfBytesToText: failed', e);
        return '';
    }
}
