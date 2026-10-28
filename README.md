# Vibe Journal

> A vibe-coded, browser-based personal journal prototype built with AI assistance.

Vibe Journal is a small, dependency-free writing app for keeping dated entries with a title, mood, optional YouTube song, and photos. It runs as static HTML, CSS, and JavaScript and stores data in the browser's IndexedDB. It is a local personal journal; it does not publish public blogs or sync across devices.

## Features

- Create a local account and sign in on the current browser profile.
- Create, edit, browse, search, and delete dated journal pages.
- Add a mood, an embeddable YouTube / YouTube Music video, and photos.
- Limit each uploaded photo to 8 MB to reduce accidental browser storage exhaustion.
- Upload image files or take a photo using a camera when the browser grants access.
- Keep multiple local accounts isolated by username in the journal data.
- Use the responsive layout on desktop and smaller screens.

## Run it

There is no build step or package installation. The simplest option is to open `index.html` in a modern browser. For camera support and more predictable browser storage behavior, serve this folder from `localhost` (camera access generally requires a secure context):

```sh
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). You can also open the folder in GitHub Desktop and use its repository menu to show it in Explorer or open a terminal.

## How to use

1. Choose **Register**, enter a username and password, and create a local account.
2. Sign in, then choose **+ New Page**.
3. Set the date and title, write the entry, and optionally pick a mood or add a song/photos.
4. Select **Save Page**. Pick a page from the left list to edit it; **Delete Page** removes that page and its stored photos.
5. Use **Logout** to end the local session.

YouTube links should be a standard `youtube.com/watch`, `youtu.be`, or `music.youtube.com/watch` video link. The app embeds the matching video; it does not download or store the song.

## Project map

| File | Purpose |
| --- | --- |
| `index.html` | Registration and sign-in screen. |
| `journal.html` | Journal list, entry editor, mood, music, and photo controls. |
| `app.js` | Browser storage, session handling, entry operations, and media behavior. |
| `style.css` | Page layout, responsive behavior, and visual styling. |
| `README.md` | Setup, usage, architecture, privacy limits, and maintenance notes. |
| `docs/ARCHITECTURE.md` | Detailed code guide, storage flow, function map, and current limitations. |

## Data model and persistence

The app creates an IndexedDB database named `VibeJournalDB` (currently schema version 1):

- `users` records are keyed by username and contain the password verifier and creation time.
- `entries` records are keyed by an entry ID and indexed by username. They contain the encrypted title, body, mood, and music metadata, plus a plain date and timestamps.
- `photos` records are keyed by photo ID and indexed by entry ID and username. Image bytes are stored separately from entry text.
- A small session record is kept in `localStorage` so a reload can restore the current account.

The data belongs to that browser profile and origin. Clearing site data, using another browser/device, or changing the origin can make it unavailable. There is currently no export/import, cloud backup, synchronization, password reset, or account recovery. Do not use this prototype as the only copy of important writing.

## Privacy and security

This is a front-end-only prototype, not a secure multi-user service. Accounts exist only in this browser; the app has no server, server-side authentication, access control, or recovery process. The current password verifier and reversible XOR-based content/photo transformation are homemade and are **not cryptographic protection**. The session also stores its content key in local storage. Anyone with access to the browser profile or page script can access the data. Treat entries as readable by someone who can use the same browser profile, and do not put highly sensitive material here.

For a public blogging product or real private journal, replace this prototype storage/authentication layer with a server-backed design, vetted password hashing, authenticated encryption and key management, account recovery, backups, and explicit publish/privacy controls. Public sharing and cross-device sync are not implemented.

## Browser requirements and troubleshooting

- Use a current browser with IndexedDB, local storage, and JavaScript enabled.
- If the app cannot open the database, check private browsing restrictions and browser storage settings.
- Camera access requires a permission grant and usually `localhost` or HTTPS. Photo upload works without camera access.
- Embedded YouTube playback depends on network access and the video's embed settings.
- Data is stored per browser origin. `file://` and `http://localhost:8000` may have separate storage; use the same address each time.

## Attribution

Vibe Journal began as a vibe-coding practice project. The original project owner supplied the project and product direction; AI assistance helped review, document, and improve the code. This repository should retain accurate authorship and commit attribution rather than claiming work by someone who did not create it.
