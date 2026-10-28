# Code guide

This note describes how the current prototype is put together. It is intended to help a future maintainer understand where a behavior lives and what the browser stores.

## Runtime shape

The project is deliberately static: the browser loads `index.html` or `journal.html`, includes `style.css`, then runs the shared `app.js`. There is no compiler, package manager, server API, or external JavaScript library. The same script is included on both pages, so each function checks for the page elements it needs when appropriate.

The app has three layers:

1. **Screens** — `index.html` contains login/registration; `journal.html` contains the editor and entry list.
2. **Behavior** — `app.js` owns session state, input handlers, rendering, and media capture/preview.
3. **Persistence** — IndexedDB holds users, entries, and photos; `localStorage` holds the active session.

## `app.js` map

### Constants and in-memory state

- `AUTH_KEY`, `DB_NAME`, and `DB_VERSION` name the browser session key and IndexedDB schema.
- `MAX_PHOTO_BYTES` is the upload size limit per image.
- `currentUser`, `currentEntryId`, `encryptionKey`, `currentMood`, `currentMusic`, `currentPhotos`, and `cameraStream` describe the editor/session while the page is open. They are not all persisted directly; save operations serialize entry and photo data.

### Legacy encoding helpers

`simpleHash`, `strongHash`, `encrypt`, `decrypt`, `encryptBuffer`, and `decryptBuffer` are the existing prototype's lightweight hash/XOR/base64 helpers. They allow old records to round-trip through the current UI, but **they do not provide security**. Do not reuse them as cryptographic primitives or assume the records are private. A future security redesign needs a migration plan for existing IndexedDB records.

### IndexedDB functions

`openDB()` opens `VibeJournalDB`, creates the three stores on the first install, and reuses its promise during the page lifetime. The small `get...DB`, `put...DB`, and `delete...DB` helpers each wrap an IndexedDB request/transaction in a promise:

- `getUserDB` / `saveUserDB`: read or write one local account.
- `getEntriesDB` / `putEntryDB`: list one account's records or insert/update a record.
- `getPhotosByEntryDB` / `putPhotoDB`: read or write image records.
- `deletePhotosByEntryDB` / `deleteEntryDB`: remove an entry's image records; deleting the entry also removes its photos.

The schema uses object-store key paths: user `username`, entry `id`, and photo `photoId`. Entry/photo indexes support lookups by `username` and `entryId`. If the schema changes, increment `DB_VERSION` and add an `onupgradeneeded` migration; do not delete the existing database casually because it contains the user's journal.

### Account and session flow

- `switchTab` switches the visible auth form; `showError` writes a friendly message in the auth page.
- `handleRegister` validates fields and adds a user record after checking username availability.
- `handleLogin` reads the user, checks the stored verifier, and writes a session object to local storage before opening `journal.html`.
- `checkAuthAndLoad` validates that session on the journal page, loads the current user's entries, and starts a blank editor.
- `handleLogout` clears the local session, stops an active camera stream, and returns to login.

Because authentication runs entirely in client JavaScript, it is only a convenience for separate local profiles. It is not an authorization boundary. Browser data is not synced between devices.

### Entry rendering and search

`loadEntries` reads the current user's entries, sorts newest dates first, and constructs list items with DOM nodes and `textContent` so entry text is treated as text rather than HTML. It adds a lowercase search string from decrypted title, body, and date. `filterEntries` hides list items that do not match the current search field.

`newEntry` resets the editor state. `selectEntry` loads the selected entry, mood, music, and photo previews. `setMood` keeps the in-memory mood and selected-button UI in sync. `saveEntry` validates required data, writes the entry, then writes its photos. `deleteEntry` asks for confirmation, removes the entry and its photos, and clears the editor.

### Music and photos

- `extractYoutubeVideoId` identifies a YouTube video ID; `parseMusicLink` stores the ID and `renderMusicEmbed` displays an iframe. `removeMusic` clears it.
- `handlePhotoUpload` accepts image files up to 8 MB each and converts them to data URLs for the editor. `addPhotoFromDataUrl`, `renderPhotoGallery`, and `removePhoto` manage previews. `dataUrlToBlob` converts a preview back to bytes at save time.
- `openCamera`, `snapPhoto`, and `closeCamera` handle the optional camera flow. Camera access depends on browser permission and secure-context rules.
- `blobToDataURL` bridges IndexedDB image blobs and the gallery. Stored photo bytes are encoded using the legacy helper.

## Markup and styles

`index.html` provides labeled username/password controls, browser autocomplete hints, and the inline auth forms. `journal.html` provides the searchable entry list and editor fields. Inline handlers in the markup call named functions from `app.js`; if handlers are refactored, update both pages consistently.

`style.css` owns the diary styling, list/editor layout, form controls, media cards, and a responsive breakpoint at 900 px. The `.hidden` utility is also used by JavaScript to hide filtered entries and optional controls. The `.sr-only` utility provides a visual-hidden search label for assistive technology.

## Current behavior and known limits

- Only one entry is open in the editor at a time. Starting a new page clears the current editor; unsaved-change prompts/autosave are not implemented.
- Search covers the current account's title, text, and date, not mood or music.
- Photos are stored as separate records but are read into the editor as data URLs. Large photo collections can use substantial browser quota even with the per-file cap.
- Saving edits replaces the entry's stored photo set with the gallery's current set.
- There is no export/import, backup, multi-device sync, blog publishing, public profile, comments, or server-side account system.
- YouTube playback is embedded from YouTube and can be blocked by the video owner's settings or the network.

## Suggested change boundaries

- UI text/structure: edit the relevant HTML page and matching CSS rules.
- Entry rules and interactions: edit the corresponding `app.js` handler, then ensure its state is reflected in `loadEntries`, `selectEntry`, and `saveEntry` as appropriate.
- Persistent record shape: change IndexedDB version/migration first, then update every read/write path and explain the migration in `README.md`.
- Privacy/security behavior: treat as a separate redesign, including a migration for current records; do not call the existing XOR scheme encryption in product copy.
