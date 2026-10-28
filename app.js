const AUTH_KEY = 'vibe_journal_auth_v2';
const DB_NAME = 'VibeJournalDB';
const DB_VERSION = 1;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

let currentUser = null;
let currentEntryId = null;
let encryptionKey = null;
let currentMood = '';
let currentMusic = null;
let currentPhotos = [];
let cameraStream = null;

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

function strongHash(str) {
    let hash1 = 5381;
    let hash2 = 52711;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash1 = ((hash1 << 5) + hash1) ^ char;
        hash2 = ((hash2 << 5) + hash2) ^ char;
    }
    return (Math.abs(hash1).toString(16) + Math.abs(hash2).toString(16)).toUpperCase();
}

function encrypt(text, key) {
    if (!text) return '';
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        const keyChar = key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode ^ keyChar);
    }
    try {
        return btoa(unescape(encodeURIComponent(result)));
    } catch (e) {
        return '';
    }
}

function decrypt(encoded, key) {
    if (!encoded) return '';
    try {
        const text = decodeURIComponent(escape(atob(encoded)));
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const charCode = text.charCodeAt(i);
            const keyChar = key.charCodeAt(i % key.length);
            result += String.fromCharCode(charCode ^ keyChar);
        }
        return result;
    } catch (e) {
        return '';
    }
}

function encryptBuffer(arrayBuffer, key) {
    const bytes = new Uint8Array(arrayBuffer);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        const keyByte = key.charCodeAt(i % key.length);
        out[i] = bytes[i] ^ (keyByte & 0xff);
    }
    return out.buffer;
}

function decryptBuffer(arrayBuffer, key) {
    return encryptBuffer(arrayBuffer, key);
}

let dbPromise = null;
function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('users')) {
                db.createObjectStore('users', { keyPath: 'username' });
            }
            if (!db.objectStoreNames.contains('entries')) {
                const entriesStore = db.createObjectStore('entries', { keyPath: 'id' });
                entriesStore.createIndex('username', 'username', { unique: false });
            }
            if (!db.objectStoreNames.contains('photos')) {
                const photosStore = db.createObjectStore('photos', { keyPath: 'photoId' });
                photosStore.createIndex('entryId', 'entryId', { unique: false });
                photosStore.createIndex('username', 'username', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function getUsersDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('users', 'readonly');
        const store = tx.objectStore('users');
        const req = store.getAll();
        req.onsuccess = () => {
            const map = {};
            req.result.forEach(u => { map[u.username] = u; });
            resolve(map);
        };
        req.onerror = () => reject(req.error);
    });
}

async function getUserDB(username) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('users', 'readonly');
        const req = tx.objectStore('users').get(username);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function saveUserDB(user) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('users', 'readwrite');
        tx.objectStore('users').put(user);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getEntriesDB(username) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readonly');
        const idx = tx.objectStore('entries').index('username');
        const req = idx.getAll(IDBKeyRange.only(username));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function putEntryDB(entry) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite');
        tx.objectStore('entries').put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteEntryDB(entryId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['entries', 'photos'], 'readwrite');
        tx.objectStore('entries').delete(entryId);
        const photoIdx = tx.objectStore('photos').index('entryId');
        const req = photoIdx.openCursor(IDBKeyRange.only(entryId));
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function putPhotoDB(photoRecord) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(photoRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deletePhotosByEntryDB(entryId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        const idx = tx.objectStore('photos').index('entryId');
        const req = idx.openCursor(IDBKeyRange.only(entryId));
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getPhotosByEntryDB(entryId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readonly');
        const idx = tx.objectStore('photos').index('entryId');
        const req = idx.getAll(IDBKeyRange.only(entryId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function switchTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const errorMsg = document.getElementById('errorMsg');
    if (errorMsg) errorMsg.textContent = '';
    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        loginTab.classList.remove('active');
        registerTab.classList.add('active');
    }
}

function showError(msg) {
    const errorMsg = document.getElementById('errorMsg');
    if (errorMsg) {
        errorMsg.textContent = msg;
    } else {
        alert(msg);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;

    if (username.length < 3) { showError('Username must be at least 3 characters'); return; }
    if (password.length < 4) { showError('Password must be at least 4 characters'); return; }
    if (password !== confirm) { showError('Passwords do not match'); return; }

    try {
        const existing = await getUserDB(username);
        if (existing) { showError('Username already exists'); return; }

        await saveUserDB({
            username: username,
            passwordHash: strongHash(password),
            createdAt: new Date().toISOString()
        });

        alert('Account created! Please login.');
        switchTab('login');
    } catch (error) {
        console.error('Could not create account', error);
        showError('Could not save your account. Check that browser storage is available and try again.');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        const user = await getUserDB(username);
        if (!user) { showError('Username not found'); return; }
        if (user.passwordHash !== strongHash(password)) { showError('Incorrect password'); return; }

        const sessionKey = simpleHash(username + Date.now());
        encryptionKey = strongHash(password + username);
        localStorage.setItem(AUTH_KEY, JSON.stringify({
            username: username,
            sessionKey: sessionKey,
            encKey: encryptionKey
        }));
        window.location.href = 'journal.html';
    } catch (error) {
        console.error('Could not sign in', error);
        showError('Could not open your account. Check that browser storage is available and try again.');
    }
}

function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    currentUser = null;
    encryptionKey = null;
    closeCamera();
    window.location.href = 'index.html';
}

async function checkAuthAndLoad() {
    const auth = localStorage.getItem(AUTH_KEY);
    if (!auth) { window.location.href = 'index.html'; return; }
    let authData;
    try { authData = JSON.parse(auth); } catch (error) {
        localStorage.removeItem(AUTH_KEY);
        window.location.href = 'index.html';
        return;
    }
    if (!authData.username || !authData.encKey) {
        localStorage.removeItem(AUTH_KEY);
        window.location.href = 'index.html';
        return;
    }
    const user = await getUserDB(authData.username);
    if (!user) { handleLogout(); return; }

    currentUser = authData.username;
    encryptionKey = authData.encKey;

    const header = document.getElementById('welcomeHeader');
    if (header) header.textContent = currentUser.toUpperCase() + "'S DIARY";
    const dateEl = document.getElementById('entryDate');
    if (dateEl) dateEl.valueAsDate = new Date();

    await loadEntries();
    newEntry();
}

async function loadEntries() {
    const entriesList = document.getElementById('entriesContainer');
    if (!entriesList) return;
    entriesList.innerHTML = '';

    const entries = await getEntriesDB(currentUser);
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const entry of entries) {
        const item = document.createElement('div');
        item.className = 'entry-item';
        item.dataset.id = entry.id;
        item.onclick = () => selectEntry(entry.id);

        const titleRow = document.createElement('div');
        titleRow.className = 'entry-item-title';
        const moodSpan = document.createElement('span');
        moodSpan.textContent = decrypt(entry.mood, encryptionKey) || '';
        const titleText = document.createElement('span');
        titleText.textContent = entry.title ? decrypt(entry.title, encryptionKey) : '(Untitled)';
        titleRow.appendChild(moodSpan);
        titleRow.appendChild(titleText);

        const dateDiv = document.createElement('div');
        dateDiv.className = 'entry-item-date';
        dateDiv.textContent = entry.date;

        const previewDiv = document.createElement('div');
        previewDiv.className = 'entry-item-preview';
        const plain = decrypt(entry.content, encryptionKey);
        previewDiv.textContent = plain.substring(0, 50) + (plain.length > 50 ? '...' : '');
        item.dataset.search = [decrypt(entry.title, encryptionKey), plain, entry.date]
            .join(' ').toLocaleLowerCase();

        item.appendChild(titleRow);
        item.appendChild(dateDiv);
        item.appendChild(previewDiv);

        const media = document.createElement('div');
        media.className = 'entry-item-media';
        let hasMedia = false;
        let music = null;
        try { music = JSON.parse(decrypt(entry.music, encryptionKey) || 'null'); } catch (error) { /* Skip malformed metadata. */ }
        if (music && music.videoId) {
            const m = document.createElement('span');
            m.textContent = '🎵';
            m.title = 'Has song of the day';
            media.appendChild(m);
            hasMedia = true;
        }
        const photos = await getPhotosByEntryDB(entry.id);
        if (photos.length > 0) {
            const count = document.createElement('span');
            count.textContent = '🖼️ x' + photos.length;
            media.appendChild(count);
            const firstBlob = new Blob([decryptBuffer(photos[0].data, encryptionKey)], { type: photos[0].type });
            const url = URL.createObjectURL(firstBlob);
            const thumb = document.createElement('img');
            thumb.className = 'entry-item-thumb';
            thumb.src = url;
            thumb.onload = () => setTimeout(() => URL.revokeObjectURL(url), 2000);
            media.appendChild(thumb);
            hasMedia = true;
        }
        if (hasMedia) item.appendChild(media);

        entriesList.appendChild(item);
    }
    filterEntries();
}

function filterEntries() {
    const input = document.getElementById('entrySearch');
    const query = input ? input.value.trim().toLocaleLowerCase() : '';
    document.querySelectorAll('.entry-item').forEach(item => {
        item.classList.toggle('hidden', Boolean(query) && !item.dataset.search.includes(query));
    });
}

function setMood(mood) {
    currentMood = mood;
    const display = document.getElementById('selectedMood');
    if (display) display.textContent = mood;
    document.querySelectorAll('.mood-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.mood === mood);
    });
}

function extractYoutubeVideoId(url) {
    if (!url) return null;
    url = url.trim();
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|music\.youtube\.com\/watch\?v=)([A-Za-z0-9_-]{6,})/,
        /[?&]v=([A-Za-z0-9_-]{6,})/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function parseMusicLink() {
    const input = document.getElementById('musicLink');
    const url = input.value.trim();
    if (!url) return;
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
        alert('Could not find a YouTube video ID in that link. Try pasting a youtube.com or music.youtube.com link.');
        return;
    }
    currentMusic = { videoId: videoId, rawUrl: url };
    renderMusicEmbed();
    input.value = '';
}

function renderMusicEmbed() {
    const container = document.getElementById('musicEmbed');
    if (!currentMusic) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = `
        <button class="music-remove" onclick="removeMusic()" title="Remove song">×</button>
        <iframe
            src="https://www.youtube.com/embed/${currentMusic.videoId}"
            title="YouTube video player"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen>
        </iframe>
    `;
}

function removeMusic() {
    currentMusic = null;
    renderMusicEmbed();
}

async function handlePhotoUpload(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            alert(`${file.name} is not an image and was skipped.`);
            continue;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            alert(`${file.name} is larger than 8 MB and was skipped.`);
            continue;
        }
        try {
            const dataUrl = await blobToDataURL(file);
            addPhotoFromDataUrl(dataUrl, file.type || 'image/jpeg');
        } catch (error) {
            console.error('Could not read image', error);
            alert(`Could not read ${file.name}.`);
        }
    }
    e.target.value = '';
}

function addPhotoFromDataUrl(dataUrl, type) {
    const id = 'ph_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    currentPhotos.push({
        photoId: id,
        dataUrl: dataUrl,
        type: type || 'image/jpeg',
        isNew: true
    });
    renderPhotoGallery();
}

function renderPhotoGallery() {
    const gallery = document.getElementById('photoGallery');
    if (!gallery) return;
    gallery.innerHTML = '';
    currentPhotos.forEach(photo => {
        const item = document.createElement('div');
        item.className = 'photo-item';

        const img = document.createElement('img');
        img.src = photo.dataUrl;
        img.alt = 'journal photo';
        item.appendChild(img);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'photo-remove';
        removeBtn.title = 'Remove photo';
        removeBtn.textContent = '×';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removePhoto(photo.photoId);
        };
        item.appendChild(removeBtn);

        const dlBtn = document.createElement('a');
        dlBtn.className = 'photo-download';
        dlBtn.href = photo.dataUrl;
        dlBtn.download = 'photo_' + photo.photoId + '.jpg';
        dlBtn.title = 'Download photo';
        dlBtn.textContent = '↓';
        item.appendChild(dlBtn);

        gallery.appendChild(item);
    });
}

function removePhoto(photoId) {
    currentPhotos = currentPhotos.filter(p => p.photoId !== photoId);
    renderPhotoGallery();
}

async function openCamera() {
    const area = document.getElementById('cameraArea');
    const closeBtn = document.getElementById('closeCameraBtn');
    const video = document.getElementById('cameraVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support camera access (or you need to visit via https:// or localhost).');
        return;
    }
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = cameraStream;
        area.classList.remove('hidden');
        closeBtn.classList.remove('hidden');
    } catch (err) {
        alert('Could not access camera: ' + err.message + '\nPlease allow camera permission and try again.');
    }
}

function closeCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    const video = document.getElementById('cameraVideo');
    if (video) video.srcObject = null;
    const area = document.getElementById('cameraArea');
    if (area) area.classList.add('hidden');
    const closeBtn = document.getElementById('closeCameraBtn');
    if (closeBtn) closeBtn.classList.add('hidden');
}

function snapPhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    if (!video || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    addPhotoFromDataUrl(dataUrl, 'image/jpeg');
}

function newEntry() {
    currentEntryId = null;
    currentMood = '';
    currentMusic = null;
    currentPhotos = [];

    const titleEl = document.getElementById('editorTitle');
    if (titleEl) titleEl.textContent = 'New Page';
    const entryTitle = document.getElementById('entryTitle');
    if (entryTitle) entryTitle.value = '';
    const dateEl = document.getElementById('entryDate');
    if (dateEl) dateEl.valueAsDate = new Date();
    const contentEl = document.getElementById('entryContent');
    if (contentEl) contentEl.value = '';
    const delBtn = document.getElementById('deleteBtn');
    if (delBtn) delBtn.classList.add('hidden');
    const moodDisplay = document.getElementById('selectedMood');
    if (moodDisplay) moodDisplay.textContent = '';
    document.querySelectorAll('.mood-btn').forEach(btn => btn.classList.remove('selected'));
    renderMusicEmbed();
    renderPhotoGallery();

    document.querySelectorAll('.entry-item').forEach(item => item.classList.remove('selected'));
}

async function selectEntry(id) {
    const entries = await getEntriesDB(currentUser);
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    currentEntryId = id;
    const titleEl = document.getElementById('editorTitle');
    if (titleEl) titleEl.textContent = 'Edit Page';
    document.getElementById('entryTitle').value = decrypt(entry.title, encryptionKey);
    document.getElementById('entryDate').value = entry.date;
    document.getElementById('entryContent').value = decrypt(entry.content, encryptionKey);
    document.getElementById('deleteBtn').classList.remove('hidden');

    const mood = decrypt(entry.mood, encryptionKey);
    setMood(mood || '');

    const musicStr = decrypt(entry.music, encryptionKey);
    try { currentMusic = musicStr ? JSON.parse(musicStr) : null; } catch (error) { currentMusic = null; }
    renderMusicEmbed();

    const photos = await getPhotosByEntryDB(id);
    currentPhotos = [];
    for (const p of photos) {
        const blob = new Blob([decryptBuffer(p.data, encryptionKey)], { type: p.type });
        const dataUrl = await blobToDataURL(blob);
        currentPhotos.push({
            photoId: p.photoId,
            dataUrl: dataUrl,
            type: p.type,
            isNew: false
        });
    }
    renderPhotoGallery();

    document.querySelectorAll('.entry-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.id === id);
    });
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

function dataUrlToBlob(dataUrl) {
    const [header, body] = dataUrl.split(',');
    const mimeType = (header.match(/data:(.+);base64/) || [, 'image/jpeg'])[1];
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes.buffer], { type: mimeType });
}

async function saveEntry() {
    const title = document.getElementById('entryTitle').value.trim();
    const date = document.getElementById('entryDate').value;
    const content = document.getElementById('entryContent').value;

    if (!date) {
        alert('Please choose a date for this page.');
        document.getElementById('entryDate').focus();
        return;
    }

    if (!content.trim() && !title && !currentMood && !currentMusic && currentPhotos.length === 0) {
        alert('Please write something, pick a mood, attach a song, or add some photos.');
        return;
    }

    let entryId = currentEntryId;
    let createdAt = null;

    if (entryId) {
        const entries = await getEntriesDB(currentUser);
        const existing = entries.find(e => e.id === entryId);
        if (existing) createdAt = existing.createdAt;
        await deletePhotosByEntryDB(entryId);
    } else {
        entryId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
        createdAt = new Date().toISOString();
    }

    const entry = {
        id: entryId,
        username: currentUser,
        title: encrypt(title, encryptionKey),
        date: date,
        content: encrypt(content, encryptionKey),
        mood: encrypt(currentMood, encryptionKey),
        music: encrypt(JSON.stringify(currentMusic || null), encryptionKey),
        createdAt: createdAt,
        updatedAt: new Date().toISOString()
    };
    await putEntryDB(entry);

    for (const photo of currentPhotos) {
        const blob = dataUrlToBlob(photo.dataUrl);
        const arrayBuffer = await blob.arrayBuffer();
        const encryptedData = encryptBuffer(arrayBuffer, encryptionKey);
        await putPhotoDB({
            photoId: photo.photoId,
            entryId: entryId,
            username: currentUser,
            type: photo.type || blob.type || 'image/jpeg',
            size: encryptedData.byteLength,
            data: encryptedData
        });
    }

    currentEntryId = entryId;
    const titleEl = document.getElementById('editorTitle');
    if (titleEl) titleEl.textContent = 'Edit Page';
    document.getElementById('deleteBtn').classList.remove('hidden');

    await loadEntries();
    const item = document.querySelector(`.entry-item[data-id="${entryId}"]`);
    if (item) item.classList.add('selected');

    alert('Page saved! 💾');
}

async function deleteEntry() {
    if (!currentEntryId) return;
    if (!confirm('Are you sure you want to delete this page? This will also remove its photos.')) return;
    await deleteEntryDB(currentEntryId);
    newEntry();
    await loadEntries();
}
