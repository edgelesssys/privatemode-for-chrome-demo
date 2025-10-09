// Chat state & streaming utilities extracted from index.js
import { PRIVATEMODE_API_BASE, DEFAULT_MODEL, requestStream } from './pm_client.js';
import { buildRequestMessages } from './request.js';
import { getCurrentBaseDomain } from './context.js';
import { saveFullDocument, loadFullDocument } from './document_store.js';

// In-memory chat histories per base domain
// Map baseDomain -> Chat
export const chats = {};

export class Chat {
    constructor(baseDomain) {
        this.baseDomain = baseDomain;
        this.id = this.baseDomain || 'unknown';
        this.messages = [];
        this.lastRagResults = [];
    }

    /**
     * Fire-and-forget persistence of the transcript (no await required by callers).
     * Uses collection "chats" and the baseDomain as the document id.
     */
    save() {
        if (["newtab", "extensions"].includes(this.id)) return;
        const text = JSON.stringify({ version: 1, messages: this.messages });
        (async () => {
            try {
                await saveFullDocument({ collection: 'chats', id: this.id, text });
            } catch (err) {
                console.error('[chat] save failed:', err);
            }
        })();
    }

    /**
     * Blocking load of a previously saved transcript.
     * Populates this.messages if currently empty.
     */
    async load() {
        if (["newtab", "extensions"].includes(this.id)) return;
        await (async () => {
            try {
                if (this.messages.length) return;
                const { doc } = await loadFullDocument({ collection: 'chats', id: this.id });
                if (!doc || this.messages.length) return;
                let parsed = null;
                try { parsed = JSON.parse(doc); } catch (_) { /* legacy format */ }
                if (parsed && Array.isArray(parsed.messages)) {
                    this.messages = parsed.messages;
                }
            } catch (err) {
                console.debug('[chat] load failed:', err);
            }
        })();
    }
}

export async function getCurrentChat() {
    const key = getCurrentBaseDomain?.() || 'unknown';
    if (!chats[key]) {
        const chat = new Chat(key);
        chats[key] = chat;
        // Fire-and-forget load of prior transcript
        await chat.load();
    }
    return chats[key];
}

function getSourceRef(text) {
    const match = String(text || '').match(/(ref_\d+)/);
    if (!match || match.length < 1) return null;

    const srcRef = match[0];
    // only forward if we are sure the ref is complete, i.e., the match is shorter than the buffer
    return srcRef && (srcRef.length < text.length) ? srcRef : null;
}

class ResponseParser {
    constructor(browseHistoryLinks, onDelta) {
        this.browseHistoryLinks = browseHistoryLinks;
        this.onDelta = onDelta;
        this.buffer = '';
        this.full = '';
    }

    forward(text) {
        this.onDelta?.(text);
        this.full += text;
    }

    processDelta(deltaContent) {
        this.buffer += deltaContent;
        const index = this.buffer.indexOf('ref');

        // no ref found, just forward the whole buffer
        if (index === -1) {
            this.forward(this.buffer);
            this.buffer = '';
            return;
        }

        // forward text before ref
        if (index !== 0) {
            this.forward(this.buffer.slice(0, index));
            this.buffer = this.buffer.slice(index);
        }

        // different string, just forward
        if (this.buffer.length > 4 && !this.buffer.startsWith('ref_')) {
            this.forward(this.buffer);
            this.buffer = '';
            return;
        }

        // try to extract and replace the src reference
        const srcRef = getSourceRef(this.buffer);
        if (srcRef) {
            const link = this.browseHistoryLinks[srcRef] || ('[unknown:]' + srcRef);
            this.forward(link);
            this.buffer = this.buffer.slice(srcRef.length);
        }
    }

    finalize() {
        if (this.buffer) {
            this.forward(this.buffer);
        }
        return this.full;
    }
}

// Stream assistant response.
// Parameters:
//   chat: Chat instance whose messages will be sent
//   generationConfig: { temperature?: number }
//   onDelta: function(tokenText) called for each streamed text chunk
export async function streamRequest(chat, generationConfig, onDelta) {
    const temperature = Number(generationConfig?.temperature ?? 1);
    const [messages, browseHistoryLinks] = await buildRequestMessages(chat);
    try {
        const stream = await requestStream({
            baseURL: `${PRIVATEMODE_API_BASE}`,
            model: DEFAULT_MODEL,
            messages: messages,
            temperature
        });
        const parser = new ResponseParser(browseHistoryLinks, onDelta);
        for await (const event of stream) {
            const delta = event?.choices?.[0]?.delta;
            if (!delta) continue;
            if (typeof delta.content === 'string' && delta.content) {
                parser.processDelta(delta.content);
            }
        }
        return parser.finalize();
    } catch (e) {
        if (e && /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND/i.test(String(e?.message || e))) {
            throw new Error(
                "Can't connect to the local AI server at http://localhost:8080. Please make sure it's running and reachable."
            );
        }
        console.error('Prompt failed', e);
        // Safely log current chat messages for debugging
        try { console.log('Messages:', chat?.messages); } catch (_) { /* ignore */ }
        throw e;
    }
}
