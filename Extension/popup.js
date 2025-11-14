// Terminal-enhanced popup.js
// Includes: typing animation, blinking cursor, scanlines support, command history style, prefixing, status bar effects

const urlDisplay = document.getElementById('url-display');
const questionInput = document.getElementById('question-input');
const result = document.getElementById('result');
const overlay = document.getElementById('overlay');
const statusAlert = document.getElementById('status-alert');

// Overlay helpers: use multiple techniques to force-hide the overlay
function showOverlay() {
    try {
        if (!overlay) return;
        overlay.hidden = false;
        overlay.style.display = 'flex';
        overlay.classList.remove('d-none');
        overlay.classList.add('d-flex');
        // ensure spinner exists inside overlay (recreate if previously cleared)
        if (!overlay.querySelector('.spinner-border')) {
            const glass = document.createElement('div');
            glass.className = 'glass text-center p-3 bg-dark rounded';
            const spinner = document.createElement('div');
            spinner.className = 'spinner-border text-success';
            glass.appendChild(spinner);
            overlay.appendChild(glass);
        }
    } catch (e) { console.warn('showOverlay error', e); }
}

function forceHideOverlay() {
    try {
        if (!overlay) return;
        overlay.style.display = 'none';
        overlay.hidden = true;
        overlay.classList.remove('d-flex');
        overlay.classList.add('d-none');
        // also clear children to remove any lingering spinners
        // (we won't permanently remove content from DOM; recreate later if needed)
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    } catch (e) { console.warn('forceHideOverlay error', e); }
}

// Load active tab URL
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    urlDisplay.value = tabs[0]?.url || "";
});

// Copy URL
const copyBtn = document.getElementById('copy-url-btn');
copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(urlDisplay.value);
    copyBtn.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
    setTimeout(() => copyBtn.innerHTML = '<i class="bi bi-clipboard"></i>', 1000);
});

// CLEAR
const clearBtn = document.getElementById('clear-button');
clearBtn.addEventListener('click', () => {
    questionInput.value = "";
    result.innerHTML = "";
});

// TYPEWRITER EFFECT
function typeWriter(text, callback) {
    result.innerHTML = "";
    let i = 0;

    function typing() {
        if (i < text.length) {
            result.innerHTML += text.charAt(i);
            i++;
            setTimeout(typing, 12);
        } else if (callback) callback();
    }

    typing();
}

// EXECUTE Q&A
const submitBtn = document.getElementById('submit-button');

// State
let history = JSON.parse(localStorage.getItem('qa_history') || '[]');
let historyIndex = history.length;
let isProcessing = false;
let userSoundEnabled = true;

// Create lightweight typing sound using WebAudio
const audioCtx = (typeof AudioContext !== 'undefined') ? new AudioContext() : null;
function playClick() {
    if (!audioCtx || !userSoundEnabled) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = 900;
    g.gain.value = 0.02;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    setTimeout(() => { o.stop(); }, 30);
}

// Helper: append line with timestamp
function appendLogLine(text, type = 'info') {
    const t = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line';
    line.setAttribute('data-type', type);
    line.style.whiteSpace = 'pre-wrap';
    line.textContent = `[${t}] ${text}`;
    result.appendChild(line);
    // auto-scroll
    const wrapper = document.getElementById('result-wrapper');
    if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
}

// Simple CRT flicker (adds a class for CSS to animate)
function startFlicker() {
    document.body.classList.add('crt-flicker');
}
function stopFlicker() {
    document.body.classList.remove('crt-flicker');
}

// Glow pulse on result wrapper
function pulseGlow() {
    const wrapper = document.getElementById('result-wrapper');
    if (wrapper) {
        wrapper.style.boxShadow = '0 0 18px rgba(74,246,38,0.18)';
        setTimeout(() => { wrapper.style.boxShadow = ''; }, 350);
    }
}

// Thinking animation element
let thinkingInterval = null;
function showThinking() {
    appendLogLine('AI is processing █', 'status');
    let last = result.lastChild;
    if (!last) {
        // ensure there is a node to update
        const ln = document.createElement('div');
        ln.className = 'log-line';
        result.appendChild(ln);
        last = ln;
    }
    let dots = 0;
    thinkingInterval = setInterval(() => {
        dots = (dots + 1) % 5;
        last.textContent = `[${new Date().toLocaleTimeString()}] AI is processing ${'█'.repeat(dots)} `;
        const wrapper = document.getElementById('result-wrapper');
        if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
    }, 300);
}
function hideThinking() {
    if (thinkingInterval) clearInterval(thinkingInterval);
    thinkingInterval = null;
}

// Typewriter with per-character sound and auto-scroll
async function typeWriterWithSound(text) {
    return new Promise((resolve) => {
        const line = document.createElement('div');
        line.className = 'log-line ai-response';
        result.appendChild(line);

        let i = 0;
        function step() {
            if (i < text.length) {
                line.textContent += text.charAt(i);
                i++;
                // occasional click sound
                if (i % 2 === 0) playClick();
                const wrapper = document.getElementById('result-wrapper');
                if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
                setTimeout(step, 14 + Math.random() * 18);
            } else {
                pulseGlow();
                resolve();
            }
        }
        step();
    });
}

// Persist history
function pushHistory(item) {
    history.push({ q: item, t: Date.now() });
    if (history.length > 50) history.shift();
    localStorage.setItem('qa_history', JSON.stringify(history));
    historyIndex = history.length;
}

// Keyboard shortcuts and behavior for textarea
questionInput.addEventListener('keydown', (e) => {
    // Enter -> send (unless Shift+Enter)
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitBtn.click();
        return;
    }

    // Arrow Up -> previous history (only if caret at start)
    if (e.key === 'ArrowUp') {
        const selStart = questionInput.selectionStart;
        if (selStart === 0 && history.length) {
            e.preventDefault();
            historyIndex = Math.max(0, historyIndex - 1);
            questionInput.value = history[historyIndex]?.q || '';
        }
    }

    // Arrow Down -> next history
    if (e.key === 'ArrowDown') {
        if (history.length) {
            e.preventDefault();
            historyIndex = Math.min(history.length, historyIndex + 1);
            questionInput.value = history[historyIndex]?.q || '';
        }
    }

    // Ctrl+L -> clear screen
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        result.innerHTML = '';
        return;
    }
});

submitBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isProcessing) return;

    const question = questionInput.value.trim();
    if (!question) return;

    // log and UI
    const formattedQ = question.startsWith('>') ? question : `> ${question}`;
    appendLogLine(formattedQ, 'user');
    pushHistory(question);
    questionInput.value = '';

    // start effects
    isProcessing = true;
    showOverlay();
    startFlicker();
    showThinking();

    // safety timer: force-hide overlay after 30s if something goes wrong
    const safetyTimer = setTimeout(() => {
        console.warn('Safety timer triggered: hiding overlay');
        forceHideOverlay();
        hideThinking();
        stopFlicker();
        isProcessing = false;
    }, 30000);

    try {
        await new Promise(r => setTimeout(r, 200));

        // ---------------------
        // 🔥 INSERTED EXTENSION LOGIC
        // ---------------------
        const currentUrl = urlDisplay.value;

        const apiResponse = await fetch("http://127.0.0.1:5000/query", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: currentUrl,
                question: question
            })
        });

        if (!apiResponse.ok) {
            throw new Error(`Server error: ${apiResponse.statusText}`);
        }

        const data = await apiResponse.json();

        const response = {
            answer: data.answer || null,
            error: data.error || null
        };
        // ---------------------

    hideThinking();
    forceHideOverlay();
    stopFlicker();

        if (!response || !response.answer) {
            appendLogLine('[ ERROR: No response received ]', 'error');
            isProcessing = false;
            return;
        }

        const text = `> AI: ${response.answer}`;
        await typeWriterWithSound(text);
        appendLogLine('-- end --', 'meta');

    } catch (err) {
        console.error('submitBtn handler error:', err);
    hideThinking();
    forceHideOverlay();
    stopFlicker();
        appendLogLine('[ AI service error ]', 'error');
    } finally {
        clearTimeout(safetyTimer);
        // ensure overlay is hidden and state reset
        try { forceHideOverlay(); } catch (e) { /* ignore */ }
        try { hideThinking(); } catch (e) { /* ignore */ }
        try { stopFlicker(); } catch (e) { /* ignore */ }
        isProcessing = false;
    }
});


// Copy answer button functionality (if present)
const copyAnswerBtn = document.getElementById('copy-answer-btn');
if (copyAnswerBtn) {
    copyAnswerBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(result.innerText || '');
        copyAnswerBtn.innerHTML = '<i class="bi bi-check-lg text-success"></i>';
        setTimeout(() => copyAnswerBtn.innerHTML = '<i class="bi bi-clipboard-check"></i>', 900);
    });
}

// Toggle sound via double-click on header (hidden shortcut)
const header = document.querySelector('.terminal-header');
if (header) {
    header.title = 'Double click to toggle sound';
    header.addEventListener('dblclick', () => {
        userSoundEnabled = !userSoundEnabled;
        const badge = document.createElement('small');
        badge.textContent = userSoundEnabled ? '🔊' : '🔇';
        badge.style.marginLeft = '8px';
        header.querySelector('.sound-badge')?.remove();
        badge.className = 'sound-badge';
        header.appendChild(badge);
    });
}

// Restore simple UI state on load
(function init() {
    // show last few history entries in console (no personal data leak)
    if (history.length) {
        appendLogLine(`Loaded ${history.length} saved queries. Use ↑ / ↓ to navigate.`, 'meta');
    }
})();