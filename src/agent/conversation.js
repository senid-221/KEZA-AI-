// Conversation thread — a single growing, always-inline log (Qoder/Render style): the
// agent's prose streams here and every studio action becomes a compact "did this" card
// right in the flow. XSS-safe: all model text is escaped before any formatting.

import { providerAccent, providerLogo } from './providers.js';

export function createConversation(root) {
  root.classList.add('convo');
  function scrollDown() { root.scrollTop = root.scrollHeight; }

  function bubble(role) {
    const b = el('div', 'msg ' + role);
    const who = el('div', 'who');
    b.appendChild(who);
    const body = el('div', 'body');
    b.appendChild(body);
    root.appendChild(b);
    scrollDown();
    return { node: b, who, body };
  }

  function addUser(text) {
    const { who, body } = bubble('user');
    who.textContent = 'You';
    body.textContent = text;
    return body;
  }

  function addSystem(text) {
    const n = el('div', 'msg system');
    const b = el('div', 'body'); b.textContent = text; n.appendChild(b);
    root.appendChild(n); scrollDown(); return b;
  }

  // Returns a streaming controller for one assistant turn.
  function startAssistant(meta) {
    const { node, who, body } = bubble('agent');
    who.innerHTML = `<span class="plogo-mini">${meta && meta.logo ? meta.logo : ''}</span>` +
      `<span class="who-name">KEZA</span>` +
      (meta && meta.model ? `<span class="who-model">${escapeHtml(meta.model)}</span>` : '');
    if (meta && meta.accent) who.style.setProperty('--accent', meta.accent);
    const prose = el('div', 'prose');
    body.appendChild(prose);
    let raw = '';
    return {
      append(chunk) {
        raw += chunk;
        prose.innerHTML = renderMarkdown(stripFence(raw));
        scrollDown();
      },
      setRaw(full) { raw = full || ''; prose.innerHTML = renderMarkdown(stripFence(raw)); scrollDown(); },
      card(action) {
        const card = buildCard(action, meta || {});
        if (card) { body.appendChild(card); scrollDown(); }
        return card;
      },
      finish() { node.classList.add('done'); },
      fail(msg) { const e = el('div', 'err'); e.textContent = msg; body.appendChild(e); scrollDown(); },
      raw() { return raw; }
    };
  }

  function clear() { root.replaceChildren(); }

  return { addUser, addSystem, startAssistant, clear, scrollDown };
}

function stripFence(s) {
  // while a studio block is still open (unclosed fence) don't show raw JSON
  return s;
}

// ---- action cards -----------------------------------------------------------
function buildCard(action, meta) {
  const a = String(action.action);
  const card = el('div', 'action-card a-' + a);
  const head = el('div', 'ac-head');
  const verb = ({
    code: 'Editing code', run: 'Running preview', lab: 'Driving the 3D Lab',
    annotate: 'Drawing', dragdrop: 'Drag & drop', simulate: 'Simulating training',
    quiz: 'Quick check', lesson: 'Lesson'
  })[a] || 'Action';
  const dot = el('span', 'ac-dot'); head.appendChild(dot);
  const title = el('span', 'ac-title'); title.textContent = verb; head.appendChild(title);
  if (action.note) { const n = el('span', 'ac-note'); n.textContent = action.note; head.appendChild(n); }
  card.appendChild(head);

  if (a === 'code') {
    const tabs = el('div', 'ac-tabs');
    const tag = el('span', 'mode-tag'); tag.textContent = (action.mode || 'html').toUpperCase(); tabs.appendChild(tag);
    const snippet = el('pre', 'ac-snippet');
    const firstLines = String(action.content || '').split('\n').slice(0, 8).join('\n');
    snippet.textContent = firstLines + (String(action.content || '').split('\n').length > 8 ? '\n…' : '');
    card.append(tabs, snippet);
  } else if (a === 'lab') {
    const s = el('div', 'ac-detail'); s.textContent = `${action.method}(${(action.args || []).map(fmt).join(', ')})`; card.appendChild(s);
  } else if (a === 'annotate') {
    const s = el('div', 'ac-detail'); s.textContent = `${action.kind} ${describeShape(action.shape)}`; card.appendChild(s);
  } else if (a === 'dragdrop') {
    const s = el('div', 'ac-detail'); s.textContent = `move "${action.label || 'token'}" → target`; card.appendChild(s);
  } else if (a === 'simulate') {
    card.appendChild(trainingWidget(action.epochs || 6));
  } else if (a === 'quiz') {
    card.appendChild(quizWidget(action));
  } else if (a === 'lesson') {
    const ol = el('ol', 'ac-steps');
    (action.steps || []).forEach((st) => { const li = el('li'); li.textContent = st; ol.appendChild(li); });
    card.appendChild(ol);
  }
  return card;
}

function describeShape(sh) {
  if (!sh) return '';
  if (sh.label) return `"${sh.label}"`;
  if (sh.type) return sh.type;
  return '';
}

function fmt(v) { return typeof v === 'string' ? `"${v}"` : String(v); }

// ---- quiz -------------------------------------------------------------------
function quizWidget(q) {
  const wrap = el('div', 'quiz');
  const prompt = el('div', 'quiz-q'); prompt.textContent = q.question || 'Question'; wrap.appendChild(prompt);
  const opts = el('div', 'quiz-opts');
  let answered = false;
  (q.options || []).forEach((text, i) => {
    const btn = el('button', 'quiz-opt'); btn.type = 'button'; btn.textContent = text;
    btn.addEventListener('click', () => {
      if (answered) return; answered = true;
      if (i === Number(q.answer)) { btn.classList.add('correct'); }
      else { btn.classList.add('wrong'); const c = opts.children[Number(q.answer)]; if (c) c.classList.add('correct'); }
      if (q.explain) { const ex = el('div', 'quiz-explain'); ex.textContent = q.explain; wrap.appendChild(ex); }
    });
    opts.appendChild(btn);
  });
  wrap.appendChild(opts);
  return wrap;
}

// ---- animated training-loop simulation -------------------------------------
function trainingWidget(epochs) {
  const wrap = el('div', 'sim');
  const canvas = document.createElement('canvas');
  canvas.width = 460; canvas.height = 150; canvas.className = 'sim-canvas';
  const cap = el('div', 'sim-cap'); cap.textContent = 'epoch 0 / ' + epochs;
  wrap.append(canvas, cap);
  const ctx = canvas.getContext('2d');
  const pts = [];
  let step = 0;
  function lossAt(i) { return 0.9 * Math.exp(-i / (epochs / 2.2)) + 0.06 + Math.random() * 0.02; }
  function draw() {
    const W = canvas.width, H = canvas.height, pad = 18;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(160,180,220,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.lineTo(W - pad, pad); ctx.stroke();
    const maxE = epochs;
    ctx.beginPath(); ctx.strokeStyle = '#7c86ff'; ctx.lineWidth = 2.5;
    pts.forEach((v, i) => {
      const x = pad + (i / maxE) * (W - 2 * pad);
      const y = H - pad - v * (H - 2 * pad);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    pts.forEach((v, i) => {
      const x = pad + (i / maxE) * (W - 2 * pad);
      const y = H - pad - v * (H - 2 * pad);
      ctx.fillStyle = '#ff4d8d'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
  }
  const timer = setInterval(() => {
    step++; pts.push(lossAt(step)); draw(); cap.textContent = `epoch ${step} / ${epochs} · loss ${pts[pts.length - 1].toFixed(3)}`;
    if (step >= epochs) { clearInterval(timer); cap.textContent = `trained in ${epochs} epochs · final loss ${pts[pts.length - 1].toFixed(3)}`; }
  }, 420);
  draw();
  return wrap;
}

// ---- safe markdown-ish renderer --------------------------------------------
export function renderMarkdown(src) {
  let s = escapeHtml(String(src == null ? '' : src));
  // fenced code blocks
  s = s.replace(/```([a-zA-Z0-9]*)\n([\s\S]*?)```/g, (_m, lang, body) => {
    return `<pre class="md-code"><code>${body.replace(/\n$/, '')}</code></pre>`;
  });
  // inline code
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');
  // bold + italics
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // links (http/https only)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // headings
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<strong class="md-h">$1</strong>');
  // unordered lists
  s = s.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  s = s.replace(/<\/ul>\s*<ul>/g, '');
  // paragraphs from blank-line breaks
  s = s.split(/\n{2,}/).map((p) => {
    if (/^\s*<(ul|pre|h|strong class="md-h")/.test(p)) return p;
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  return s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
