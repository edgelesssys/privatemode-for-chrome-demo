// Key Management - generates and stores a random API key

const STORAGE_KEY = 'api_key';

let apiKey = null;

async function generateRandomApiKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateApiKey() {
    if (apiKey) return apiKey;

    let stored;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        stored = await chrome.storage.local.get([STORAGE_KEY]);
        stored = stored[STORAGE_KEY];
    } else {
        stored = localStorage.getItem(STORAGE_KEY);
    }

    if (stored) {
        apiKey = stored;
    } else {
        apiKey = await generateRandomApiKey();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [STORAGE_KEY]: apiKey });
        } else {
            localStorage.setItem(STORAGE_KEY, apiKey);
        }
    }
    return apiKey;
}

export async function getDocumentStoreApiKey() {
    return await getOrCreateApiKey();
}
