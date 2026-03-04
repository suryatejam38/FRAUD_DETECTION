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
let currentCheckMode = 'message'; // 'message' or 'number'
let darkMode = localStorage.getItem('darkMode') === 'true'; // Load dark mode preference

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
    
    // Apply dark mode if enabled
    if (darkMode) {
      document.body.classList.add('dark-mode');
      updateThemeButtonIcon();
    }

  } catch (error) {
    console.error("Failed to load application data:", error);
    showToast("Error loading application data. Please use a local HTTP server.");
  }
}

function t(key) { const lang = LANG[currentLang] || LANG.en || {}; return lang[key] || (LANG.en && LANG.en[key]) || key; }

function applyLanguage() {
  const lang = LANG[currentLang] || LANG.en || {};
  
  // Update HTML lang attribute
  document.documentElement.lang = currentLang;
  
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
  if (!c) {
    console.error('Toast container not found');
    alert(msg); // Fallback
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast align-items-center border-0 bg-success text-white';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.setAttribute('aria-atomic', 'true');
  toast.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  c.appendChild(toast);
  const bsToast = new bootstrap.Toast(toast, { autohide: true, delay: 3000 });
  bsToast.show();
  toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

function runAnalysis() {
  if (currentCheckMode === 'number') {
    analyzePhoneNumber();
    return;
  }
  
  const text = document.getElementById('messageInput').value.trim();
  if (!text) { 
    showToast('Please enter a message to analyze.'); 
    return; 
  }
  if (text.length < 10) {
    showToast('Message too short. Please enter at least 10 characters.');
    return;
  }
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
  
  // Auto-save to history
  saveToHistory();
}

function renderAwareness(tab) {
  const data = AWARENESS[tab] || AWARENESS.common || [];
  const content = document.getElementById('awarenessContent');
  if (!content) return;
  if (tab === 'trendingUpi' || tab === 'common') content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><div class="card-content"><i class="bi ${d.icon} text-primary fs-4"></i><h6>${d.title}</h6><p class="small mb-1">${d.desc}</p><small class="text-danger">Red flags: ${d.flags.join(', ')}</small></div></div></div>`).join('') + '</div>';
  else if (tab === 'vs') content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><div class="card-content"><i class="bi ${d.icon} text-danger"></i> <strong>${d.title}</strong><br><i class="bi bi-check-circle text-success"></i> ${d.legit}</div></div></div>`).join('') + '</div>';
  else if (tab === 'tips') content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><div class="card-content"><i class="bi ${d.icon} text-success fs-4"></i><h6>${d.title}</h6><p class="small mb-0">${d.desc}</p></div></div></div>`).join('') + '</div>';
  else content.innerHTML = '<div class="row g-3">' + data.map(d => `<div class="col-md-6 col-lg-4"><div class="awareness-card"><div class="card-content"><i class="bi ${d.icon} text-primary fs-4"></i><h6>${d.title}</h6><p class="small mb-0">${d.desc}</p></div></div></div>`).join('') + '</div>';
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const clearBtn = document.getElementById('btnClearAllHistory');
  if (!list) return;
  const counts = {}; analysisHistory.forEach(h => { counts[h.text] = (counts[h.text] || 0) + 1; });
  if (!analysisHistory.length) { list.innerHTML = `<p class="text-center text-muted">${t('noHistory')}</p>`; clearBtn.style.display = 'none'; return; }
  clearBtn.style.display = 'block';
  list.innerHTML = analysisHistory.map(h => {
    const trending = counts[h.text] >= 3 ? `<span class="trending-badge ms-2">${t('trendingScam')}</span>` : '';
    const ft = FRAUD_TYPES[h.fraudType] || FRAUD_TYPES.others || {label: "Others"};
    return `<div class="history-item d-flex justify-content-between align-items-center flex-wrap gap-2"><div><span class="badge ${h.score >= 60 ? 'bg-danger' : h.score >= 30 ? 'bg-warning' : 'bg-success'}">${h.score}%</span><strong>${ft.label}</strong>${trending}<div class="small text-muted">${h.text.substring(0, 50)}...</div><small>${h.time}</small></div><div class="d-flex gap-2"><button class="btn btn-sm btn-primary" data-id="${h.id}">${t('view')}</button><button class="btn btn-sm btn-danger delete-history-btn" data-id="${h.id}" title="${t('deleteItem') || 'Delete'}"><i class="bi bi-trash3"></i></button></div></div>`;
  }).join('');
  list.querySelectorAll('button[data-id]:not(.delete-history-btn)').forEach(btn => btn.addEventListener('click', () => { const entry = analysisHistory.find(x => x.id == btn.dataset.id); if (entry?.full) { lastAnalysis = entry.full; document.getElementById('messageInput').value = entry.full.text; document.getElementById('charCount').textContent = entry.full.text.length; runAnalysis(); } }));
  list.querySelectorAll('.delete-history-btn').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); deleteHistoryItem(btn.dataset.id); }));
}

function deleteHistoryItem(id) {
  analysisHistory = analysisHistory.filter(item => item.id != id);
  try {
    localStorage.setItem('fraudAnalysisHistory', JSON.stringify(analysisHistory));
  } catch (e) {
    console.error('Error saving to localStorage:', e);
  }
  renderHistory();
  showToast(t('itemDeleted') || 'Item deleted');
}

function clearAllHistory() {
  const confirmMsg = t('confirmClear') || 'Are you sure you want to delete all history? This cannot be undone.';
  if (confirm(confirmMsg)) {
    analysisHistory = [];
    try {
      localStorage.setItem('fraudAnalysisHistory', JSON.stringify(analysisHistory));
    } catch (e) {
      console.error('Error saving to localStorage:', e);
    }
    renderHistory();
    showToast(t('historyCleared') || 'History cleared');
  }
}

// Helper functions for drag and drop
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    handleFiles(files);
  }
}

function handleFiles(files) {
  const file = files[0];
  if (file && file.type.startsWith('image/')) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large. Maximum 5MB allowed.');
      return;
    }
    document.getElementById('ocrPreview').textContent = '✓ ' + file.name;
    document.getElementById('messageInput').value = "URGENT: Your bank account will be frozen. Complete KYC: https://fake-bank-kyc.com. Enter OTP to verify.";
    document.getElementById('charCount').textContent = document.getElementById('messageInput').value.length;
    showToast('Image uploaded! OCR simulated.');
  } else {
    showToast('Please upload an image file.');
  }
}

function saveToHistory() {
  if (!lastAnalysis) return;
  try {
    analysisHistory.unshift({ id: Date.now(), text: lastAnalysis.text.substring(0, 80), score: lastAnalysis.score, fraudType: lastAnalysis.fraudType, full: lastAnalysis, time: new Date().toLocaleString() });
    analysisHistory = analysisHistory.slice(0, 10);
    localStorage.setItem('fraudAnalysisHistory', JSON.stringify(analysisHistory));
    renderHistory();
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

function switchCheckMode(mode) {
  currentCheckMode = mode;
  
  // Update button states
  document.querySelectorAll('.check-mode-btn').forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Show/hide sections
  const messageSection = document.getElementById('messageSection');
  const numberSection = document.getElementById('numberSection');
  const dropZone = document.getElementById('dropZone');
  const btnSpeak = document.getElementById('btnSpeak');
  const btnUploadOCR = document.getElementById('btnUploadOCR');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const btnReportNumber = document.getElementById('btnReportNumber');
  const numberInfo = document.getElementById('numberInfo');
  
  if (mode === 'message') {
    messageSection.style.display = 'block';
    numberSection.style.display = 'none';
    dropZone.style.display = 'flex';
    btnSpeak.style.display = 'inline-block';
    btnUploadOCR.style.display = 'inline-block';
    if (btnReportNumber) btnReportNumber.style.display = 'none';
    btnAnalyze.querySelector('span').textContent = 'Analyze Message';
  } else {
    messageSection.style.display = 'none';
    numberSection.style.display = 'block';
    dropZone.style.display = 'none';
    btnSpeak.style.display = 'none';
    btnUploadOCR.style.display = 'none';
    if (btnReportNumber) btnReportNumber.style.display = 'inline-block';
    btnAnalyze.querySelector('span').textContent = 'Check Number';
    numberInfo.innerHTML = 'Checking spam database...';
    document.getElementById('numberInput').value = '';
  }
}

function analyzePhoneNumber() {
  const phoneNumber = document.getElementById('numberInput').value.trim();
  if (!phoneNumber) {
    showToast('Please enter a phone number.');
    return;
  }
  if (!/^\d{10}$/.test(phoneNumber.replace(/[-\s()]/g, ''))) {
    showToast('Please enter a valid 10-digit phone number.');
    return;
  }
  
  const result = checkPhoneNumber(phoneNumber);
  const numberInfo = document.getElementById('numberInfo');
  if (result.isSpam) {
    numberInfo.innerHTML = '<span style="color: #dc2626; font-weight: bold;">⚠️ Spam Number Detected</span>';
  } else {
    numberInfo.innerHTML = '<span style="color: #059669; font-weight: bold;">✓ Number appears safe</span>';
  }
}

function checkPhoneNumber(phoneNumber) {
  // Mock phone number spam detection
  const spamNumbers = [
    '9876543210', '8765432109', '7654321098', '6543210987',
    '5432109876', '9111111111', '8888888888', '7777777777'
  ];
  
  // Clean the number
  const cleanNumber = phoneNumber.replace(/\D/g, '').slice(-10);
  const isSpam = spamNumbers.includes(cleanNumber);
  
  return { isSpam, cleanNumber };
}

function loadUserData() {
  try {
    const userData = JSON.parse(localStorage.getItem('suraksha_user'));
    if (userData && userData.name) {
      updateLoginButton(userData.name);
    }
  } catch (error) {
    console.error('Error loading user data:', error);
  }
}

function updateLoginButton(userName) {
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.innerHTML = `<i class="bi bi-person-check-fill"></i> <span>${userName}</span>`;
    loginBtn.style.backgroundColor = '#10b981';
    loginBtn.style.borderColor = '#10b981';
  }
}

function logoutUser() {
  localStorage.removeItem('suraksha_user');
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.innerHTML = `<i class="bi bi-person-circle"></i> <span data-lang="login">${t('login')}</span>`;
    loginBtn.style.backgroundColor = '';
    loginBtn.style.borderColor = '';
  }
  showToast('Logged out successfully!');
}

function updateThemeButtonIcon() {
  const themeBtn = document.getElementById('themeToogleBtn');
  if (themeBtn) {
    if (darkMode) {
      themeBtn.innerHTML = '<i class="bi bi-sun-fill"></i>';
    } else {
      themeBtn.innerHTML = '<i class="bi bi-moon-fill"></i>';
    }
  }
}

function toggleDarkMode() {
  darkMode = !darkMode;
  localStorage.setItem('darkMode', darkMode);
  
  if (darkMode) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
  
  updateThemeButtonIcon();
}

function setupEventListeners() {
  // Mode switching
  document.getElementById('btnCheckMessage')?.addEventListener('click', () => switchCheckMode('message'));
  document.getElementById('btnCheckNumber')?.addEventListener('click', () => switchCheckMode('number'));
  
  document.getElementById('messageInput')?.addEventListener('input', () => { document.getElementById('charCount').textContent = document.getElementById('messageInput').value.length; });
  document.getElementById('btnAnalyze')?.addEventListener('click', runAnalysis);

  // Report number button handler
  document.getElementById('btnReportNumber')?.addEventListener('click', () => {
    const userData = JSON.parse(localStorage.getItem('suraksha_user'));
    if (!userData || !userData.name) {
      // User not logged in - show login modal
      showToast(t('loginToReport'));
      const loginModalEl = document.getElementById('loginModal');
      if (loginModalEl) {
        const loginModal = bootstrap.Modal.getOrCreateInstance(loginModalEl);
        loginModal.show();
      }
      return;
    }
    
    // User is logged in - process report
    const phoneNumber = document.getElementById('numberInput').value.trim();
    if (!phoneNumber) {
      showToast('Please enter a phone number to report');
      return;
    }
    
    if (!/^\d{10}$/.test(phoneNumber.replace(/[-\s()]/g, ''))) {
      showToast('Please enter a valid 10-digit phone number');
      return;
    }
    
    // Submit the report (mock implementation)
    try {
      const reportData = {
        number: phoneNumber,
        reportedBy: userData.name,
        reportedAt: new Date().toISOString(),
        reason: 'Spam detected'
      };
      
      // In real scenario, this would be sent to a backend
      console.log('Report submitted:', reportData);
      showToast(t('numberReported'));
      
      // Clear the input
      document.getElementById('numberInput').value = '';
      document.getElementById('numberInfo').textContent = 'Checking spam database...';
    } catch (error) {
      console.error('Error reporting number:', error);
      showToast('Error submitting report. Please try again.');
    }
  });

  // Login button handler - toggle login/logout
  document.getElementById('loginBtn')?.addEventListener('click', (e) => {
    const userData = JSON.parse(localStorage.getItem('suraksha_user'));
    if (userData && userData.name) {
      // User is logged in - show logout confirmation
      if (confirm(`Logout as ${userData.name}?`)) {
        logoutUser();
      }
    } else {
      // User is not logged in - show login modal
      const loginModalEl = document.getElementById('loginModal');
      if (loginModalEl) {
        const loginModal = bootstrap.Modal.getOrCreateInstance(loginModalEl);
        loginModal.show();
      }
    }
  });

  // Theme toggle button handler
  document.getElementById('themeToogleBtn')?.addEventListener('click', toggleDarkMode);

  // Drag and drop functionality
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('ocrFileInput');
  
  if (dropZone && fileInput) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // Highlight drop zone when dragging over it
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });
    
    // Handle dropped files
    dropZone.addEventListener('drop', handleDrop, false);
    
    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());
    
    // Keyboard accessibility
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
  }

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
    if (e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });

  document.querySelectorAll('.chip-sample').forEach(chip => chip.addEventListener('click', () => { document.getElementById('messageInput').value = SAMPLES[chip.dataset.sample] || ''; document.getElementById('charCount').textContent = document.getElementById('messageInput').value.length; }));

  document.getElementById('btnAnalyzeAnother')?.addEventListener('click', () => {
    document.getElementById('messageInput').value = ''; document.getElementById('charCount').textContent = '0'; document.getElementById('ocrPreview').textContent = ''; document.getElementById('ocrFileInput').value = '';
    document.getElementById('resultsSection').classList.remove('visible'); document.getElementById('homeSection').style.display = 'block'; document.getElementById('homeSection').scrollIntoView({ behavior: 'smooth' });
  });


  document.getElementById('btnClearAllHistory')?.addEventListener('click', clearAllHistory);

  document.getElementById('btnCopyReport')?.addEventListener('click', () => { 
    const reportText = document.getElementById('reportText').value;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(reportText)
        .then(() => showToast(t('copied')))
        .catch(() => {
          // Fallback: select and copy
          document.getElementById('reportText').select();
          document.execCommand('copy');
          showToast(t('copied'));
        });
    } else {
      // Fallback for older browsers
      document.getElementById('reportText').select();
      document.execCommand('copy');
      showToast(t('copied'));
    }
  });
  document.getElementById('btnShareReport')?.addEventListener('click', () => {
    const text = document.getElementById('reportText').value;
    if (navigator.share) { navigator.share({ title: 'Digital Safety Assistant', text, url: window.location.href }).then(() => showToast('Shared!')).catch(() => {}); }
    else { const m = document.createElement('div'); m.className = 'modal fade'; m.innerHTML = '<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5>Share</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p>Copy the report below and share.</p><textarea class="form-control" rows="8" id="shareReportCopy"></textarea></div></div></div>'; document.body.appendChild(m); m.querySelector('#shareReportCopy').value = text; const bs = bootstrap.Modal.getOrCreateInstance(m); bs.show(); m.addEventListener('hidden.bs.modal', () => { bs.dispose(); m.remove(); }); }
  });
  document.getElementById('btnDownloadReport')?.addEventListener('click', () => {
    if (!lastAnalysis) return;
    
    const ft = FRAUD_TYPES[lastAnalysis.fraudType] || FRAUD_TYPES.others;
    const timestamp = new Date(lastAnalysis.timestamp).toLocaleString();
    
    // Create PDF content HTML
    const pdfContent = `
      <div style="font-family: Arial, sans-serif; padding: 40px; color: #1e293b; position: relative;">
        <!-- Watermark -->
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 120px; font-weight: bold; color: rgba(220, 38, 38, 0.08); z-index: 0; white-space: nowrap; pointer-events: none;">
          SURAKSHA
        </div>
        
        <div style="position: relative; z-index: 1;">
          <!-- Header -->
          <div style="border-bottom: 3px solid #059669; padding-bottom: 20px; margin-bottom: 30px;">
            <h1 style="color: #059669; margin: 0; font-size: 32px;">🛡️ SURAKSHA</h1>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Digital Safety Assistant - Fraud Detection Report</p>
          </div>
          
          <!-- Report Metadata -->
          <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #0ea5e9;">
            <p style="margin: 5px 0;"><strong>Report Generated:</strong> ${timestamp}</p>
            <p style="margin: 5px 0;"><strong>Fraud Type Detected:</strong> ${ft.label}</p>
            <p style="margin: 5px 0;"><strong>Risk Level:</strong> ${lastAnalysis.risk.toUpperCase()}</p>
          </div>
          
          <!-- Key Metrics -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
            <div style="background: linear-gradient(135deg, #fee2e2, #fecaca); padding: 20px; border-radius: 8px; text-align: center;">
              <div style="font-size: 36px; font-weight: bold; color: #dc2626;">${lastAnalysis.score}%</div>
              <div style="color: #991b1b; font-weight: bold;">Scam Probability</div>
            </div>
            <div style="background: linear-gradient(135deg, #dbeafe, #bfdbfe); padding: 20px; border-radius: 8px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #0ea5e9;">${lastAnalysis.confidence}</div>
              <div style="color: #0369a1; font-weight: bold;">Confidence Level</div>
            </div>
          </div>
          
          <!-- Analyzed Message -->
          <div style="margin-bottom: 25px;">
            <h3 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;">📝 Analyzed Message</h3>
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #64748b; word-wrap: break-word;">
              "${lastAnalysis.text}"
            </div>
          </div>
          
          <!-- Why Flagged -->
          <div style="margin-bottom: 25px;">
            <h3 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;">⚠️ Why This Message Was Flagged</h3>
            <ul style="margin: 0; padding-left: 20px;">
              ${lastAnalysis.reasons.map(r => `<li style="margin: 8px 0; color: #475569;">${r}</li>`).join('')}
            </ul>
          </div>
          
          <!-- Risk Breakdown -->
          <div style="margin-bottom: 25px;">
            <h3 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;">📊 Risk Score Breakdown</h3>
            ${lastAnalysis.breakdown.map(b => {
              const barWidth = Math.min(100, (b.pts / 30) * 100);
              return `
                <div style="margin: 12px 0;">
                  <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-weight: bold; color: #1e293b;">${b.label}</span>
                    <span style="color: #059669; font-weight: bold;">+${b.pts}/30</span>
                  </div>
                  <div style="background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, #059669, #14b8a6); height: 100%; width: ${barWidth}%; border-radius: 4px;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          
          <!-- Safety Tips -->
          <div style="margin-bottom: 25px;">
            <h3 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px;">💡 Safety Tips</h3>
            <ul style="margin: 0; padding-left: 20px;">
              ${lastAnalysis.tips.map(tip => `<li style="margin: 8px 0; color: #475569;">${tip}</li>`).join('')}
            </ul>
          </div>
          
          <!-- Emergency Contact -->
          <div style="background: linear-gradient(135deg, #fecaca, #fca5a5); padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626; margin-bottom: 25px;">
            <h3 style="color: #991b1b; margin-top: 0;">🚨 If You Suspect Fraud</h3>
            <p style="margin: 10px 0; color: #7f1d1d;"><strong>Call Cybercrime Helpline:</strong> <span style="font-size: 18px; font-weight: bold;">1930</span></p>
            <p style="margin: 10px 0; color: #7f1d1d;"><strong>Report Online:</strong> <span style="font-family: monospace;">cybercrime.gov.in</span></p>
            <p style="margin: 10px 0; color: #7f1d1d;"><strong>Note:</strong> Never share OTP, PIN, or personal financial information via messages or links.</p>
          </div>
          
          <!-- Footer -->
          <div style="border-top: 2px solid #e2e8f0; padding-top: 20px; text-align: center; color: #64748b; font-size: 12px;">
            <p style="margin: 5px 0;">This report is generated by SURAKSHA Digital Safety Assistant</p>
            <p style="margin: 5px 0;">Keep yourself and your family safe from online fraud</p>
          </div>
        </div>
      </div>
    `;
    
    const element = document.createElement('div');
    element.innerHTML = pdfContent;
    
    const opt = {
      margin: [10, 10, 10, 10],
      filename: `fraud-report-${Date.now()}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    };
    
    html2pdf().set(opt).from(element).save();
    showToast('Report downloaded as PDF!');
  });

  // Login form handler
  document.getElementById('loginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('loginName').value.trim();
    const email = document.getElementById('loginEmail').value.trim();
    const mobile = document.getElementById('loginMobile').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    // Validate name (required)
    if (!name) {
      showToast('Please enter your name');
      return;
    }
    
    // Validate password (required, minimum 6 characters)
    if (!password) {
      showToast('Please enter a password');
      return;
    }
    
    if (password.length < 6) {
      showToast(t('invalidPassword'));
      return;
    }
    
    // Check that at least one of email or mobile is provided
    if (!email && !mobile) {
      showToast(t('emailOrMobileRequired'));
      return;
    }
    
    // Validate email format if email is provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address');
      return;
    }
    
    // Validate mobile format if mobile is provided
    if (mobile && !/^\d{10}$/.test(mobile)) {
      showToast('Please enter a valid 10-digit mobile number');
      return;
    }
    
    // Save user data to localStorage
    try {
      const userData = { name, email, mobile, loginTime: new Date().toISOString() };
      localStorage.setItem('suraksha_user', JSON.stringify(userData));
      
      showToast(`Welcome, ${name}!`);
      
      // Close the modal
      const loginModalEl = document.getElementById('loginModal');
      if (loginModalEl) {
        const loginModalInstance = bootstrap.Modal.getInstance(loginModalEl);
        if (loginModalInstance) {
          loginModalInstance.hide();
        }
      }
      
      // Reset form
      setTimeout(() => {
        document.getElementById('loginForm').reset();
        // Update login button text
        updateLoginButton(name);
      }, 200);
      
    } catch (error) {
      console.error('Error saving user data:', error);
      showToast('Error saving user data');
    }
  });

  // Load saved user data on startup
  loadUserData();

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
