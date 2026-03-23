const AI_ENDPOINT = 'https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-ai';
const SUPABASE_ANON_KEY = 'sb_publishable_X2hZ6bXgj5HHSSZQPiXYsw_mhF5NHpy';

const STORAGE_KEYS = {
  theme: 'omnia_theme',
  fontSize: 'omnia_font_size',
  readingState: 'omnia_reading_state'
};

let currentFontSize = 22;
let currentThemeCycle = ['dark', 'default', 'purple', 'red'];
let currentThemeIndex = 0;

let selectedFragment = '';
let sections = [];
let currentSectionIndex = 0;
let currentBookTitle = 'Omnia';
let currentBookSource = null;
let overlayVisible = true;

let touchStartX = 0;
let touchEndX = 0;

const searchInput = document.getElementById('searchInput');
const languageSelect = document.getElementById('languageSelect');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');

const homeView = document.getElementById('homeView');
const readerView = document.getElementById('readerView');

const chapterLineEl = document.getElementById('chapterLine');
const remainingLineEl = document.getElementById('remainingLine');
const viewerEl = document.getElementById('viewer');

const readerOverlayEl = document.getElementById('readerOverlay');
const backToLibraryBtn = document.getElementById('backToLibraryBtn');
const fontMinusBtn = document.getElementById('fontMinusBtn');
const fontPlusBtn = document.getElementById('fontPlusBtn');
const readerThemeBtn = document.getElementById('readerThemeBtn');

const themeDefaultBtn = document.getElementById('themeDefaultBtn');
const themeDarkBtn = document.getElementById('themeDarkBtn');
const themePurpleBtn = document.getElementById('themePurpleBtn');
const themeRedBtn = document.getElementById('themeRedBtn');

const leftTapZone = document.getElementById('leftTapZone');
const centerTapZone = document.getElementById('centerTapZone');
const rightTapZone = document.getElementById('rightTapZone');

const toolbar = document.getElementById('selectionToolbar');
const toolbarTranslateBtn = document.getElementById('toolbarTranslateBtn');
const toolbarExplainBtn = document.getElementById('toolbarExplainBtn');
const toolbarSaveBtn = document.getElementById('toolbarSaveBtn');

const sheetBackdrop = document.getElementById('sheetBackdrop');
const actionSheet = document.getElementById('actionSheet');
const closeActionSheetBtn = document.getElementById('closeActionSheetBtn');
const selectedTextBoxEl = document.getElementById('selectedTextBox');
const translateBtn = document.getElementById('translateBtn');
const explainBtn = document.getElementById('explainBtn');
const saveBtn = document.getElementById('saveBtn');
const actionResultEl = document.getElementById('actionResult');

searchBtn.addEventListener('click', searchBooks);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchBooks();
});

themeDefaultBtn.addEventListener('click', () => setTheme('default', true));
themeDarkBtn.addEventListener('click', () => setTheme('dark', true));
themePurpleBtn.addEventListener('click', () => setTheme('purple', true));
themeRedBtn.addEventListener('click', () => setTheme('red', true));

backToLibraryBtn.addEventListener('click', returnToLibrary);
fontMinusBtn.addEventListener('click', () => changeFontSize(-2));
fontPlusBtn.addEventListener('click', () => changeFontSize(2));
readerThemeBtn.addEventListener('click', cycleReaderTheme);

leftTapZone.addEventListener('click', prevSection);
rightTapZone.addEventListener('click', nextSection);
centerTapZone.addEventListener('click', toggleOverlay);

viewerEl.addEventListener('mouseup', handleSelection);
viewerEl.addEventListener('touchend', () => {
  setTimeout(handleSelection, 50);
  handleSwipeEnd();
});

viewerEl.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
});

viewerEl.addEventListener('touchmove', (e) => {
  touchEndX = e.changedTouches[0].screenX;
});

toolbarTranslateBtn.addEventListener('click', () => {
  hideToolbar();
  openActionSheet(selectedFragment);
  translateSelection();
});

toolbarExplainBtn.addEventListener('click', () => {
  hideToolbar();
  openActionSheet(selectedFragment);
  explainSelection();
});

toolbarSaveBtn.addEventListener('click', () => {
  hideToolbar();
  openActionSheet(selectedFragment);
  saveSelection();
});

closeActionSheetBtn.addEventListener('click', closeActionSheet);
sheetBackdrop.addEventListener('click', closeActionSheet);

translateBtn.addEventListener('click', translateSelection);
explainBtn.addEventListener('click', explainSelection);
saveBtn.addEventListener('click', saveSelection);

document.addEventListener('click', (e) => {
  if (!toolbar.contains(e.target)) {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.toString().trim() === '') {
        hideToolbar();
      }
    }, 20);
  }
});

document.addEventListener('keydown', (e) => {
  if (readerView.classList.contains('hidden')) return;

  if (e.key === 'ArrowLeft') prevSection();
  if (e.key === 'ArrowRight') nextSection();
  if (e.key === 'Escape') closeActionSheet();
});

function saveTheme() {
  localStorage.setItem(STORAGE_KEYS.theme, currentThemeCycle[currentThemeIndex]);
}

function saveFontSize() {
  localStorage.setItem(STORAGE_KEYS.fontSize, String(currentFontSize));
}

function saveReadingState() {
  if (!currentBookSource || !sections.length) return;

  const payload = {
    bookTitle: currentBookTitle,
    bookSource: currentBookSource,
    currentSectionIndex,
    savedAt: Date.now()
  };

  localStorage.setItem(STORAGE_KEYS.readingState, JSON.stringify(payload));
}

function loadTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  if (savedTheme && currentThemeCycle.includes(savedTheme)) {
    setTheme(savedTheme, false);
  } else {
    setTheme('dark', false);
  }
}

function loadFontSize() {
  const saved = localStorage.getItem(STORAGE_KEYS.fontSize);
  if (!saved) return;

  const parsed = Number(saved);
  if (!Number.isNaN(parsed) && parsed >= 16 && parsed <= 34) {
    currentFontSize = parsed;
  }
}

function loadReadingState() {
  const raw = localStorage.getItem(STORAGE_KEYS.readingState);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setTheme(theme, shouldSave = true) {
  document.body.className = theme === 'default' ? '' : `theme-${theme}`;
  const idx = currentThemeCycle.indexOf(theme);
  if (idx >= 0) currentThemeIndex = idx;
  if (shouldSave) saveTheme();
}

function cycleReaderTheme() {
  currentThemeIndex = (currentThemeIndex + 1) % currentThemeCycle.length;
  setTheme(currentThemeCycle[currentThemeIndex], true);
}

function changeFontSize(delta) {
  currentFontSize += delta;
  if (currentFontSize < 16) currentFontSize = 16;
  if (currentFontSize > 34) currentFontSize = 34;
  applyReaderStyles();
  saveFontSize();
}

function applyReaderStyles() {
  viewerEl.style.fontSize = `${currentFontSize}px`;
}

function enterReaderMode() {
  homeView.classList.add('hidden');
  readerView.classList.remove('hidden');
  overlayVisible = true;
  readerOverlayEl.classList.add('visible');
  hideToolbar();
  closeActionSheet();
}

function returnToLibrary() {
  readerView.classList.add('hidden');
  homeView.classList.remove('hidden');
  hideToolbar();
  closeActionSheet();
  saveReadingState();
}

function toggleOverlay() {
  overlayVisible = !overlayVisible;
  readerOverlayEl.classList.toggle('visible', overlayVisible);
}

function openActionSheet(text) {
  if (!text || !text.trim()) return;
  selectedFragment = text.trim();
  selectedTextBoxEl.textContent = selectedFragment;
  actionResultEl.textContent = 'Выбери действие.';
  actionSheet.classList.remove('hidden');
  sheetBackdrop.classList.remove('hidden');
}

function closeActionSheet() {
  actionSheet.classList.add('hidden');
  sheetBackdrop.classList.add('hidden');
}

function hideToolbar() {
  toolbar.style.display = 'none';
}

function showToolbar(x, y) {
  toolbar.style.left = `${x}px`;
  toolbar.style.top = `${y}px`;
  toolbar.style.display = 'flex';
}

function handleSelection() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (!text) {
    hideToolbar();
    return;
  }

  selectedFragment = text;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  let x = rect.left + window.scrollX;
  let y = rect.top + window.scrollY - 50;

  if (y < 10) y = rect.bottom + window.scrollY + 10;

  showToolbar(x, y);
}

function handleSwipeEnd() {
  if (!touchStartX || !touchEndX) return;

  const delta = touchEndX - touchStartX;

  if (Math.abs(delta) > 60) {
    if (delta < 0) nextSection();
    else prevSection();
  }

  touchStartX = 0;
  touchEndX = 0;
}

async function callAI(action, text, targetLanguage = 'Russian') {
  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      action,
      text,
      targetLanguage
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(data);
    throw new Error(data?.error || 'AI error');
  }

  return data.result || data.response || JSON.stringify(data);
}

function getTargetLanguageName() {
  const langCode = languageSelect.value || 'ru';

  const languageMap = {
    ru: 'Russian',
    en: 'English',
    de: 'German',
    fr: 'French',
    it: 'Italian',
    es: 'Spanish',
    pt: 'Portuguese',
    zh: 'Chinese',
    la: 'Latin'
  };

  return languageMap[langCode] || 'Russian';
}

async function translateSelection() {
  if (!selectedFragment) return;

  actionResultEl.textContent = 'Перевожу...';

  try {
    const targetLanguage = getTargetLanguageName();
    const result = await callAI('translate', selectedFragment, targetLanguage);
    actionResultEl.textContent = result;
  } catch (error) {
    console.error(error);
    actionResultEl.textContent = 'Ошибка перевода.\n\n' + error.message;
  }
}

async function explainSelection() {
  if (!selectedFragment) return;

  actionResultEl.textContent = 'Объясняю...';

  try {
    const result = await callAI('explain', selectedFragment, 'Russian');
    actionResultEl.textContent = result;
  } catch (error) {
    console.error(error);
    actionResultEl.textContent = 'Ошибка объяснения.\n\n' + error.message;
  }
}

function saveSelection() {
  if (!selectedFragment) return;
  actionResultEl.textContent = 'Фрагмент сохранён в тестовом режиме.';
}

function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function searchBooks() {
  const query = searchInput.value.trim();
  const lang = languageSelect.value.trim();

  if (!query) {
    resultsEl.innerHTML = `
      <div class="book-card">
        <div class="book-title">Пустой запрос</div>
        <div class="book-meta">Введи автора или название книги.</div>
      </div>
    `;
    addLocalBookButton();
    return;
  }

  resultsEl.innerHTML = `
    <div class="book-card">
      <div class="book-title">Ищу книги…</div>
      <div class="book-meta">Подожди пару секунд.</div>
    </div>
  `;

  let url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  if (lang) url += `&languages=${encodeURIComponent(lang)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const books = data.results || [];

    if (!books.length) {
      resultsEl.innerHTML = `
        <div class="book-card">
          <div class="book-title">Ничего не найдено</div>
          <div class="book-meta">Попробуй другой запрос.</div>
        </div>
      `;
      addLocalBookButton();
      return;
    }

    renderResults(books.slice(0, 18));
    addLocalBookButton();
  } catch (error) {
    console.error(error);
    resultsEl.innerHTML = `
      <div class="book-card">
        <div class="book-title">Ошибка</div>
        <div class="book-meta">Не удалось загрузить библиотеку.</div>
      </div>
    `;
    addLocalBookButton();
  }
}

function renderResults(books) {
  resultsEl.innerHTML = '';

  books.forEach((item) => {
    const title = item.title || 'Без названия';
    const authors = (item.authors || []).map(a => a.name).join(', ') || 'Автор неизвестен';
    const languages = (item.languages || []).join(', ') || '—';
    const downloads = item.download_count || 0;

    const htmlUrl =
      item.formats['text/html'] ||
      item.formats['text/html; charset=utf-8'];

    const textUrl =
      item.formats['text/plain; charset=utf-8'] ||
      item.formats['text/plain'];

    const card = document.createElement('div');
    card.className = 'book-card';

    card.innerHTML = `
      <div class="book-title">${escapeHtml(title)}</div>
      <div class="book-meta">
        ${escapeHtml(authors)}<br>
        Язык: ${escapeHtml(languages)}<br>
        Скачиваний: ${downloads}
      </div>
      <div class="book-actions">
        ${htmlUrl ? `<button data-external="${encodeURIComponent(htmlUrl)}">Открыть в интернете</button>` : ''}
        ${textUrl ? `<button data-text="${encodeURIComponent(textUrl)}" data-title="${escapeHtml(title)}">Открыть TXT</button>` : ''}
      </div>
    `;

    resultsEl.appendChild(card);

    const textBtn = card.querySelector('[data-text]');
    if (textBtn) {
      textBtn.addEventListener('click', () => {
        openExternalTextBook(
          decodeURIComponent(textBtn.dataset.text),
          textBtn.dataset.title,
          0,
          true
        );
      });
    }

    const externalBtn = card.querySelector('[data-external]');
    if (externalBtn) {
      externalBtn.addEventListener('click', () => {
        window.open(decodeURIComponent(externalBtn.dataset.external), '_blank', 'noopener,noreferrer');
      });
    }
  });
}

function addLocalBookButton() {
  if (document.getElementById('openLocalBookBtn')) return;

  const card = document.createElement('div');
  card.className = 'book-card';

  card.innerHTML = `
    <div class="book-title">Моя книга</div>
    <div class="book-meta">
      Nietzsche — The Antichrist<br>
      Локальный файл Omnia
    </div>
    <div class="book-actions">
      <button id="openLocalBookBtn">Открыть</button>
    </div>
  `;

  resultsEl.prepend(card);
  document.getElementById('openLocalBookBtn').addEventListener('click', () => {
    openLocalBook(0, true);
  });
}

async function openLocalBook(savedIndex = 0, enterMode = true) {
  try {
    const response = await fetch('books/antichrist.txt');
    const text = await response.text();

    if (!text || text.length < 100) {
      throw new Error('Файл пустой или не загрузился');
    }

    currentBookTitle = 'The Antichrist';
    currentBookSource = {
      type: 'local',
      path: 'books/antichrist.txt'
    };

    sections = splitIntoSections(text, 12000);
    currentSectionIndex = clampSectionIndex(savedIndex);

    if (enterMode) enterReaderMode();
    renderCurrentSection();
    saveReadingState();
  } catch (error) {
    console.error(error);
    alert('Ошибка загрузки локальной книги: ' + error.message);
  }
}

async function openExternalTextBook(url, title, savedIndex = 0, enterMode = true) {
  try {
    const response = await fetch(`https://cors.isomorphic-git.org/${url}`);
    const text = await response.text();

    if (!text || text.length < 100) {
      throw new Error('Текст не загрузился');
    }

    currentBookTitle = title;
    currentBookSource = {
      type: 'external-text',
      url,
      title
    };

    sections = splitIntoSections(text, 12000);
    currentSectionIndex = clampSectionIndex(savedIndex);

    if (enterMode) enterReaderMode();
    renderCurrentSection();
    saveReadingState();
  } catch (error) {
    console.error(error);
    alert('Ошибка загрузки книги: ' + error.message);
  }
}

function clampSectionIndex(index) {
  if (!sections.length) return 0;
  if (index < 0) return 0;
  if (index > sections.length - 1) return sections.length - 1;
  return index;
}

function splitIntoSections(text, maxLength = 12000) {
  const cleaned = text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = cleaned.split(/\n\s*\n/);
  const result = [];
  let current = '';

  for (const p of paragraphs) {
    const block = p.trim();
    if (!block) continue;

    if ((current + '\n\n' + block).length > maxLength) {
      if (current.trim()) result.push(current.trim());
      current = block;
    } else {
      current += (current ? '\n\n' : '') + block;
    }
  }

  if (current.trim()) result.push(current.trim());

  return result.length ? result : [cleaned];
}

function getCurrentChapterLabel(sectionText, index) {
  const lines = sectionText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const first = lines[0] || '';
  const shortFirst = first.slice(0, 60);

  if (/^chapter\b/i.test(first)) return shortFirst;
  if (/^(глава|часть)\b/i.test(first)) return shortFirst;
  if (/^[IVXLCDM]+\b/.test(first)) return `Глава ${index + 1}`;

  return `Глава ${index + 1}`;
}

function renderCurrentSection() {
  if (!sections.length) {
    viewerEl.textContent = '';
    return;
  }

  const text = sections[currentSectionIndex];
  const paragraphs = text.split(/\n\s*\n/);

  viewerEl.innerHTML = paragraphs
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('');

  applyReaderStyles();

  chapterLineEl.textContent = getCurrentChapterLabel(text, currentSectionIndex);

  const remaining = Math.max(sections.length - currentSectionIndex - 1, 0);
  remainingLineEl.textContent = `До конца главы: ${remaining} стр.`;

  viewerEl.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  saveReadingState();
}

function prevSection() {
  if (!sections.length || currentSectionIndex <= 0) return;
  currentSectionIndex -= 1;
  renderCurrentSection();
}

function nextSection() {
  if (!sections.length || currentSectionIndex >= sections.length - 1) return;
  currentSectionIndex += 1;
  renderCurrentSection();
}

async function restoreReadingSession() {
  const savedState = loadReadingState();
  if (!savedState || !savedState.bookSource) return;

  try {
    if (savedState.bookSource.type === 'local') {
      await openLocalBook(savedState.currentSectionIndex || 0, true);
      return;
    }

    if (savedState.bookSource.type === 'external-text') {
      await openExternalTextBook(
        savedState.bookSource.url,
        savedState.bookSource.title || savedState.bookTitle || 'Книга',
        savedState.currentSectionIndex || 0,
        true
      );
    }
  } catch (error) {
    console.error('Restore failed:', error);
  }
}

window.addEventListener('load', async () => {
  loadFontSize();
  loadTheme();
  applyReaderStyles();

  searchInput.value = 'Nietzsche';
  searchBooks();

  await restoreReadingSession();
});
