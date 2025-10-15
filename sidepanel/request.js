// Helpers to prepare LLM request messages and limit chat history
import { SYSTEM_PROMPT, HISTORY_CHAR_BUDGET } from './pm_client.js';
import { getPageContext } from './context.js';
import { retrieveContext } from './retriever.js';

// Limit page-context text portion sent to the model (approx ~5k tokens)
const PAGE_CONTEXT_CHAR_LIMIT = 20000;

// Helper to extract domain from URL
function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch (_) {
        return url; // fallback to raw string if URL parsing fails
    }
}

// Helper to format ISO timestamp to "{date} {time}" where date is "today", "yesterday", or DATE, time is HH:MM
function formatUpdatedAt(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString; // fallback if invalid

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let dateStr;
    if (date >= today) {
        dateStr = 'today';
    } else if (date >= yesterday) {
        dateStr = 'yesterday';
    } else {
        dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    const timeStr = date.toTimeString().slice(0, 5); // HH:MM
    return `${dateStr} ${timeStr}`;
}

// New helper: convert browse history array to markdown and linkMap
function browserHistoryToMarkdown(browseHistory) {
    if (!Array.isArray(browseHistory) || !browseHistory.length) return ['', {}];

    const lines = [];
    const linkMap = {};

    browseHistory.forEach((doc, idx) => {
        const title = doc.title || doc.id || 'Untitled';
        const url = doc.metadata?.url || doc.metadata?.link || '';
        const updated = formatUpdatedAt(doc.metadata?.updated_at);
        let line = '';

        // prepend updated timestamp if present
        if (updated) line += `${updated}: `;

        line += title;

        if (url) {
            const domain = extractDomain(url);
            const ref = `ref_${idx}`;
            linkMap[ref] = url;
            line += ` [${domain}](${ref})`;
        }

        lines.push(`- ${line}`);
    });

    const markdown = `**Browse history**\n${lines.join('\n')}\n\n`;
    return [markdown, linkMap];
}

// Build full message array with system + page context + limited history
export async function buildRequestMessages(chat) {
    let systemContent = SYSTEM_PROMPT;
    const ctx = getPageContext();
    if (ctx?.content) {
        try {
            const parsed = JSON.parse(ctx.content);
            if (parsed && typeof parsed === 'object') {
                if (parsed.text && typeof parsed.text === 'string' && parsed.text.length > PAGE_CONTEXT_CHAR_LIMIT) {
                    parsed.text = parsed.text.slice(0, PAGE_CONTEXT_CHAR_LIMIT);
                }
                const limited = JSON.stringify(parsed);
                systemContent += `\n\nCurrent page (JSON with keys: title, url, metaDescription, headings, text). Use as grounding: ${limited}`;
            }
        } catch (_) {
            console.warn('buildRequestMessages: page context is not valid JSON, sending as raw text');
            const limitedRaw = String(ctx.content).slice(0, PAGE_CONTEXT_CHAR_LIMIT);
            systemContent += `\n\nPage context (raw): ${limitedRaw}`;
        }
    }

    // ignore last message, which is already the response placeholder
    const limitedHistory = limitChatHistory(chat.messages.slice(0, -1), HISTORY_CHAR_BUDGET);
    let messages = [{ role: 'system', content: systemContent }, ...limitedHistory];

    // Build retrieval context and insert as two messages before the last message
    const ragCtx = await retrieveContext(chat.messages.slice(0, -1), ctx?.content || '');

    const historyContent = ragCtx.history_content || [];
    const historySummary = ragCtx.history_summary || [];
    const historyOverview = ragCtx.history_overview || [];

    // use historyContent if not empty, otherwise fallback to historySummary
    const history = historyContent.length ? historyContent : historySummary;

    // convert history array to a string: each entry as "title\nurl\n\ncontent", separated by "\n\n"
    let historyContentStr = '';
    if (Array.isArray(history) && history.length) {
        historyContentStr = history.map(entry => {
            const title = "## Page: " + (entry.title || 'Untitled');

            // Indent page content for clarity
            const url = "  " + entry.url || entry.metadata?.url || '';
            const content = (entry.content || '').split('\n').map(line => '    ' + line).join('\n');
            return `${title}\n${url}\n\n${content}`;
        }).join('\n\n');
    }

    const [browseHistoryMd, browseHistoryLinks] = browserHistoryToMarkdown(historyOverview)

    // prepend browse history (if any) to the retrieval context
    const historyContentMessage = historyContentStr ? "Content from recently visited pages:\n" + historyContentStr : ""
    const combinedCtx = browseHistoryMd + historyContentMessage;

    if (combinedCtx) {
        const msg = 'Here is context from other visited pages:\n\n';
        const currentPageUrl = getPageContext()?.url || 'unknown page';
        const currentPageNote = `\n\nThe current page is ${currentPageUrl}`;

        // Insert before the last message (last is the current user's prompt)
        const insertPos = messages.length > 3 ? messages.length - 3 : messages.length - 1;

        const modelRequiresAlternatingMessages = false;
        if (modelRequiresAlternatingMessages) {
            messages.splice(insertPos, 0,
                { role: 'user', content: msg + combinedCtx + currentPageNote },
                { role: 'assistant', content: 'OK' }
            );
        } else {
            messages.splice(insertPos, 0,
                { role: 'system', content: msg + combinedCtx + currentPageNote }
            );
        }
    }
    return [messages, browseHistoryLinks];
}

// Limit history by approximate character budget from the end
export function limitChatHistory(messages, budget) {
    let remaining = Math.max(0, Number(budget) || 0);
    if (!remaining) return messages.slice(-6); // fallback: last few messages
    const out = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const len = (m.content || '').length + 20; // role + margins
        if (len <= remaining || out.length === 0) {
            out.push(m);
            remaining -= len;
        } else {
            break;
        }
    }
    return out.reverse();
}
