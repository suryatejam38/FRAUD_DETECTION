let LANG = {};
let SAMPLES = {};
let FRAUD_TYPES = {};
let SUSPICIOUS_PATTERNS = [];
let TIPS = {};
let AWARENESS = {};

let currentLang = 'en';
let lastAnalysis = null;
let analysisHistory = JSON.parse(localStorage.getItem('fraudAnalysisHistory') || '[]');
let activeRecognition = null;

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  try {
    const [langRes, samplesRes, fraudRes, patternsRes, tipsRes, awarenessRes] = await Promise.all([
      fetch('data/lang.json'),
      fetch('data/samples.json'),
      fetch('data/fraud_types.json'),
      fetch('data/suspicious_patterns.json'),
      fetch('data/tips.json'),
      fetch('data/awareness.json')
    ]);

    LANG = await langRes.json();
    SAMPLES = await samplesRes.json();
    FRAUD_TYPES = await fraudRes.json();
    const rawPatterns = await patternsRes.json();
    SUSPICIOUS_PATTERNS = rawPatterns.map(p => ({
      pattern: new RegExp(p.pattern, 'gi'),
      weight: p.weight
    }));
    TIPS = await tipsRes.json();
    AWARENESS = await awarenessRes.json();

    applyLanguage();
    renderAwareness('trendingUpi');
    renderHistory();
    setupEventListeners();

  } catch (error) {
    console.error("Failed to load application data:", error);
    showToast("Error loading application data. Please use a local HTTP server.");
  }
}

function t(key) { const lang = LANG[currentLang] || LANG.en || {}; return lang[key] || (LANG.en && LANG.en[key]) || key; }

function applyLanguage() {
  const lang = LANG[currentLang] || LANG.en || {};
  document.querySelectorAll('[data-lang]').forEach(el => {
    const k = el.getAttribute('data-lang');
    if (lang[k]) el.textContent = lang[k];
  });
  document.querySelectorAll('[data-lang-placeholder]').forEach(el => {
    const k = el.getAttribute('data-lang-placeholder');
    if (lang[k]) el.placeholder = lang[k];
  });
  renderHistory();
  const activeTab = document.querySelector('#awarenessTabs .nav-link.active');
  if (activeTab) renderAwareness(activeTab.dataset.tab);
}

function mockAnalyze(text) {
  let score = 0;
  const reasons = [];
  let fraudType = 'others';
  SUSPICIOUS_PATTERNS.forEach(({ pattern, weight }) => { 
    // Reset lastIndex because of 'g' flag just in case
    pattern.lastIndex = 0;
    if (pattern.test(text)) score += Math.min(weight, 30); 
  });
  if (/parcel|customs|duty|release.*pay/gi.test(text)) { fraudType = 'courier'; reasons.push("Courier/customs duty scam pattern."); }
  else if (/pre-approved|processing\s*fee.*loan|no\s*documents/gi.test(text)) { fraudType = 'loan'; reasons.push("Fake loan offer with upfront fee."); }
  else if (/matrimonial|shaadi|NRI.*gift|gift\s*transfer/gi.test(text)) { fraudType = 'matrimonial'; reasons.push("Matrimonial scam with money/OTP request."); }
  else if (/bitcoin|btc|wallet|double\s*your|guaranteed.*crypto/gi.test(text)) { fraudType = 'crypto'; reasons.push("Crypto investment scam pattern."); }
  else if (/guaranteed\s*returns|earn\s*\d+%|min\s*deposit|investment.*scheme/gi.test(text)) { fraudType = 'investment'; reasons.push("Investment/Ponzi scheme pattern."); }
  else if (/upi|collect|approve|@paytm|@ybl/gi.test(text)) { fraudType = 'upi'; reasons.push("UPI collect or approve request detected."); }
  else if (/job|salary|registration\s*fee|pay\s+Rs/gi.test(text)) { fraudType = 'job'; reasons.push("Job offer with registration fee request."); }
  else if (/winner|won|lucky\s*draw|congratulations/gi.test(text)) { fraudType = 'lottery'; reasons.push("Lottery/prize claim scam pattern."); }
  else if (/kyc|verif|urgent|account\s*frozen|http/gi.test(text)) { fraudType = 'phishing'; reasons.push("Phishing or fake KYC verification link."); }
  if (reasons.length === 0) reasons.push("Suspicious keywords or patterns found.");
  score = Math.min(100, score);
  const risk = score < 30 ? 'safe' : score < 60 ? 'suspicious' : 'high';
  const confidence = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
  const breakdown = [
    { label: "Suspicious link detected", pts: /bit\.ly|http|tinyurl/gi.test(text) ? 30 : 0 },
    { label: "Urgency language", pts: /urgent|immediate|hurry|act now/gi.test(text) ? 20 : 0 },
    { label: "OTP/UPI PIN request", pts: /OTP|UPI\s*PIN|PIN/gi.test(text) ? 25 : 0 },
    { label: "UPI collect/approve", pts: /collect|approve|upi/gi.test(text) ? 15 : 0 }
  ].filter(b => b.pts > 0);
  return { score, risk, fraudType, confidence, reasons, breakdown, tips: TIPS[fraudType] || TIPS.others };
}

function highlightSuspicious(text) {
  const patterns = [/\b(OTP|UPI\s*PIN|PIN)\b/gi, /(https?:\/\/[^\s]+|bit\.ly\/[^\s]+)/gi, /\b(urgent|immediate|KYC|winner|won|collect|approve)\b/gi, /[\d]{10}@\w+/gi];
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  patterns.forEach(p => { html = html.replace(new RegExp(p.source, 'gi'), '<span class="suspicious-word">$&</span>'); });
  return html;
}

function animateGauge(targetPct, risk, durationMs) {
  const ring = document.getElementById('gaugeRing');
  const valueEl = document.getElementById('gaugeValue');
  const colors = { safe: '#16A34A', suspicious: '#FACC15', high: '#DC2626' };
  const color = colors[risk];
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - progress, 2);
    const current = Math.round(targetPct * eased);
    valueEl.textContent = current + '%';
    ring.style.background = `conic-gradient(${color} 0deg ${current * 3.6}deg, #e2e8f0 ${current * 3.6}deg 360deg)`;
    if (progress < 1) requestAnimationFrame(tick);
    else { valueEl.textContent = targetPct + '%'; ring.style.background = `conic-gradient(${color} 0deg ${targetPct * 3.6}deg, #e2e8f0 ${targetPct * 3.6}deg 360deg)`; }
  }
  valueEl.textContent = '0%';
  ring.style.background = `conic-gradient(#e2e8f0 0deg 360deg)`;
  requestAnimationFrame(tick);
}

function showToast(msg) {
  const c = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast align-items-center border-0 bg-success text-white';
  toast.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2" data-bs-dismiss="toast"></button></div>`;
  c.appendChild(toast);
  new bootstrap.Toast(toast).show();
  toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

function runAnalysis() {
  const text = document.getElementById('messageInput').value.trim();
  if (!text) { alert('Please enter a message to analyze.'); return; }
  const result = mockAnalyze(text);
  lastAnalysis = { text, ...result, timestamp: Date.now() };
  document.getElementById('riskPill').textContent = result.risk === 'safe' ? 'SAFE' : result.risk === 'suspicious' ? 'SUSPICIOUS' : 'HIGH RISK';
  document.getElementById('riskPill').className = 'risk-pill risk-' + result.risk;
  animateGauge(result.score, result.risk, 1200);
  const ft = FRAUD_TYPES[result.fraudType] || FRAUD_TYPES.others;
  document.getElementById('fraudTypeLabel').textContent = ft.label;
  document.getElementById('fraudIcon').className = 'bi ' + ft.icon + ' text-danger fs-3';
  document.getElementById('confidenceBadge').textContent = result.confidence;
  document.getElementById('highlightedMessage').innerHTML = highlightSuspicious(text);
  document.getElementById('reasonsList').innerHTML = result.reasons.map(r => `<li>${r}</li>`).join('');
  const sb = document.getElementById('scoreBreakdown');
  sb.innerHTML = result.breakdown.map(b => { const pct = Math.min(100, (b.pts / 30) * 100); return `<div class="score-row"><span class="label">${b.label} +${b.pts}</span><div class="bar-bg"><div class="score-bar" style="width:0%" data-width="${pct}">${b.label} +${b.pts}</div></div></div>`; }).join('');
  setTimeout(() => sb.querySelectorAll('.score-bar').forEach(bar => { bar.style.width = (bar.dataset.width || 0) + '%'; }), 200);
  document.getElementById('tipsList').innerHTML = result.tips.map(tip => `<li>${tip}</li>`).join('');
  document.getElementById('checklistDiv').innerHTML = result.tips.slice(0, 3).map((tip, i) => `<div class="form-check"><input class="form-check-input" type="checkbox" id="c${i}"><label class="form-check-label" for="c${i}">${tip}</label></div>`).join('');
  const report = `=== Digital Safety Assistant - Report ===\nScam Probability: ${result.score}%\nRisk Level: ${result.risk.toUpperCase()}\nFraud Type: ${ft.label}\n\nWhy flagged:\n${result.reasons.map(r => '- ' + r).join('\n')}\n\nSafety tips:\n${result.tips.map(t => '- ' + t).join('\n')}\n\nEmergency: Call Cybercrime Helpline 1930\nReport: https://cybercrime.gov.in\n========================================`;
  document.getElementById('reportText').value = report;
  document.getElementById('homeSection').style.display = 'none';
  document.getElementById('resultsSection').classList.add('visible');
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function renderAwareness(tab) {
  const data = AWARENESS[tab] || AWARENESS.common || [];
  const content = document.getElementById('awarenessContent');
  if (!content) return;
  if (tab === 'trendingUpi' || tab === 'common') content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><i class="bi ${d.icon} text-primary fs-4"></i><h6>${d.title}</h6><p class="small mb-1">${d.desc}</p><small class="text-danger">Red flags: ${d.flags.join(', ')}</small></div></div>`).join('') + '</div>';
  else if (tab === 'vs') content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><i class="bi ${d.icon} text-danger"></i> <strong>${d.title}</strong><br><i class="bi bi-check-circle text-success"></i> ${d.legit}</div></div>`).join('') + '</div>';
  else content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><i class="bi ${d.icon} text-primary fs-4"></i><h6>${d.title}</h6><p class="small mb-0">${d.desc}</p></div></div>`).join('') + '</div>';
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  const counts = {}; analysisHistory.forEach(h => { counts[h.text] = (counts[h.text] || 0) + 1; });
  if (!analysisHistory.length) { list.innerHTML = `<p class="text-center text-muted">${t('noHistory')}</p>`; return; }
  list.innerHTML = analysisHistory.map(h => {
    const trending = counts[h.text] >= 3 ? `<span class="trending-badge ms-2">${t('trendingScam')}</span>` : '';
    const ft = FRAUD_TYPES[h.fraudType] || FRAUD_TYPES.others || {label: "Others"};
    return `<div class="history-item d-flex justify-content-between align-items-center flex-wrap gap-2"><div><span class="badge ${h.score >= 60 ? 'bg-danger' : h.score >= 30 ? 'bg-warning' : 'bg-success'}">${h.score}%</span><strong>${ft.label}</strong>${trending}<div class="small text-muted">${h.text.substring(0, 50)}...</div><small>${h.time}</small></div><button class="btn btn-sm btn-primary" data-id="${h.id}">${t('view')}</button></div>`;
  }).join('');
  list.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', () => { const entry = analysisHistory.find(x => x.id == btn.dataset.id); if (entry?.full) { lastAnalysis = entry.full; document.getElementById('messageInput').value = entry.full.text; document.getElementById('charCount').textContent = entry.full.text.length; runAnalysis(); } }));
}

function setupEventListeners() {
  document.getElementById('messageInput')?.addEventListener('input', () => { document.getElementById('charCount').textContent = document.getElementById('messageInput').value.length; });
  document.getElementById('btnAnalyze')?.addEventListener('click', runAnalysis);

  document.getElementById('btnSpeak')?.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const textarea = document.getElementById('messageInput');
    const btn = document.getElementById('btnSpeak');
    const iconSpan = btn.querySelector('i.bi');
    const textSpan = btn.querySelector('span[data-lang]');
    if (activeRecognition) { activeRecognition.stop(); return; }
    if (!SpeechRecognition) {
      textarea.value = "Your UPI collect request of Rs 3000 from 9876543210@paytm. Approve now: https://bit.ly/upi-ok. OTP valid 5 mins.";
      document.getElementById('charCount').textContent = textarea.value.length;
      showToast('Voice not supported. Sample added.');
      return;
    }
    const recognition = new SpeechRecognition();
    activeRecognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    const langMap = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN', bn: 'bn-IN', mr: 'mr-IN' };
    recognition.lang = langMap[currentLang] || 'en-IN';
    function restoreBtn() {
      activeRecognition = null;
      iconSpan.className = 'bi bi-mic me-2';
      if (textSpan) textSpan.textContent = t('speak');
      btn.classList.remove('active', 'btn-danger');
      btn.classList.add('btn-secondary-custom');
    }
    recognition.onstart = () => { iconSpan.className = 'bi bi-stop-circle-fill me-2'; if (textSpan) textSpan.textContent = t('stopListening'); btn.classList.add('active', 'btn-danger'); btn.classList.remove('btn-secondary-custom'); showToast('Listening… Click Stop when done.'); };
    recognition.onresult = (e) => { let transcript = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) transcript += e.results[i][0].transcript; } if (transcript) { textarea.value = (textarea.value + (textarea.value ? ' ' : '') + transcript).trim(); document.getElementById('charCount').textContent = textarea.value.length; } };
    recognition.onend = () => { restoreBtn(); showToast('Stopped listening.'); };
    recognition.onerror = (e) => { restoreBtn(); if (e.error === 'not-allowed') showToast('Microphone denied.'); else if (e.error !== 'aborted') showToast('Voice error. Try again.'); };
    recognition.start();
  });

  document.getElementById('btnUploadOCR')?.addEventListener('click', () => document.getElementById('ocrFileInput').click());
  document.getElementById('ocrFileInput')?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) { document.getElementById('ocrPreview').textContent = '✓ ' + f.name; document.getElementById('messageInput').value = "URGENT: Your bank account will be frozen. Complete KYC: https://fake-bank-kyc.com. Enter OTP to verify."; document.getElementById('charCount').textContent = document.getElementById('messageInput').value.length; showToast('OCR simulated.'); }
  });

  document.querySelectorAll('.chip-sample').forEach(chip => chip.addEventListener('click', () => { document.getElementById('messageInput').value = SAMPLES[chip.dataset.sample] || ''; document.getElementById('charCount').textContent = document.getElementById('messageInput').value.length; }));

  document.getElementById('btnAnalyzeAnother')?.addEventListener('click', () => {
    document.getElementById('messageInput').value = ''; document.getElementById('charCount').textContent = '0'; document.getElementById('ocrPreview').textContent = ''; document.getElementById('ocrFileInput').value = '';
    document.getElementById('resultsSection').classList.remove('visible'); document.getElementById('homeSection').style.display = 'block'; document.getElementById('homeSection').scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btnSaveHistory')?.addEventListener('click', () => {
    if (!lastAnalysis) return;
    analysisHistory.unshift({ id: Date.now(), text: lastAnalysis.text.substring(0, 80), score: lastAnalysis.score, fraudType: lastAnalysis.fraudType, full: lastAnalysis, time: new Date().toLocaleString() });
    analysisHistory = analysisHistory.slice(0, 10);
    localStorage.setItem('fraudAnalysisHistory', JSON.stringify(analysisHistory));
    showToast(t('saved'));
    renderHistory();
  });

  document.getElementById('btnCopyReport')?.addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('reportText').value); showToast(t('copied')); });
  document.getElementById('btnShareReport')?.addEventListener('click', () => {
    const text = document.getElementById('reportText').value;
    if (navigator.share) { navigator.share({ title: 'Digital Safety Assistant', text, url: window.location.href }).then(() => showToast('Shared!')).catch(() => {}); }
    else { const m = document.createElement('div'); m.className = 'modal fade'; m.innerHTML = '<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5>Share</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p>Copy the report below and share.</p><textarea class="form-control" rows="8" id="shareReportCopy"></textarea></div></div></div>'; document.body.appendChild(m); m.querySelector('#shareReportCopy').value = text; const bs = bootstrap.Modal.getOrCreateInstance(m); bs.show(); m.addEventListener('hidden.bs.modal', () => { bs.dispose(); m.remove(); }); }
  });
  document.getElementById('btnDownloadReport')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(document.getElementById('reportText').value); a.download = 'fraud-report-' + Date.now() + '.txt'; a.click(); showToast('Downloaded.'); });

  document.getElementById('langDropdown')?.addEventListener('click', (e) => {
    const opt = e.target.closest('.lang-opt');
    if (opt) {
      e.preventDefault();
      e.stopPropagation();
      const val = opt.getAttribute('data-lang-val') || '';
      if (val && Object.prototype.hasOwnProperty.call(LANG, val)) {
        currentLang = val;
        applyLanguage();
        const toggle = document.querySelector('.lang-dropdown .dropdown-toggle');
        if (toggle && LANG[val]?.langLabel) toggle.textContent = LANG[val].langLabel;
      }
    }
  });

  document.querySelectorAll('#awarenessTabs .nav-link').forEach(link => link.addEventListener('click', (e) => { e.preventDefault(); document.querySelectorAll('#awarenessTabs .nav-link').forEach(l => l.classList.remove('active')); link.classList.add('active'); renderAwareness(link.dataset.tab); }));

  window.addEventListener('scroll', () => document.getElementById('mainNav')?.classList.toggle('scrolled', window.scrollY > 20));
}
