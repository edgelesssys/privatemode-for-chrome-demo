# Privatemode AI Chrome Extension (Experimental)

> **⚠️ EXPERIMENTAL - NOT FOR PRODUCTION USE**
>
> This Chrome extension is an **experimental proof-of-concept** designed to validate the feasibility of confidential AI assistance in the browser. It is **not production-ready** and should be used for exploration and demonstration purposes only.
>
> **What to expect:**
> - Bugs and limited functionality
> - No guarantees on maintenance or support
> - May be modified or removed at any time
> - Local storage is not production-grade: Browsing history stored locally without encryption
>
> **This is a vision piece** to show what's possible with privacy-preserving AI in the browser - not something you should depend on for real-world use.
>
> **Note:** The Privatemode proxy itself provides confidential AI communication as designed - the experimental nature applies to this extension's implementation.

The [Privatemode](https://www.privatemode.ai) Chrome extension demonstrates a confidential AI assistant within your browser. It reads the current page and can answer questions about it using a local Privatemode endpoint (<http://localhost:8080>). It keeps communication with AI confidential, showcasing the potential for privacy-preserving AI assistance in the browser that works with sensitive documents, websites, etc. As it remembers the pages you browsed, it can also answer questions about past visits.

## Overview

This experimental extension demonstrates how to capture current page content, send it along with your question and RAG context of previous conversations via a local Privatemode proxy endpoint (OpenAI `chat/completions` compatible), and display grounded answers in a chat UI.

### Limitations & Known Issues

- **Local storage security**: Browse history is stored in the local file system without encryption or production-grade protection
- **Extension implementation**: Minimal quality assurance and security review of the extension code
- **No support**: No committed maintenance schedule or bug fixes
- **Breaking changes**: May change or break without notice

**Note:** While the extension is experimental, it demonstrates real confidential AI communication - the Privatemode proxy encrypts all prompts and responses as designed.

## Requirements

- [Privatemode proxy](https://docs.privatemode.ai/guides/proxy-configuration) running on <http://localhost:8080> (default) or other host/port as configured. Make sure to enable [prompt caching](https://docs.privatemode.ai/guides/proxy-configuration#prompt-caching) in the proxy to reduce latency and cost.
- [Privatemode Document Store](https://github.com/edgelesssys/privatemode-document-store-demo) running on <http://localhost:8081> for document storage and retrieval.

## 🔒 About the Privatemode Proxy

This extension requires the [Privatemode proxy](https://docs.privatemode.ai/quickstart) to be running locally or on a trusted host. With Privatemode, your data and prompts are encrypted during processing and cannot be accessed by anyone but you nor can it be used for model training.

The Privatemode proxy is a lightweight service that does the following:

- It encrypts data sent to Privatemode and decrypts all data received.
- It verifies the integrity of the Privatemode backend.
- It exposes an OpenAI-compatible API endpoint for AI inference.

Run it via Docker:

```bash
docker run -p 8080:8080 \
  ghcr.io/edgelesssys/privatemode/privatemode-proxy:latest \
  --apiKey <your-api-key>
```

You can get started for free with a [Privatemode API key](https://www.privatemode.ai/pricing).

Learn more about Privatemode and the proxy in the [docs](https://docs.privatemode.ai/quickstart).

## Development

```bash
npm install
npm run build [ --debug ]
```

Install in Chrome via `chrome://extensions/`:

- enabled developer mode
- install via `Load unpacked` and select the repo directory

When making changes to the code, building and reloading the extension (close + open) is sufficient to apply the changes to a running extension. See below for running the extension as a website for more interactive debugging.

## Security

⚠️ **Experimental security implementation** - not suitable for production use:

- ✅ Bind: 127.0.0.1 only.
- ✅ Auth: only one instance of the chrome extension allowed by authenticating on first use; blocking others.
- ⚠️ **No guarantee of local data at rest protection**: Stored content is not encrypted or securely protected.
- ⚠️ **No security audit**: This implementation has not undergone security review.

When updating the extension, the authentication key stored in the document storage service has to be reset to allow the new extension to connect.

## Build-time configuration

By default, `PRIVATEMODE_BASE_URL` is `http://localhost:8080` and `PRIVATEMODE_API_KEY` is `NONE`. If your proxy is started with an API key and does not require a client-provided key, you can leave `PRIVATEMODE_API_KEY` as `NONE`.

You can configure the Privatemode endpoint and API key at build time using environment variables. These values are inlined during bundling, so be sure to re-run the build after making any changes.

```sh
PRIVATEMODE_BASE_URL="http://localhost:8080" PRIVATEMODE_API_KEY="sk-your-key" npm run build
```

## Run

1. Install dependencies:

    ```sh
    npm install
    ```

2. Build the side panel bundle:

    ```sh
    npm run build
    ```

3. In Chrome, load this folder as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked).
4. Ensure your local Privatemode endpoint is running on <http://localhost:8080>.
5. Click the extension icon and use the side panel to send prompts.

### Usage

1. Open any web page you want to query.
2. Open the side panel via the extension icon.
3. Ask a question about the page; the chat will use the page’s content as context.

## Notes

- Default API key is `NONE`. If your proxy requires a specific key, set `PRIVATEMODE_API_KEY` at build time as described above.
- Manifest includes host permissions for `http://localhost:8080/*` so the extension can reach your local Privatemode instance.

## Test server (run the side panel as a website)

For quick iteration without loading the Chrome extension, you can serve the side panel as a regular web page.

1. Build the bundle:

    ```sh
    npm run build
    ```

2. Start the test server:

    ```sh
    npm run dev:sidepanel
    ```

3. Open the app in your browser:

    - <http://localhost:5173/> (auto-redirects to `/sidepanel/`)

The page uses the same code as the extension and will call your Privatemode endpoint at <http://localhost:8080>. To change the server port:

```sh
PORT=5000 npm run dev:sidepanel
```

All-in-one (build + serve):

```sh
npm run test:sidepanel
```
