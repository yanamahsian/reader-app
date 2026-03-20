let currentFontSize = 22;
let currentTheme = 'dark';
let selectedFragment = '';

const AI_ENDPOINT = 'https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-ai';
const CORS_PROXY = 'https://cors.isomorphic-git.org/';

let sections = [];
let currentSectionIndex = 0;

const searchInput = document.getElementById('searchInput');
const languageSelect = document.getElementById('languageSelect');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');

const bookTitleEl = document.getElementById('bookTitle');
const statusTextEl = document.getElementById('statusText');
const emptyStateEl = document.getElementById('emptyState');
const readerFrameEl = document.getElementById('readerFrame');
const viewerEl = document.getElementById('viewer');

const actionPanelEl = document.getElementById('actionPanel');
const selectedTextBoxEl = document.getElementById('selectedTextBox');
const actionResultEl = document.getElementById('actionResult');

const closeActionPanelBtn = document.getElementById('closeActionPanelBtn');
const translateBtn = document.getElementById('translateBtn');
const explainBtn = document.getElementById('explainBtn');
const saveBtn = document.getElementById('saveBtn');

const prevSectionBtn = document.getElementById('prevSectionBtn');
const nextSectionBtn = document.getElementById('nextSectionBtn');
const fontMinusBtn = document.getElementById('fontMinusBtn');
const fontPlusBtn = document.getElementById('fontPlusBtn');

const themeDefaultBtn = document.getElementById('themeDefaultBtn');
const themeDarkBtn = document.getElementById('themeDarkBtn');
const themePurpleBtn = document.getElementById('themePurpleBtn');
const themeRedBtn = document.getElementById('themeRedBtn');

const toolbar = document.createElement('div');
toolbar.className = 'selection-toolbar';
toolbar.innerHTML = `
  <button id="toolbarTranslateBtn">Перевести</button>
  <button id="toolbarExplainBtn">Объяснить</button>
  <button id="toolbarSaveBtn">Сохранить</button>
`;
document.body.appendChild(toolbar);

const toolbarTranslateBtn = document.getElementById('toolbarTranslateBtn');
const toolbarExplainBtn = document.getElementById('toolbarExplainBtn');
const toolbarSaveBtn = document.getElementById('toolbarSaveBtn');

searchBtn.addEventListener('click', searchBooks);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchBooks();
});

fontMinusBtn.addEventListener('click', () => changeFontSize(-2));
fontPlusBtn.addEventListener('click', () => changeFontSize(2));

themeDefaultBtn.addEventListener('click', () => setTheme('default'));
themeDarkBtn.addEventListener('click', () => setTheme('dark'));
themePurpleBtn.addEventListener('click', () => setTheme('purple'));
themeRedBtn.addEventListener('click', () => setTheme('red'));

closeActionPanelBtn.addEventListener('click', closeActionPanel);
translateBtn.addEventListener('click', translateSelection);
explainBtn.addEventListener('click', explainSelection);
saveBtn.addEventListener('click', saveSelection);

toolbarTranslateBtn.addEventListener('click', () => {
  hideToolbar();
  openActionPanel(selectedFragment);
  translateSelection();
});

toolbarExplainBtn.addEventListener('click', () => {
  hideToolbar();
  openActionPanel(selectedFragment);
  explainSelection();
});

toolbarSaveBtn.addEventListener('click', () => {
  hideToolbar();
  openActionPanel(selectedFragment);
  saveSelection();
});

prevSectionBtn.addEventListener('click', prevSection);
nextSectionBtn.addEventListener('click', nextSection);

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') prevSection();
  if (e.key === 'ArrowRight') nextSection();
});

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

viewerEl.addEventListener('mouseup', handleSelection);
viewerEl.addEventListener('touchend', () => setTimeout(handleSelection, 50));

function setTheme(theme) {
  document.body.className = theme === 'default' ? '' : `theme-${theme}`;
  currentTheme = theme;
  applyReaderStyles();
}

function changeFontSize(delta) {
  currentFontSize += delta;
  if (currentFontSize < 16) currentFontSize = 16;
  if (currentFontSize > 34) currentFontSize = 34;
  applyReaderStyles();
}

function applyReaderStyles() {
  viewerEl.style.fontSize = `${currentFontSize}px`;
}

function closeActionPanel() {
  actionPanelEl.classList.remove('active');
}

function openActionPanel(text) {
  if (!text || !text.trim()) return;
  selectedFragment = text.trim();
  selectedTextBoxEl.textContent = selectedFragment;
  actionResultEl.textContent = 'Выбери действие: перевести, объяснить или сохранить.';
  actionPanelEl.classList.add('active');
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

  if (y < 10) {
    y = rect.bottom + window.scrollY + 10;
  }

  showToolbar(x, y);
}

  selectedFragment = text;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  let x = rect.left + window.scrollX;
  let y = rect.top + window.scrollY - 48;

  if (y < 10) y = rect.bottom + window.scrollY + 10;

  showToolbar(x, y);
}

async function callAI(action, text, targetLanguage = 'Russian') {
  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action,
      text,
      targetLanguage
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('AI error response:', data);
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : JSON.stringify(data?.error || data || 'Unknown AI error')
    );
  }

  return data.result || 'Пустой ответ.';
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
    actionResultEl.textContent =
      'Ошибка перевода.\n\n' + error.message;
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
    actionResultEl.textContent =
      'Ошибка объяснения.\n\n' + error.message;
  }
}

function saveSelection() {
  if (!selectedFragment) return;
  actionResultEl.textContent =
    'Фрагмент сохранён в тестовом режиме. Следующим шагом подключим реальные заметки и цитаты.';
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
      return;
    }

    renderResults(books.slice(0, 18));
  } catch (error) {
    console.error(error);
    resultsEl.innerHTML = `
      <div class="book-card">
        <div class="book-title">Ошибка</div>
        <div class="book-meta">Не удалось загрузить библиотеку.</div>
      </div>
    `;
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
        ${htmlUrl ? `<button data-open-html="${encodeURIComponent(htmlUrl)}" data-title="${escapeHtml(title)}">Открыть в Omnia</button>` : ''}
        ${textUrl ? `<button data-open-text="${encodeURIComponent(textUrl)}" data-title="${escapeHtml(title)}">Открыть TXT</button>` : ''}
        ${htmlUrl ? `<button data-external="${encodeURIComponent(htmlUrl)}">Открыть в интернете</button>` : ''}
      </div>
    `;

    resultsEl.appendChild(card);

    const openHtmlBtn = card.querySelector('[data-open-html]');
    if (openHtmlBtn) {
      openHtmlBtn.addEventListener('click', () => {
        openBookContent(decodeURIComponent(openHtmlBtn.dataset.openHtml), openHtmlBtn.dataset.title, 'html');
      });
    }

    const openTextBtn = card.querySelector('[data-open-text]');
    if (openTextBtn) {
      openTextBtn.addEventListener('click', () => {
        openBookContent(decodeURIComponent(openTextBtn.dataset.openText), openTextBtn.dataset.title, 'text');
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

async function openBookContent(url, title, type) {
  emptyStateEl.style.display = 'none';
  readerFrameEl.style.display = 'block';
  bookTitleEl.textContent = title;
  statusTextEl.textContent = 'Загружаю книгу...';
  viewerEl.innerHTML = '';
  hideToolbar();
  closeActionPanel();

  try {
    const response = await fetch(CORS_PROXY + url);
    const raw = await response.text();

    if (!raw || raw.trim().length < 20) {
      throw new Error('Пустой текст книги');
    }

    let cleanText = '';

    if (type === 'html') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      cleanText = extractReadableText(doc.body || doc);
    } else {
      cleanText = raw;
    }

    cleanText = normalizeText(cleanText);

    if (!cleanText || cleanText.length < 100) {
      throw new Error('Не удалось извлечь читаемый текст');
    }

    sections = splitIntoSections(cleanText, 12000);
    currentSectionIndex = 0;
    renderCurrentSection();

    statusTextEl.textContent = `Книга открыта. Частей: ${sections.length}`;
  } catch (error) {
    console.error(error);
    statusTextEl.textContent = 'Не удалось открыть книгу.';
    viewerEl.textContent = 'Ошибка загрузки книги: ' + error.message;
  }
}

function extractReadableText(root) {
  const clone = root.cloneNode(true);

  clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach(el => el.remove());

  return clone.innerText || clone.textContent || '';
}

function normalizeText(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function splitIntoSections(text, maxLength = 12000) {
  const paragraphs = text.split(/\n\s*\n/);
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

  return result.length ? result : [text];
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

  statusTextEl.textContent = `Часть ${currentSectionIndex + 1} из ${sections.length}`;
  viewerEl.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

window.addEventListener('load', () => {
  searchInput.value = 'Nietzsche';
  searchBooks();
  applyReaderStyles();

  addLocalBookButton();
});
function addLocalBookButton() {
  const resultsEl = document.getElementById('results');

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

  document
    .getElementById('openLocalBookBtn')
    .addEventListener('click', () => {
      openLocalBook();
    });
}

async function openLocalBook() {
  emptyStateEl.style.display = 'none';
  readerFrameEl.style.display = 'block';
  bookTitleEl.textContent = 'The Antichrist';
  statusTextEl.textContent = 'Загружаю локальную книгу...';

  try {
    const response = await fetch('books/antichrist.txt');
    const text = await response.text();

    if (!text || text.length < 100) {
      throw new Error('Файл пустой или не загрузился');
    }

    sections = splitIntoSections(text, 12000);
    currentSectionIndex = 0;
    renderCurrentSection();

    statusTextEl.textContent = 'Локальная книга открыта';
  } catch (error) {
    console.error(error);
    statusTextEl.textContent = 'Ошибка загрузки книги';
    viewerEl.textContent = error.message;
  }
}
