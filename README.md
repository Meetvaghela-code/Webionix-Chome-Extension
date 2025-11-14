# Chrome Extension + Local Flask AI Backend

A small developer demo that demonstrates a Chrome extension which sends the active tab URL and a question to a local Flask backend. The backend fetches the web page, creates embeddings (using a local Hugging Face model), runs a RetrievalQA flow against an LLM, and returns a cleaned, structured result back to the extension popup.

This repository contains two top-level parts:

- `backend/` — Flask server and LangChain orchestration (document loading, splitting, FAISS vector store, embeddings, LLM invocation, structured parsing).
- `extension/` — Chrome extension popup UI (HTML/CSS/JS) and `manifest.json`.

This README explains how to set up and run the project, how the API works, useful development tips, and how to generate assets for the extension.

---

## Status

- Backend: runs as a local Flask app at `http://127.0.0.1:5000`.
- Endpoints provided: `/ping`, `/health`, `/query`.
- Embeddings: uses `sentence-transformers` model `all-MiniLM-L6-v2` (local, lightweight).
- LLM: currently configured to use Google Generative AI (Gemini) via `langchain_google_genai`. If `GOOGLE_API_KEY` is not set, LLM initialization will be disabled and queries that require LLM will fail.
- Structured parsing: the backend expects a LangChain `StructuredOutputParser` to be available. If it is unavailable or fails, the server returns HTTP 500. (You can edit `backend/server.py` to relax this behavior if you prefer a plain-text fallback.)

---

## Quick start (Windows / PowerShell)

Open a PowerShell terminal and run the following from the project root (`d:\Chrome-extension`):

1. Create and activate a virtual environment

```powershell
cd d:\Chrome-extension\backend
python -m venv .venv
.\.venv\Scripts\Activate
```

2. Install dependencies

```powershell
pip install --upgrade pip
pip install -r requirements.txt
```

3. (Optional) Set your Google API key in the current session (if you want the Google LLM):

```powershell
$Env:GOOGLE_API_KEY = 'your-google-api-key'
```

4. Run the Flask server

```powershell
$Env:FLASK_APP = 'server'
flask --app server run
```

By default Flask runs at `http://127.0.0.1:5000`.

---

## Backend endpoints

### GET /ping
A lightweight health check.
Response: `200 OK` with JSON `{"status":"ok"}`

### GET /health
Returns initialization status for LLM and embeddings.
Example response:
```json
{
  "llm_initialized": true,
  "embeddings_initialized": true
}
```

### POST /query
Main endpoint. Accepts JSON:
```json
{
  "url": "https://example.com/some-article",
  "question": "What are the downsides of this device?"
}
```

On success (structured parsing enabled and successful) the server returns:
```json
{
  "answer": "Concise human-friendly summary derived from structured output",
  "raw": { /* original chain output or result */ },
  "structured": { /* dict or list from StructuredOutputParser */ }
}
```

If the server cannot produce structured output (parser missing or failed), it currently returns HTTP 500 with an explanatory JSON error. You can change this behavior in `backend/server.py` to allow a simple text fallback.

---

## Development notes and common troubleshooting

- If you see import errors for `langchain.output_parsers` or related modules in your editor, that may mean the exact LangChain variant is not installed in the environment the editor uses. Verify with `pip freeze` inside the virtual environment used to run the server.

- The backend expects a `StructuredOutputParser` implementation to be present and compatible. LangChain has had several layout and API changes across releases. If you get structured parser import/initialization errors, either:
  - Install a LangChain variant that provides `StructuredOutputParser` and `ResponseSchema`, or
  - Edit `backend/server.py` to re-enable a simpler text-cleaner fallback (the repo had versions that provided that fallback).

- If LLM is not initialized because `GOOGLE_API_KEY` is missing, you can either set the API key in your environment and restart Flask or implement/use a local HF LLM fallback (requires heavy dependencies like `transformers` / `text-generation` models). Ask if you want me to add a local HF LLM fallback.

- If the Chrome extension's popup appears to hang or spinner gets stuck, reload the extension in `chrome://extensions` after editing `extention/popup.js`. The popup script includes defensive overlay hide/timeout logic to avoid permanent spinners.

---

## Extension (installing locally)

1. Open `chrome://extensions/` in Chrome.
2. Toggle on "Developer mode" (top-right).
3. Click "Load unpacked" and select the `extension/` folder inside the repository.
4. Open any page, click the extension icon, type a question in the popup, and submit. The popup will POST to `http://127.0.0.1:5000/query`.

Note: If your backend is running on a different host/port change the POST URL in `extension/popup.js` and adjust `manifest.json` host permissions.

---

## Assets and icons

The project includes an `extension/` folder for the browser UI. To create a modern-looking hero image and icon set I recommend generating assets with an image generator (Midjourney / SDXL / DALL·E) using the prompts provided in the repo history. Suggested icon filenames and sizes:

- `extension/icons/icon-512.png` (512x512, store)
- `extension/icons/icon-128.png` (128x128)
- `extension/icons/icon-48.png` (48x48)
- `extension/icons/icon-32.png` (32x32)
- `extension/icons/icon-16.png` (16x16)
- `extension/icons/icon.svg` (master vector)

Color palette suggestion:
- Primary teal: `#0F9D98`
- Deep navy: `#053F5E`
- Lime accent: `#C8FF6A`

If you'd like, I can generate simple programmatic SVG icon files and add them into `extension/icons/` for immediate use — tell me your preferred style (flat/rounded/monochrome).

---

## Contributing

If you make changes and want to contribute back:

1. Fork the repo
2. Create a feature branch
3. Make changes and add tests where appropriate
4. Submit a pull request with context and tests

---

## Files of interest

- `backend/server.py` — main Flask app and LangChain orchestration
- `backend/requirements.txt` — Python dependencies
- `extension/popup.html` — extension popup UI
- `extension/popup.js` — extension popup behavior and code
- `extension/manifest.json` — extension manifest and permissions

---

## License

This project does not include a license file. Add a license of your choice (MIT, Apache-2.0, etc.) if you plan to publish the code.

---

If you want, I can now:
- add a simple programmatic SVG icon set into `extension/icons/`, or
- add an alternative path that re-enables the simple text fallback for `/query`, or
- prepare step-by-step publishing notes to upload the extension to the Chrome Web Store.

Which would you like next?
