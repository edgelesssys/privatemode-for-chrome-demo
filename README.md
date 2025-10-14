# Privatemode AI Chrome Extension (Experimental)

> **⚠️ Experimental - not for production use**
>
> This Chrome extension is an experimental proof-of-concept designed to validate the feasibility of a confidential AI assistant in the browser. 
>
> What to expect:
> - Bugs and limited functionality
> - No guarantees on maintenance or support
> - Browsing history is stored locally without encryption

The Privatemode Chrome extension provides a confidential AI assistant within your browser. It reads the current page and browsing history and can answer questions about it. It keeps all communication with AI confidential, ensuring privacy for sensitive documents, websites, etc. 

Under the hood, the extension uses the confidential computing-based AI service [Privatemode](https://www.privatemode.ai/).

## 🚀 Getting started

### Prerequisites

1. Create a free [Privatemode account](https://portal.privatemode.ai/sign-in/create). 

2. Run the following software locally: 

    - 🔒 [Privatemode Proxy](https://docs.privatemode.ai/guides/proxy-configuration) running on <http://localhost:8080>. Make sure to enable [prompt caching](https://docs.privatemode.ai/guides/proxy-configuration#prompt-caching) in the proxy to reduce latency and token consumption. The Privatemode Proxy verifies the integrity of the Privatemode AI backend using remote attestation and encrypts your data before sending it to the backend.  
    - 📚 [Privatemode Document Store](https://github.com/edgelesssys/privatemode-document-store-demo) running on <http://localhost:8081> for document storage and retrieval.

### Build and install the extension


1. Install dependencies:

    ```sh
    npm install
    ```

2. Build the extension:

    ```sh
    npm run build
    ```

3. In Chrome, load this folder as an [unpacked extension](https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked).
4. Ensure your local Privatemode endpoint is running on <http://localhost:8080>.
5. Click the extension icon and use the side panel to send prompts.

🎉 Congratulations. You now have a privacy-preserving chat assistant in your browser.

## 🛠️ Development

Want to work on the code of the extension? Great! For the best experience, enable "developer mode" for the extension in `chrome://extensions/`.

When making changes to the code, building and reloading the extension (close + open) is sufficient to apply the changes to a running extension. See below for running the extension as a website for more interactive debugging.

### Build-time configuration

By default, `PRIVATEMODE_BASE_URL` is `http://localhost:8080` and `PRIVATEMODE_API_KEY` is `NONE`. If your proxy is started with an API key and does not require a client-provided key, you can leave `PRIVATEMODE_API_KEY` as `NONE`.

You can configure the Privatemode endpoint and API key at build time using environment variables. These values are inlined during bundling, so be sure to re-run the build after making any changes.

```sh
PRIVATEMODE_BASE_URL="http://localhost:8080" PRIVATEMODE_API_KEY="sk-your-key" npm run build
```

### Test server (run the side panel as a website)

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

## 📝 Notes

* When updating the extension, the authentication key stored in the document storage service has to be reset to allow the new extension to connect.
* Manifest includes host permissions for `http://localhost:8080/*` so the extension can reach your local Privatemode instance.
When updating the extension, the authentication key stored in the document storage service has to be reset to allow the new extension to connect.

## ⚠️ Limitations & known issues

- **Local storage security**: Browse history is stored in the local file system without encryption or production-grade protection
- **Extension implementation**: Minimal quality assurance and security review of the extension code
- **No support**: No committed maintenance schedule or bug fixes
- **Breaking changes**: May change or break without notice
