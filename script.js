const AI_ENDPOINT = 'https://prknybetxirzbzkvmovw.supabase.co/functions/v1/omnia-ai';
const SUPABASE_ANON_KEY = 'sb_publishable_X2hZ6bXgj5HHSSZQPiXYsw_mhF5NHpy';

let selectedFragment = '';

async function callAI(action, text, targetLanguage = 'Russian') {
  try {
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
      console.error('AI ERROR:', data);
      throw new Error(data?.error || 'AI error');
    }

    return data.result || data.response || JSON.stringify(data);

  } catch (error) {
    console.error('FETCH ERROR:', error);
    throw error;
  }
}

// ================= UI =================

function openActionPanel(text) {
  const panel = document.getElementById('actionPanel');
  const selectedBox = document.getElementById('selectedTextBox');
  const resultBox = document.getElementById('actionResult');

  selectedFragment = text;
  selectedBox.textContent = text;
  resultBox.textContent = 'Выбери действие...';

  panel.classList.add('active');
}

function closeActionPanel() {
  document.getElementById('actionPanel').classList.remove('active');
}

// ================= ACTIONS =================

async function translateSelection() {
  const resultBox = document.getElementById('actionResult');
  resultBox.textContent = 'Перевожу...';

  try {
    const result = await callAI('translate', selectedFragment, 'Russian');
    resultBox.textContent = result;
  } catch (e) {
    resultBox.textContent = 'Ошибка перевода: ' + e.message;
  }
}

async function explainSelection() {
  const resultBox = document.getElementById('actionResult');
  resultBox.textContent = 'Объясняю...';

  try {
    const result = await callAI('explain', selectedFragment, 'Russian');
    resultBox.textContent = result;
  } catch (e) {
    resultBox.textContent = 'Ошибка объяснения: ' + e.message;
  }
}

function saveSelection() {
  const resultBox = document.getElementById('actionResult');
  resultBox.textContent = 'Сохранено (пока локально)';
}

// ================= SELECTION =================

document.addEventListener('mouseup', () => {
  const selection = window.getSelection().toString().trim();

  if (selection.length > 10) {
    openActionPanel(selection);
  }
});

// ================= BUTTONS =================

document.getElementById('translateBtn').onclick = translateSelection;
document.getElementById('explainBtn').onclick = explainSelection;
document.getElementById('saveBtn').onclick = saveSelection;
document.getElementById('closeActionPanelBtn').onclick = closeActionPanel;
