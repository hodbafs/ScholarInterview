// BAFS Group Scholarship Interview Assessment Application Logic - Photo & Symmetrical Edition

(function () {
  'use strict';

  // Storage Key
  const STORAGE_KEY = 'BAFS_SCHOLARSHIP_ASSESSMENT_V15';
  const SYNC_CHANNEL_NAME = 'bafs_assessment_sync';

  // Application State (Default View: Dashboard as Home)
  let state = {
    candidates: [],
    activeCandidateId: '',
    currentCommitteeId: 'EM', // Default to EM
    viewMode: 'dashboard', // 'dashboard' (Home) | 'evaluator' | 'comparison' | 'candidates'
    evaluations: {}, // { [candId]: { [commId]: { scores: {}, strengths: '', weaknesses: '', commitment: '', comments: '', verdict: '', evaluatorName: '', date: '', isSubmitted: false, updatedAt: 0 } } }
    serverConnected: false
  };

  // Broadcast Channel for Multi-Tab Sync
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      syncChannel.onmessage = function (event) {
        if (event && event.data && event.data.type === 'STATE_UPDATE') {
          handleRemoteStateUpdate(event.data.payload);
        }
      };
    }
  } catch (e) {
    console.warn('BroadcastChannel not supported or error:', e);
  }

  // Chart instances
  let radarChartInstance = null;
  let barChartInstance = null;

  // Main Initialize Function
  function init() {
    try {
      // 1. Always ensure candidates are loaded fresh from official data.js
      if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.defaultCandidates) {
        state.candidates = JSON.parse(JSON.stringify(window.ASSESSMENT_DATA.defaultCandidates));
      }

      // 2. Load and merge evaluations from all previous storage versions
      loadStateFromStorage();

      // 3. Ensure an active candidate exists
      if ((!state.activeCandidateId || !state.candidates.some(function (c) { return c.id === state.activeCandidateId; })) && state.candidates.length > 0) {
        state.activeCandidateId = state.candidates[0].id;
      }

      // 4. Default landing page is Dashboard
      if (!state.viewMode) {
        state.viewMode = 'dashboard';
      }

      // 5. Check server connection
      checkServerConnection();

      // 6. Initial Render
      renderCommitteeNav();
      renderCandidateSelector();
      updateView();

      // 7. Setup window listeners
      setupEventListeners();

      // 8. Auto-sync with Google Sheets (Real-Time 2-Way Cloud Sync)
      startGoogleSheetsAutoSync();

      // 9. Poll local server if active
      setInterval(pollServerState, 3000);
    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  // Load from Storage with Complete Multi-Version Bridge & Evaluation Merger
  function loadStateFromStorage() {
    try {
      if (!state.evaluations) {
        state.evaluations = {};
      }

      // Search all previous keys in reverse chronological order and merge all evaluations
      var allKeys = [
        'BAFS_SCHOLARSHIP_ASSESSMENT',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V1',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V2',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V3',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V4',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V5',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V6',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V7',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V8',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V9',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V10',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V11',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V12',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V13',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V14',
        'BAFS_SCHOLARSHIP_ASSESSMENT_V15',
        STORAGE_KEY
      ];

      allKeys.forEach(function (k) {
        var raw = localStorage.getItem(k);
        if (raw) {
          try {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.evaluations) {
              // Merge evaluations
              Object.keys(parsed.evaluations).forEach(function (cKey) {
                if (!state.evaluations[cKey]) {
                  state.evaluations[cKey] = {};
                }
                var comObj = parsed.evaluations[cKey];
                Object.keys(comObj).forEach(function (commId) {
                  var incoming = comObj[commId];
                  var existing = state.evaluations[cKey][commId];
                  if (!existing || (incoming.updatedAt && incoming.updatedAt > (existing.updatedAt || 0))) {
                    state.evaluations[cKey][commId] = incoming;
                  }
                });
              });
            }
            if (parsed.currentCommitteeId) {
              state.currentCommitteeId = parsed.currentCommitteeId;
            }
          } catch (e) {}
        }
      });

      // Normalize candidate keys so both "cand-1", "cand-2", "cand-3", "cand-4" and "1", "2", "3", "4" map together
      for (var i = 1; i <= 4; i++) {
        var candId = 'cand-' + i;
        var numId = String(i);
        var evCandidate = state.evaluations[candId] || state.evaluations[numId] || {};
        state.evaluations[candId] = evCandidate;
        state.evaluations[numId] = evCandidate;
      }

    } catch (e) {
      console.warn('Failed to load state from localStorage:', e);
    }
  }

  // Save State
  function saveState(broadcast, syncGSheets) {
    if (broadcast === undefined) broadcast = true;
    if (syncGSheets === undefined) syncGSheets = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        candidates: state.candidates,
        activeCandidateId: state.activeCandidateId,
        evaluations: state.evaluations,
        currentCommitteeId: state.currentCommitteeId
      }));

      if (broadcast && syncChannel) {
        syncChannel.postMessage({
          type: 'STATE_UPDATE',
          payload: {
            candidates: state.candidates,
            activeCandidateId: state.activeCandidateId,
            evaluations: state.evaluations,
            senderCommittee: state.currentCommitteeId,
            timestamp: Date.now()
          }
        });
      }

      syncToServer();

      if (syncGSheets) {
        syncToGoogleSheets(true);
      }
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }

  function handleRemoteStateUpdate(payload) {
    if (!payload) return;
    var changed = false;

    if (payload.evaluations) {
      // Smart merge: only update entries that are newer (by updatedAt timestamp)
      Object.keys(payload.evaluations).forEach(function (candKey) {
        if (!state.evaluations[candKey]) {
          state.evaluations[candKey] = {};
          changed = true;
        }
        var commMap = payload.evaluations[candKey];
        Object.keys(commMap).forEach(function (commId) {
          var incoming = commMap[commId];
          var existing = state.evaluations[candKey][commId];

          var isCurrentActiveComm = (commId === state.currentCommitteeId);

          if (incoming.isSubmitted) {
            // Incoming submitted assessment wins over local unsubmitted
            if (existing && existing.isSubmitted && existing.updatedAt && incoming.updatedAt && existing.updatedAt > incoming.updatedAt) {
              return; // Local submitted is newer
            }
          } else {
            // Incoming is not submitted: protect active committee draft
            if (isCurrentActiveComm) {
              return;
            }
          }

          if (!existing || (incoming.updatedAt && incoming.updatedAt > (existing.updatedAt || 0)) || (incoming.isSubmitted && (!existing.isSubmitted))) {
            state.evaluations[candKey][commId] = incoming;
            changed = true;
          }
        });
      });
    }
    if (payload.candidates && JSON.stringify(state.candidates) !== JSON.stringify(payload.candidates)) {
      state.candidates = payload.candidates;
      changed = true;
    }

    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        candidates: state.candidates,
        activeCandidateId: state.activeCandidateId,
        evaluations: state.evaluations,
        currentCommitteeId: state.currentCommitteeId
      }));

      if (state.viewMode === 'dashboard') {
        renderDashboard();
      } else if (state.viewMode === 'comparison') {
        renderComparisonView();
      } else if (state.viewMode === 'evaluator') {
        renderEvaluatorForm(false);
      }
      renderCandidateSelector();
      renderCommitteeNav();
      showSyncIndicator();
    }
  }

  // Backend Sync
  async function checkServerConnection() {
    try {
      var ts = new Date().getTime();
      var res = await fetch('/api/state?_t=' + ts, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        var data = await res.json();
        state.serverConnected = true;
        updateConnectionBadge(true);
        if (data && data.evaluations) {
          handleRemoteStateUpdate(data);
        }
      } else {
        state.serverConnected = false;
        updateConnectionBadge(false);
      }
    } catch (e) {
      state.serverConnected = false;
      updateConnectionBadge(false);
    }
  }

  async function pollServerState() {
    if (!state.serverConnected) return;
    try {
      var ts = new Date().getTime();
      var res = await fetch('/api/state?_t=' + ts, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        var data = await res.json();
        if (data && data.timestamp) {
          handleRemoteStateUpdate(data);
        }
      }
    } catch (e) {
      // offline
    }
  }

  async function syncToServer() {
    if (!state.serverConnected) return;
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: state.candidates,
          activeCandidateId: state.activeCandidateId,
          evaluations: state.evaluations,
          timestamp: Date.now()
        })
      });
    } catch (e) {
      // silent
    }
  }

  function updateConnectionBadge(isConnected) {
    var badge = document.getElementById('connection-status-badge');
    if (!badge) return;
    if (isConnected) {
      badge.innerHTML = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> โหมดเน็ตเวิร์ก (Live Server)</span>';
    } else {
      badge.innerHTML = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 shadow-sm"><span class="w-2 h-2 rounded-full bg-blue-500"></span> โหมด Real-time (Broadcast Sync)</span>';
    }
  }

  function showSyncIndicator() {
    var syncDot = document.getElementById('sync-indicator');
    if (syncDot) {
      syncDot.classList.add('ring-2', 'ring-emerald-400', 'bg-emerald-100');
      setTimeout(function () {
        syncDot.classList.remove('ring-2', 'ring-emerald-400', 'bg-emerald-100');
      }, 800);
    }
  }

  // 9-Box Grid Widget Generator
  function render9BoxGridWidget(activeRow, activeCol, gridType) {
    var rPos = (activeRow !== undefined && activeRow !== null) ? activeRow : 0;
    var cPos = (activeCol !== undefined && activeCol !== null) ? activeCol : 2;
    var type = gridType || 'Future Leader';

    var cellsHtml = '';
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var isActive = (r === rPos && c === cPos);
        var activeClass = '';
        if (isActive) {
          activeClass = (type === 'Future Leader') ? 'active-green' : 'active-blue';
        }
        cellsHtml += '<div class="cell-9box ' + activeClass + '" title="Row ' + (r + 1) + ', Col ' + (c + 1) + '"></div>';
      }
    }
    return (
      '<div class="flex flex-col items-center">' +
      '<div class="grid-9box shadow-inner">' + cellsHtml + '</div>' +
      '<span class="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-wider">9-Box Grid</span>' +
      '</div>'
    );
  }

  // Navigation and Views
  function setView(mode, committeeId) {
    state.viewMode = mode;
    if (committeeId) {
      state.currentCommitteeId = committeeId;
    }
    renderCommitteeNav();
    updateView();
    saveState(true);
  }

  function updateView() {
    var evalView = document.getElementById('view-evaluator');
    var dashView = document.getElementById('view-dashboard');
    var compView = document.getElementById('view-comparison');
    var adminView = document.getElementById('view-admin') || document.getElementById('view-candidates');
    var banner = document.getElementById('candidate-profile-banner');
    var btnAdmin = document.getElementById('btn-nav-admin');

    if (evalView) evalView.classList.add('hidden');
    if (dashView) dashView.classList.add('hidden');
    if (compView) compView.classList.add('hidden');
    if (adminView) adminView.classList.add('hidden');
    if (banner) banner.classList.add('hidden');

    if (btnAdmin) {
      if (state.viewMode === 'admin' || state.viewMode === 'candidates') {
        btnAdmin.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-slate-900 shadow-md shadow-slate-900/30 ring-2 ring-slate-800 ring-offset-1 transition-all group';
      } else {
        btnAdmin.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100/90 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 transition-all shadow-xs group';
      }
    }

    if (state.viewMode === 'dashboard') {
      if (dashView) dashView.classList.remove('hidden');
      renderDashboard();
    } else if (state.viewMode === 'admin' || state.viewMode === 'candidates') {
      if (!isAdminAuthenticated()) {
        state.viewMode = 'dashboard';
        if (dashView) dashView.classList.remove('hidden');
        renderDashboard();
        openAdminLoginModal();
        return;
      }
      if (adminView) adminView.classList.remove('hidden');
      renderAdminControlCenter();
    } else if (state.viewMode === 'comparison') {
      if (compView) compView.classList.remove('hidden');
      renderComparisonView();
    } else {
      var currentCand = state.candidates.find(function (c) { return c.id === state.activeCandidateId; }) || state.candidates[0];
      if (banner) {
        banner.classList.remove('hidden');
        renderCandidateCardBanner(currentCand);
      }
      if (evalView) evalView.classList.remove('hidden');
      renderEvaluatorForm(true);
    }
  }

  // Render Top Sub-Navigation (Home Dashboard + Committees)
  function renderCommitteeNav() {
    var nav = document.getElementById('committee-nav-buttons');
    if (!nav || !window.ASSESSMENT_DATA) return;

    var html = '';

    // 1. HOME DASHBOARD BUTTON (Distinctive Executive Hub Style)
    var isDashActive = (state.viewMode === 'dashboard');
    var dashClass = isDashActive
      ? 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-lg shadow-slate-900/30 ring-2 ring-indigo-400 ring-offset-1 font-black border border-indigo-500/50'
      : 'bg-indigo-50/70 hover:bg-indigo-100 text-indigo-950 border border-indigo-200/80 font-bold shadow-2xs';

    html += '<button type="button" onclick="window.app.selectDashboard()" class="h-10 whitespace-nowrap w-full flex items-center justify-center gap-1.5 px-2 rounded-2xl text-xs md:text-sm transition-all duration-200 ' + dashClass + '" title="หน้าหลัก - Dashboard ภาพรวม">' +
      '<span class="text-sm md:text-base leading-none">🏠</span>' +
      '<span class="font-bold tracking-tight">Dashboard</span>' +
      '</button>';

    // 2. COMMITTEE BUTTONS (Exact Match with Screenshot Emojis)
    var committeeIcons = {
      'EM': '👔',
      'MD-BPT': '⛽',
      'MD-TARCO': '✈️',
      'MD-BPS': '⚡',
      'HZ': '💡'
    };

    window.ASSESSMENT_DATA.committees.forEach(function (c) {
      var isActive = (state.viewMode === 'evaluator' && state.currentCommitteeId === c.id);
      var evalStatus = getCommitteeSubmissionStatus(state.activeCandidateId, c.id);

      var statusIcon = '';
      if (evalStatus === 'SUBMITTED') {
        statusIcon = '<span class="w-2 h-2 rounded-full bg-emerald-500 ml-1.5 flex-shrink-0 shadow-xs" title="ประเมินเรียบร้อย"></span>';
      }

      var activeClass = isActive
        ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-500 ring-offset-1 font-bold'
        : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 font-bold shadow-2xs';

      var icon = committeeIcons[c.id] || '👤';

      html += '<button type="button" onclick="window.app.selectCommittee(\'' + c.id + '\')" class="h-10 whitespace-nowrap w-full flex items-center justify-center gap-1.5 px-2 rounded-2xl text-xs md:text-sm transition-all duration-200 ' + activeClass + '" title="กรรมการ ' + c.name + '">' +
        '<span class="text-sm md:text-base leading-none">' + icon + '</span>' +
        '<span class="font-bold">' + c.name + '</span>' + statusIcon + '</button>';
    });

    nav.innerHTML = html;
  }

  function getCommitteeSubmissionStatus(candId, commId) {
    if (!state.evaluations[candId] || !state.evaluations[candId][commId]) return 'EMPTY';
    var ev = state.evaluations[candId][commId];
    if (ev.isSubmitted) return 'SUBMITTED';
    var scoreKeys = Object.keys(ev.scores || {});
    if (scoreKeys.length > 0 || ev.strengths || ev.verdict) return 'IN_PROGRESS';
    return 'EMPTY';
  }

  // Render Candidate State and Banners
  function renderCandidateSelector() {
    var container = document.getElementById('candidate-selector-container');
    if (container) {
      container.innerHTML = '';
    }

    var currentCand = state.candidates ? (state.candidates.find(function (c) { return c.id === state.activeCandidateId; }) || state.candidates[0]) : null;
    renderCandidateCardBanner(currentCand);
  }

  // Render 4 Candidate Cards Grid (for Evaluator form across all committee pages)
  function renderCandidateCardBanner(cand) {
    var banner = document.getElementById('candidate-profile-banner');
    if (!banner || !state.candidates || state.candidates.length === 0) return;

    var commId = state.currentCommitteeId || 'EM';
    var committees = window.ASSESSMENT_DATA ? (window.ASSESSMENT_DATA.committees || []) : [];
    var commInfo = committees.find(function (c) { return c.id === commId; }) || { id: 'EM', name: 'EM' };

    var candidateCards = state.candidates.map(function (c, idx) {
      var isCurrent = (c.id === state.activeCandidateId);
      var isFutureLeader = (c.nineBoxGrid === 'Future Leader');
      var badgeColor = isFutureLeader
        ? (isCurrent ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-emerald-100 text-emerald-800')
        : (isCurrent ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30' : 'bg-blue-100 text-blue-800');

      var candEvals = state.evaluations[c.id] || {};
      var myEval = candEvals[commId] || { scores: {} };
      var myTotals = window.ASSESSMENT_DATA ? window.ASSESSMENT_DATA.calculateTotalScores(myEval.scores || {}) : { weightedTotal: 0, rawTotal: 0 };
      var isEvaluated = (myTotals.rawTotal > 0 || myEval.isSubmitted);

      var containerCls = isCurrent
        ? 'bg-slate-900 border-2 border-blue-500 ring-4 ring-blue-500/30 shadow-2xl text-white rounded-2xl p-4 flex flex-col justify-between transition-all h-full relative transform -translate-y-1'
        : 'bg-white border border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md text-slate-800 rounded-2xl p-4 flex flex-col justify-between transition-all h-full relative';

      var courseBox = isCurrent
        ? '<div class="h-[54px] flex flex-col justify-center bg-white/10 px-3 rounded-xl border border-white/10 text-xs">' +
          '<span class="text-blue-300 text-[10px] leading-none mb-0.5 font-medium">หลักสูตร:</span>' +
          '<span class="font-semibold text-slate-100 leading-tight line-clamp-2" title="' + (c.programName || c.degreeLevel) + '">' + (c.programName || c.degreeLevel) + '</span>' +
          '</div>'
        : '<div class="h-[54px] flex flex-col justify-center bg-blue-50/50 px-3 rounded-xl border border-blue-100/60 text-xs">' +
          '<span class="text-slate-400 text-[10px] leading-none mb-0.5">หลักสูตร:</span>' +
          '<span class="font-semibold text-slate-800 leading-tight line-clamp-2" title="' + (c.programName || c.degreeLevel) + '">' + (c.programName || c.degreeLevel) + '</span>' +
          '</div>';

      var scoreBox = isCurrent
        ? '<div class="h-[56px] p-2.5 rounded-xl bg-blue-600 text-white text-xs flex items-center justify-between shadow-sm border border-blue-400/40">' +
          '<div>' +
          '<span class="text-[10px] text-blue-100 block font-medium">คะแนนของกรรมการ ' + commInfo.name + '</span>' +
          '<span class="text-xl font-black text-white">' + myTotals.weightedTotal.toFixed(2) + '</span>' +
          '<span class="text-[10px] text-blue-200"> / 100</span>' +
          '</div>' +
          '<div class="text-right">' +
          '<span class="text-[10px] text-blue-100 block font-medium">มติของคุณ</span>' +
          '<span class="font-bold ' + (myEval.verdict === 'PASS' ? 'text-emerald-300' : myEval.verdict === 'FAIL' ? 'text-rose-300' : 'text-slate-200') + '">' +
          (myEval.verdict === 'PASS' ? '✓ ผ่าน' : myEval.verdict === 'FAIL' ? '✕ ไม่ผ่าน' : 'ยังไม่ระบุ') +
          '</span>' +
          '</div>' +
          '</div>'
        : '<div class="h-[56px] p-2.5 rounded-xl bg-slate-900 text-white text-xs flex items-center justify-between shadow-sm">' +
          '<div>' +
          '<span class="text-[10px] text-blue-300 block">คะแนนของกรรมการ ' + commInfo.name + '</span>' +
          '<span class="text-xl font-black text-white">' + myTotals.weightedTotal.toFixed(2) + '</span>' +
          '<span class="text-[10px] text-blue-300"> / 100</span>' +
          '</div>' +
          '<div class="text-right">' +
          '<span class="text-[10px] text-blue-300 block">มติของคุณ</span>' +
          '<span class="font-bold ' + (myEval.verdict === 'PASS' ? 'text-emerald-400' : myEval.verdict === 'FAIL' ? 'text-rose-400' : 'text-slate-400') + '">' +
          (myEval.verdict === 'PASS' ? '✓ ผ่าน' : myEval.verdict === 'FAIL' ? '✕ ไม่ผ่าน' : 'ยังไม่ระบุ') +
          '</span>' +
          '</div>' +
          '</div>';

      return '<div class="' + containerCls + '">' +
        // Active indicator badge
        (isCurrent ? '<div class="absolute -top-3.5 left-1/2 transform -translate-x-1/2 z-10"><span class="px-3.5 py-1 rounded-full text-[11px] font-black bg-blue-600 text-white shadow-lg border border-blue-400/50 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> กำลังประเมิน</span></div>' : '') +
        
        '<div class="space-y-3 cursor-pointer" onclick="window.app.changeActiveCandidate(\'' + c.id + '\')">' +
        
        // 1. Header: Large Prominent Photo Banner with Gradient Overlay & Status
        '<div class="relative rounded-2xl overflow-hidden mb-3 bg-gradient-to-b from-slate-100 to-slate-200 border ' + (isCurrent ? 'border-slate-700' : 'border-slate-200') + ' shadow-inner group">' +
        '<div class="w-full h-52 relative overflow-hidden bg-slate-900">' +
        (c.photoUrl
          ? '<img src="' + c.photoUrl + '" alt="' + c.name + '" class="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300" />'
          : '<div class="w-full h-full bg-gradient-to-br ' + (c.avatarColor || 'from-blue-600 to-indigo-700') + ' flex items-center justify-center text-white text-4xl font-black">' + (c.name ? c.name.charAt(0) : (idx + 1)) + '</div>') +
        '<div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-transparent"></div>' +
        '<div class="absolute top-2.5 left-2.5">' +
        '<span class="inline-flex items-center text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-white/90 backdrop-blur-md text-slate-900 shadow-sm">ลำดับที่ ' + (idx + 1) + '</span>' +
        '</div>' +
        '<div class="absolute top-2.5 right-2.5">' +
        '<span class="inline-flex items-center text-[10px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-md ' + (myEval.isSubmitted ? 'bg-emerald-500/90 text-white shadow-sm' : (isEvaluated ? 'bg-blue-500/90 text-white shadow-sm' : 'bg-slate-900/80 text-white')) + '">' +
        (myEval.isSubmitted ? '✅ ประเมินแล้ว' : (isEvaluated ? '✏️ กำลังให้คะแนน' : '⏳ รอประเมิน')) +
        '</span>' +
        '</div>' +
        '<div class="absolute inset-x-0 bottom-0 p-3 text-white">' +
        '<h3 class="font-bold text-sm sm:text-base leading-tight truncate group-hover:text-blue-300 transition-colors drop-shadow-sm" title="' + c.name + '">' + c.name + '</h3>' +
        '<p class="text-[11px] text-blue-200/90 truncate mt-0.5" title="' + (c.nameEn || '') + '">' + (c.nameEn || '') + '</p>' +
        '</div>' +
        '</div>' +
        '</div>' +

        // 2. Badges: 9-Box & Tenure
        '<div class="h-6 flex items-center justify-between">' +
        '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ' + badgeColor + ' truncate max-w-[140px]">' +
        (c.nineBoxGrid || 'Future Leader') +
        '</span>' +
        '<span class="text-[11px] font-semibold ' + (isCurrent ? 'text-slate-300 bg-white/10 border border-white/10' : 'text-slate-500 bg-slate-100') + ' px-2 py-0.5 rounded-md whitespace-nowrap">' +
        'อายุงาน ' + (c.tenure || '-') + '</span>' +
        '</div>' +

        // 3. Course & Institute Box
        courseBox +

        // 4. Committee Live Score Box
        scoreBox +

        '</div>' +

        // 5. Action Buttons (Grid 2 buttons)
        '<div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t ' + (isCurrent ? 'border-white/10' : 'border-slate-100') + '">' +
        '<button type="button" onclick="window.app.openOnePageModal(\'' + c.id + '\')" class="py-2 rounded-xl text-xs font-bold ' + (isCurrent ? 'bg-white/15 hover:bg-white/25 text-white border border-white/20 shadow-sm' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200') + ' flex items-center justify-center gap-1 transition-all" title="ดูสรุป One-Page">' +
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>' +
        '<span>One-Page</span>' +
        '</button>' +
        (isCurrent
          ? '<button type="button" class="py-2 rounded-xl text-xs font-bold bg-blue-600 text-white shadow-md shadow-blue-500/30 border border-blue-400/40 flex items-center justify-center gap-1 cursor-default"><span>📍 กำลังประเมิน</span></button>'
          : '<button type="button" onclick="window.app.changeActiveCandidate(\'' + c.id + '\')" class="py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 border border-slate-200 hover:border-blue-600 flex items-center justify-center gap-1 transition-all"><span>👉 เลือกประเมิน</span></button>') +
        '</div>' +
        '</div>';
    }).join('');

    banner.innerHTML = '<div class="mb-6">' +
      '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="text-sm md:text-base font-black text-slate-800 flex items-center gap-2">' +
      '<span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span>' +
      '<span>ผู้ขอรับทุนการศึกษาทั้ง 4 ท่าน (คลิกการ์ดเพื่อสลับประเมินทันที):</span>' +
      '</h3>' +
      '<span class="text-xs text-slate-500 hidden sm:inline">สลับผู้สมัครได้ตลอดเวลา</span>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">' +
      candidateCards +
      '</div>' +
      '</div>';
  }

  // ==========================================
  // CANDIDATE ONE-PAGE POP-UP MODAL ENGINE
  // ==========================================
    var modalCommChartInstance = null;
  var modalRadarChartInstance = null;

  function renderCandidateModalCharts(candId, commDetails, radarScores) {
    var ctx1 = document.getElementById('candidate-comm-chart');
    var ctx2 = document.getElementById('candidate-radar-chart');
    if (typeof Chart === 'undefined') return;

    if (modalCommChartInstance) {
      modalCommChartInstance.destroy();
      modalCommChartInstance = null;
    }
    if (modalRadarChartInstance) {
      modalRadarChartInstance.destroy();
      modalRadarChartInstance = null;
    }

    // 1. Committee Scores Bar Chart with Threshold Reference Line
    if (ctx1) {
      var commLabels = commDetails.map(function (d) { return d.comm.name; });
      var commScores = commDetails.map(function (d) { return d.weightedTotal; });
      var commColors = commDetails.map(function (d) {
        if (d.verdict === 'PASS') return 'rgba(16, 185, 129, 0.85)';
        if (d.verdict === 'FAIL') return 'rgba(244, 63, 94, 0.85)';
        return 'rgba(59, 130, 246, 0.85)';
      });

      modalCommChartInstance = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: commLabels,
          datasets: [{
            label: 'คะแนนที่ได้ (เต็ม 100)',
            data: commScores,
            backgroundColor: commColors,
            borderRadius: 10,
            borderWidth: 0,
            barThickness: 42
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' คะแนน: ' + ctx.raw.toFixed(2) + ' / 100 คะแนน';
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              grid: { color: 'rgba(241, 245, 249, 1)' },
              ticks: { font: { size: 10, family: 'Prompt, sans-serif' } }
            },
            x: {
              grid: { display: false },
              ticks: { font: { size: 11, weight: 'bold', family: 'Prompt, sans-serif' } }
            }
          }
        }
      });
    }

    // 2. 6-Dimension Competency Radar Chart
    if (ctx2 && radarScores) {
      var radarLabels = ['1. กลยุทธ์ (25%)', '2. ความผูกพัน (25%)', '3. เป้าหมาย (15%)', '4. ภาวะผู้นำ (15%)', '5. การวางแผน (10%)', '6. มีส่วนร่วม (10%)'];

      modalRadarChartInstance = new Chart(ctx2, {
        type: 'radar',
        data: {
          labels: radarLabels,
          datasets: [{
            label: 'ระดับความพร้อม (เต็ม 5.0)',
            data: radarScores,
            backgroundColor: 'rgba(79, 70, 229, 0.25)',
            borderColor: 'rgba(79, 70, 229, 0.95)',
            borderWidth: 2.5,
            pointBackgroundColor: '#4f46e5',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#4f46e5',
            pointRadius: 4.5,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ' คะแนนเฉลี่ย: ' + ctx.raw.toFixed(2) + ' / 5.0';
                }
              }
            }
          },
          scales: {
            r: {
              min: 0,
              max: 5,
              ticks: {
                stepSize: 1,
                display: false
              },
              grid: {
                color: 'rgba(226, 232, 240, 0.8)'
              },
              angleLines: {
                color: 'rgba(226, 232, 240, 0.8)'
              },
              pointLabels: {
                font: {
                  size: 10,
                  weight: 'bold',
                  family: 'Prompt, sans-serif'
                },
                color: '#334155'
              }
            }
          }
        }
      });
    }
  }

  function openOnePageModal(candidateId, activeTab) {
    var candId = candidateId || state.activeCandidateId;
    var cand = state.candidates.find(function (c) { return c.id === candId; }) || state.candidates[0];
    if (!cand) return;

    var isEvaluator = (state.viewMode === 'evaluator');
    var currentTab = isEvaluator ? 'profile' : (activeTab || 'assessment');

    var modal = document.getElementById('candidate-onepage-modal');
    var card = document.getElementById('onepage-modal-card');
    var headerEl = document.getElementById('modal-header-content');
    var bodyEl = document.getElementById('modal-body-content');
    var tabsEl = document.getElementById('modal-candidate-tabs');

    if (!modal || !card || !headerEl || !bodyEl) return;

    var isFutureLeader = (cand.nineBoxGrid === 'Future Leader');
    var gridBadgeColor = isFutureLeader ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' : 'bg-blue-500/20 text-blue-300 border-blue-400/40';
    var nineBoxWidgetHtml = render9BoxGridWidget(cand.nineBoxRow, cand.nineBoxCol, cand.nineBoxGrid);

    var photoHtml = cand.photoUrl
      ? '<img src="' + cand.photoUrl + '" alt="' + cand.name + '" class="w-16 h-20 rounded-2xl object-cover object-top border-2 border-white/40 shadow-lg flex-shrink-0" />'
      : '<div class="w-16 h-20 rounded-2xl bg-gradient-to-br ' + (cand.avatarColor || 'from-blue-600 to-indigo-700') + ' border border-white/20 text-white font-black text-2xl flex items-center justify-center shadow-md flex-shrink-0">' + (cand.name ? cand.name.charAt(0) : 'C') + '</div>';

    // 1. Header with Tab Buttons
    headerEl.innerHTML = '<div class="flex flex-col gap-4">' +
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
      '<div class="flex items-center gap-3.5">' +
      photoHtml +
      '<div>' +
      '<div class="flex items-center gap-2 flex-wrap">' +
      '<h2 class="text-xl font-bold text-white tracking-wide">' + cand.name + '</h2>' +
      (cand.nameEn ? '<span class="text-sm text-blue-300 font-medium">(' + cand.nameEn + ')</span>' : '') +
      '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold ' + gridBadgeColor + ' border">' +
      '9-Box: ' + (cand.nineBoxGrid || 'Future Leader') +
      '</span>' +
      '</div>' +
      '<p class="text-xs text-slate-300 mt-1 flex items-center gap-2 flex-wrap">' +
      '<span class="font-medium text-white">' + (cand.position || '-') + '</span>' +
      '<span class="text-blue-400">•</span>' +
      '<span class="text-blue-200 font-bold">' + (cand.department || cand.company || '-') + '</span>' +
      '<span class="text-blue-400">•</span>' +
      '<span>อายุงาน ' + (cand.tenure || '-') + '</span>' +
      '<span class="text-blue-400">•</span>' +
      '<span class="text-slate-300">' + (cand.disciplinary || 'ไม่เคยได้รับโทษทางวินัย') + '</span>' +
      '</p>' +
      '</div>' +
      '</div>' +
      '<div class="hidden sm:block flex-shrink-0 bg-white/5 p-2 rounded-xl border border-white/10">' +
      nineBoxWidgetHtml +
      '</div>' +
      '</div>' +

      // Top Tab Navigation (Hidden Assessment Summary for the 5 Committee Evaluators)
      (isEvaluator
        ? ('<div class="flex items-center gap-2 pt-2 border-t border-blue-900/40">' +
           '<span class="text-xs font-bold text-blue-200 flex items-center gap-1.5 bg-blue-900/40 px-3 py-1.5 rounded-xl border border-blue-800/50">' +
           '<span>📄</span> <span>ข้อมูลประกอบการพิจารณาของผู้ขอรับทุน (One-Page Profile)</span>' +
           '</span>' +
           '</div>')
        : ('<div class="flex items-center gap-2 pt-2 border-t border-blue-900/40">' +
           '<button type="button" onclick="window.app.openOnePageModal(\'' + cand.id + '\', \'assessment\')" class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ' +
           (currentTab === 'assessment' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40' : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white') + '">' +
           '<span>📊 สรุปผลการประเมิน (Assessment Dashboard)</span>' +
           '</button>' +
           '<button type="button" onclick="window.app.openOnePageModal(\'' + cand.id + '\', \'profile\')" class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ' +
           (currentTab === 'profile' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/40' : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white') + '">' +
           '<span>📄 ข้อมูลผู้สมัคร (One-Page Profile)</span>' +
           '</button>' +
           '</div>')
      ) +
      '</div>';

    // 2. Render Body Content based on Active Tab
    if (currentTab === 'assessment') {
      // Build Assessment Summary Dashboard for this candidate
      var committees = window.ASSESSMENT_DATA.committees;
      var cEvals = state.evaluations[cand.id] || {};
      
      var totalWeightedScore = 0;
      var passCount = 0;
      var failCount = 0;
      var submittedCount = 0;
      var evaluatedCommCount = 0;
      var commDetails = [];

      committees.forEach(function (comm) {
        var ev = cEvals[comm.id] || { scores: {} };
        var totals = window.ASSESSMENT_DATA.calculateTotalScores(ev.scores || {});
        totalWeightedScore += totals.weightedTotal;
        if (totals.weightedTotal > 0) evaluatedCommCount++;
        if (ev.verdict === 'PASS') passCount++;
        if (ev.verdict === 'FAIL') failCount++;
        if (ev.isSubmitted) submittedCount++;

        commDetails.push({
          comm: comm,
          scores: ev.scores || {},
          weightedTotal: totals.weightedTotal,
          rawTotal: totals.rawTotal,
          verdict: ev.verdict,
          strengths: ev.strengths || '',
          weaknesses: ev.weaknesses || '',
          commitment: ev.commitment || '',
          comments: ev.comments || '',
          isSubmitted: ev.isSubmitted
        });
      });

      var avgScore = evaluatedCommCount > 0 ? Number((totalWeightedScore / evaluatedCommCount).toFixed(2)) : 0;
      var isPass = (passCount === 5);

      // Individual committee verdicts breakdown (Prominent Cards with score & status pill)
      var commVerdictsHtml = commDetails.map(function (d) {
        var isP = (d.verdict === 'PASS');
        var isF = (d.verdict === 'FAIL');
        var cardBg = isP
          ? 'bg-gradient-to-b from-emerald-50/90 to-emerald-100/50 border-emerald-200 shadow-2xs ring-1 ring-emerald-400/20'
          : (isF ? 'bg-gradient-to-b from-rose-50/90 to-rose-100/50 border-rose-200 shadow-2xs ring-1 ring-rose-400/20' : 'bg-slate-50 border-slate-200');
        var badgeBg = isP
          ? 'bg-emerald-500 text-white font-black shadow-2xs'
          : (isF ? 'bg-rose-500 text-white font-black shadow-2xs' : 'bg-slate-200 text-slate-700 font-bold');
        var label = isP ? '✓ ผ่าน' : (isF ? '✕ ไม่ผ่าน' : '⏳ รอ');
        var scoreText = d.weightedTotal > 0 ? (d.weightedTotal.toFixed(1) + ' คะแนน') : '-';

        return '<div class="flex flex-col items-center justify-between p-2.5 rounded-2xl border ' + cardBg + ' text-center transition-all hover:scale-102">' +
          '<div class="w-full">' +
          '<span class="text-xs font-black text-slate-900 leading-tight block truncate" title="' + (d.comm.fullName || d.comm.name) + '">' + d.comm.name + '</span>' +
          '<span class="text-[10px] font-bold text-slate-500 block mt-0.5">' + scoreText + '</span>' +
          '</div>' +
          '<span class="w-full py-1 px-1 rounded-xl text-[11px] font-black ' + badgeBg + ' block mt-2 leading-none text-center">' + label + '</span>' +
          '</div>';
      }).join('');

      // Top Key Metric Cards (2 : 4 Ratio Layout: Left 33.3% (2/6), Right 66.7% (4/6) - High Prominence)
      var metricsRowHtml = '<div class="grid grid-cols-1 md:grid-cols-6 gap-4">' +
        // Left Card: 2 cols
        '<div class="md:col-span-2 bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 text-white p-5 rounded-3xl shadow-md border border-blue-800/60 flex flex-col justify-center relative overflow-hidden">' +
        '<div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-blue-500/10 blur-xl pointer-events-none"></div>' +
        '<div>' +
        '<span class="text-xs text-blue-300 font-black uppercase tracking-wider block">คะแนนเฉลี่ยถ่วงน้ำหนัก</span>' +
        '<div class="flex items-baseline gap-2 mt-2">' +
        '<span class="text-4xl font-black text-white tracking-tight drop-shadow-sm">' + avgScore.toFixed(2) + '</span>' +
        '<span class="text-xs text-blue-200 font-semibold">/ 100 คะแนน</span>' +
        '</div>' +
        '<span class="text-[11px] text-blue-300/80 block mt-1.5 font-medium">ค่าน้ำหนักรวมเกณฑ์ 6 ข้อ</span>' +
        '</div>' +
        '</div>' +

        // Right Card: 4 cols
        '<div class="md:col-span-4 bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col justify-between">' +
        '<div>' +
        '<div class="flex items-center justify-between pb-2.5 border-b border-slate-100 mb-3">' +
        '<div class="flex items-center gap-2">' +
        '<span class="w-2 h-2 rounded-full bg-blue-600"></span>' +
        '<span class="text-xs font-black text-slate-900 block">มติคณะกรรมการรายท่าน</span>' +
        '</div>' +
        '<span class="text-xs font-black ' + (isPass ? 'text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200' : (failCount > 0 ? 'text-rose-700 bg-rose-50 px-3 py-1 rounded-xl border border-rose-200' : 'text-slate-600 bg-slate-100 px-3 py-1 rounded-xl border border-slate-200')) + '">' +
        (isPass ? 'มติเอกฉันท์: ผ่านการคัดเลือก (5/5 ท่าน)' : (failCount > 0 ? 'ผลมติ: ไม่ผ่านการคัดเลือก' : 'รอสรุปผล (' + (passCount + failCount) + '/5 ท่าน)')) +
        '</span>' +
        '</div>' +
        '<div class="grid grid-cols-5 gap-2.5">' +
        commVerdictsHtml +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';

      // Smart Insights Calculation
      var scoresList = commDetails.map(function (d) { return d.weightedTotal; }).filter(function (s) { return s > 0; });
      var maxScore = scoresList.length > 0 ? Math.max.apply(null, scoresList) : 0;
      var minScore = scoresList.length > 0 ? Math.min.apply(null, scoresList) : 0;
      var topComm = commDetails.find(function (d) { return d.weightedTotal === maxScore; });

      // Criteria averages for Radar chart
      var critAvgs = [0, 0, 0, 0, 0, 0];
      var critCounts = [0, 0, 0, 0, 0, 0];
      commDetails.forEach(function (d) {
        for (var k = 1; k <= 6; k++) {
          var sc = Number(d.scores[k]) || 0;
          if (sc > 0) {
            critAvgs[k - 1] += sc;
            critCounts[k - 1]++;
          }
        }
      });
      var radarScores = critAvgs.map(function (sum, i) {
        return critCounts[i] > 0 ? Number((sum / critCounts[i]).toFixed(2)) : 0;
      });

      var critNames = ['กลยุทธ์ BAFS (25%)', 'ความผูกพัน (25%)', 'เป้าหมายเรียน (15%)', 'ภาวะผู้นำ (15%)', 'การวางแผน (10%)', 'การมีส่วนร่วม (10%)'];
      var maxCritIdx = 0;
      var maxCritVal = 0;
      radarScores.forEach(function (v, idx) {
        if (v > maxCritVal) {
          maxCritVal = v;
          maxCritIdx = idx;
        }
      });



      // Engaging Dual-Perspective Charts Layout (Bar Chart + Radar Competency Polygon)
      var chartsHtml = '<div class="grid grid-cols-1 lg:grid-cols-12 gap-4">' +
        '<div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">' +
        '<div class="flex items-center justify-between mb-2">' +
        '<div>' +
        '<h4 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">' +
        '<span>📊</span> <span>คะแนนรวมรายกรรมการ (เต็ม 100 คะแนน)</span>' +
        '</h4>' +
        '<span class="text-[11px] text-slate-400">เปรียบเทียบคะแนนถ่วงน้ำหนัก 5 ท่าน</span>' +
        '</div>' +
        '<span class="text-[11px] text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg font-bold border border-emerald-200">เกณฑ์ผ่าน: 70 คะแนน</span>' +
        '</div>' +
        '<div class="h-60 relative">' +
        '<canvas id="candidate-comm-chart"></canvas>' +
        '</div>' +
        '</div>' +

        '<div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">' +
        '<div class="flex items-center justify-between mb-2">' +
        '<div>' +
        '<h4 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">' +
        '<span>🎯</span> <span>แผนภูมิสมรรถนะ 6 ด้าน (Radar)</span>' +
        '</h4>' +
        '<span class="text-[11px] text-slate-400">คะแนนเฉลี่ยจุดเด่นรายเกณฑ์ (เต็ม 5.0)</span>' +
        '</div>' +
        '<span class="text-[11px] text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg font-bold border border-indigo-200">Competency</span>' +
        '</div>' +
        '<div class="h-60 relative flex items-center justify-center">' +
        '<canvas id="candidate-radar-chart"></canvas>' +
        '</div>' +
        '</div>' +
        '</div>';

      bodyEl.innerHTML = '<div class="space-y-5">' +
        metricsRowHtml +
        chartsHtml +
        '</div>';

      // Render Charts after DOM injection
      setTimeout(function () {
        renderCandidateModalCharts(cand.id, commDetails, radarScores);
      }, 50);

    } else {
      // Tab = 'profile' (Render One-Page Profile & Study Goals)
      var studyGoalsList = (cand.studyGoals && cand.studyGoals.length > 0)
        ? cand.studyGoals.map(function (g, i) {
          return '<li class="bg-white p-3 rounded-xl border border-emerald-100 leading-relaxed"><span class="font-bold text-emerald-700 block mb-1">เป้าหมายที่ ' + (i + 1) + ':</span><span>' + g + '</span></li>';
        }).join('')
        : '<li>' + (cand.institute || '-') + '</li>';

      var supRemarksHtml = '';
      if (cand.supervisorRemarks) {
        if (cand.supervisorRemarks.strengths) {
          supRemarksHtml += '<div class="bg-white p-3 rounded-xl border border-emerald-200"><span class="text-emerald-800 font-bold block mb-1 flex items-center gap-1.5"><span>🌟</span> จุดเด่น / จุดแข็ง:</span><p class="text-slate-700 leading-relaxed">' + cand.supervisorRemarks.strengths + '</p></div>';
        }
        if (cand.supervisorRemarks.development && cand.supervisorRemarks.development !== '-') {
          supRemarksHtml += '<div class="bg-white p-3 rounded-xl border border-amber-200"><span class="text-amber-800 font-bold block mb-1 flex items-center gap-1.5"><span>⚠️</span> จุดที่ควรพัฒนา:</span><p class="text-slate-700 leading-relaxed">' + cand.supervisorRemarks.development + '</p></div>';
        }
        if (cand.supervisorRemarks.benefit) {
          supRemarksHtml += '<div class="bg-white p-3 rounded-xl border border-blue-200"><span class="text-blue-800 font-bold block mb-1 flex items-center gap-1.5"><span>🚀</span> ประโยชน์หลังจบการศึกษา:</span><p class="text-slate-700 leading-relaxed">' + cand.supervisorRemarks.benefit + '</p></div>';
        }
      } else {
        supRemarksHtml = '<p class="text-slate-600 text-xs bg-white p-3 rounded-xl border border-amber-100">มีความมุ่งมั่นและพร้อมนำความรู้มาต่อยอดพัฒนาองค์กร</p>';
      }

      bodyEl.innerHTML = '<div class="grid grid-cols-1 lg:grid-cols-3 gap-5">' +
        '<div class="bg-gradient-to-br from-blue-50/80 to-indigo-50/50 rounded-2xl p-5 border border-blue-100 flex flex-col justify-between shadow-xs">' +
        '<div>' +
        '<div class="flex items-center gap-2 font-bold text-blue-900 mb-3 text-sm">' +
        '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>' +
        '<span>ข้อมูลหลักสูตร & สถาบัน</span>' +
        '</div>' +
        '<h4 class="text-base font-bold text-slate-900 mb-1 leading-snug">' + (cand.programName || '-') + '</h4>' +
        '<p class="text-xs text-slate-600 mb-3">' + (cand.faculty ? cand.faculty + ', ' : '') + '<strong>' + (cand.institute || '-') + '</strong></p>' +
        '<div class="space-y-2 bg-white p-3.5 rounded-xl border border-blue-100 text-xs">' +
        '<div class="flex items-start justify-between gap-2"><span class="text-slate-500 flex-shrink-0">รูปแบบการเรียน:</span><span class="font-semibold text-slate-800 text-right">' + (cand.studyFormat || '-') + '</span></div>' +
        '<div class="pt-2 border-t border-slate-100 space-y-1">' +
        '<div class="flex items-center justify-between">' +
        '<span class="text-slate-500 font-medium">ค่าใช้จ่ายตลอดหลักสูตร:</span>' +
        '<span class="font-black text-amber-600 text-xs">' + (cand.tuitionNumber ? (cand.tuitionNumber.toLocaleString() + ' บาท') : (cand.tuitionFee || '-')) + '</span>' +
        '</div>' +
        (cand.tuitionFee && cand.tuitionFee.indexOf(String.fromCharCode(40)) !== -1 ? '<p class="text-[10px] text-slate-400 font-normal leading-snug text-right">' + cand.tuitionFee.substring(cand.tuitionFee.indexOf(String.fromCharCode(40))) + '</p>' : '') +
        '</div>' +
        '</div>' +
        (cand.programDetails ? '<div class="mt-3 text-[11px] text-slate-600 leading-relaxed bg-white/60 p-3 rounded-xl border border-blue-50">' + cand.programDetails + '</div>' : '') +
        '</div>' +
        '</div>' +

        '<div class="bg-gradient-to-br from-emerald-50/80 to-teal-50/50 rounded-2xl p-5 border border-emerald-100 flex flex-col justify-between shadow-xs">' +
        '<div>' +
        '<div class="flex items-center gap-2 font-bold text-emerald-900 mb-3 text-sm">' +
        '<svg class="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>' +
        '<span>เป้าหมายการศึกษาต่อ (Study Goals)</span>' +
        '</div>' +
        '<ul class="space-y-3 text-xs text-slate-700">' + studyGoalsList + '</ul>' +
        '</div>' +
        '</div>' +

        '<div class="bg-gradient-to-br from-amber-50/80 to-orange-50/50 rounded-2xl p-5 border border-amber-100 flex flex-col justify-between shadow-xs">' +
        '<div>' +
        '<div class="flex items-center gap-2 font-bold text-amber-900 mb-3 text-sm">' +
        '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>' +
        '<span>ความเห็นจากผู้บังคับบัญชา</span>' +
        '</div>' +
        '<div class="space-y-2.5 text-xs">' + supRemarksHtml + '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    // 3. Quick candidate switcher in footer
    if (tabsEl) {
      tabsEl.innerHTML = '<span class="text-xs font-bold text-slate-500 mr-1 whitespace-nowrap">ดูผู้สมัครท่านอื่น:</span>' +
        state.candidates.map(function (c, idx) {
          var isCurrent = (c.id === cand.id);
          var cls = isCurrent
            ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600'
            : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200';
          var shortName = c.name ? (c.name.split(' ')[0] || c.name) : ('ท่านที่ ' + (idx + 1));
          return '<button type="button" onclick="window.app.openOnePageModal(\'' + c.id + '\', \'' + currentTab + '\')" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ' + cls + '">' +
            (idx + 1) + '. ' + shortName + '</button>';
        }).join('');
    }

    modal.classList.remove('hidden');
    requestAnimationFrame(function () {
      card.classList.remove('scale-95', 'opacity-0');
      card.classList.add('scale-100', 'opacity-100');
    });
  }

  var isModalFullscreen = false;

  function toggleModalFullscreen() {
    var modal = document.getElementById('candidate-onepage-modal');
    var card = document.getElementById('onepage-modal-card');
    var iconExpand = document.getElementById('fullscreen-icon-expand');
    var iconCompress = document.getElementById('fullscreen-icon-compress');
    var btn = document.getElementById('modal-fullscreen-btn');

    if (!modal || !card) return;

    isModalFullscreen = !isModalFullscreen;

    if (isModalFullscreen) {
      modal.classList.remove('p-3', 'sm:p-5');
      modal.classList.add('p-0');

      card.classList.remove('max-w-5xl', 'max-h-[92vh]', 'rounded-3xl');
      card.classList.add('max-w-none', 'w-screen', 'h-screen', 'max-h-screen', 'rounded-none');

      if (iconExpand) iconExpand.classList.add('hidden');
      if (iconCompress) iconCompress.classList.remove('hidden');
      if (btn) btn.title = 'ย่อขนาดหน้าต่าง (Exit Fullscreen)';
    } else {
      modal.classList.remove('p-0');
      modal.classList.add('p-3', 'sm:p-5');

      card.classList.remove('max-w-none', 'w-screen', 'h-screen', 'max-h-screen', 'rounded-none');
      card.classList.add('max-w-5xl', 'max-h-[92vh]', 'rounded-3xl');

      if (iconExpand) iconExpand.classList.remove('hidden');
      if (iconCompress) iconCompress.classList.add('hidden');
      if (btn) btn.title = 'ดูแบบเต็มจอ (Toggle Fullscreen)';
    }

    // Smooth Chart.js scaling
    setTimeout(function () {
      if (modalCommChartInstance) modalCommChartInstance.resize();
      if (modalRadarChartInstance) modalRadarChartInstance.resize();
    }, 150);
  }

  function closeOnePageModal() {
    var modal = document.getElementById('candidate-onepage-modal');
    var card = document.getElementById('onepage-modal-card');
    if (!modal || !card) return;

    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(function () {
      modal.classList.add('hidden');

      if (isModalFullscreen) {
        toggleModalFullscreen();
      }
    }, 200);
  }

  // ==========================================
  // VIEW 1: MASTER DASHBOARD (HOME LANDING PAGE)
  // ==========================================
  function renderDashboard() {
    var container = document.getElementById('dashboard-container');
    if (!container || !window.ASSESSMENT_DATA) return;

    var candidates = state.candidates;
    var committees = window.ASSESSMENT_DATA.committees;
    var criteria = window.ASSESSMENT_DATA.criteria;

    // 1. Calculate stats across all candidates
    var totalCandidates = candidates.length;
    var totalCommittees = committees.length;
    var totalBudget = 0;
    var totalPassedCandidates = 0;

    var candidateStats = candidates.map(function (c) {
      var cEvals = state.evaluations[c.id] || {};
      var totalWeightedScore = 0;
      var passCount = 0;
      var failCount = 0;
      var submittedCount = 0;
      var evaluatedCommCount = 0;

      committees.forEach(function (comm) {
        var ev = cEvals[comm.id];
        if (ev) {
          var t = window.ASSESSMENT_DATA.calculateTotalScores(ev.scores || {});
          totalWeightedScore += t.weightedTotal;
          if (t.weightedTotal > 0) evaluatedCommCount++;
          if (ev.verdict === 'PASS') passCount++;
          if (ev.verdict === 'FAIL') failCount++;
          if (ev.isSubmitted) submittedCount++;
        }
      });

      var avgScore = evaluatedCommCount > 0 ? Number((totalWeightedScore / evaluatedCommCount).toFixed(2)) : 0;
      var isPass = (passCount === 5);
      if (isPass) totalPassedCandidates++;

      if (c.tuitionNumber) {
        totalBudget += c.tuitionNumber;
      }

      return {
        candidate: c,
        avgScore: avgScore,
        passCount: passCount,
        failCount: failCount,
        submittedCount: submittedCount,
        isPass: isPass,
        isMajorityPass: isPass
      };
    });

    // 2. Build 4 Candidate Executive Overview Cards (STRICT SYMMETRY & REAL PHOTOS)
    var candidateCardsHtml = candidateStats.map(function (stat, idx) {
      var c = stat.candidate;
      var isCurrent = (c.id === state.activeCandidateId);
      var isFutureLeader = (c.nineBoxGrid === 'Future Leader');
      var badgeColor = isFutureLeader
        ? (isCurrent ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-emerald-100 text-emerald-800')
        : (isCurrent ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30' : 'bg-blue-100 text-blue-800');

      var containerCls = isCurrent
        ? 'bg-slate-900 border-2 border-blue-500 ring-4 ring-blue-500/30 shadow-2xl text-white rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all h-full relative transform -translate-y-1'
        : 'bg-white border border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md text-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all h-full relative';

      var affiliationBox = isCurrent
        ? '<div class="h-[40px] flex items-center bg-white/10 px-3 rounded-xl border border-white/10 text-xs">' +
          '<div class="truncate w-full">' +
          '<span class="text-blue-300 text-[10px] block leading-none mb-0.5 font-medium">สังกัด:</span>' +
          '<span class="font-bold text-white truncate block leading-tight" title="' + (c.department || c.company || '-') + '">' + (c.department || c.company || '-') + '</span>' +
          '</div></div>'
        : '<div class="h-[40px] flex items-center bg-slate-50 px-3 rounded-xl border border-slate-100 text-xs">' +
          '<div class="truncate w-full">' +
          '<span class="text-slate-400 text-[10px] block leading-none mb-0.5">สังกัด:</span>' +
          '<span class="font-bold text-blue-700 truncate block leading-tight" title="' + (c.department || c.company || '-') + '">' + (c.department || c.company || '-') + '</span>' +
          '</div></div>';

      var courseBox = isCurrent
        ? '<div class="h-[54px] flex flex-col justify-center bg-white/10 px-3 rounded-xl border border-white/10 text-xs">' +
          '<span class="text-blue-300 text-[10px] leading-none mb-0.5 font-medium">หลักสูตร:</span>' +
          '<span class="font-semibold text-slate-100 leading-tight line-clamp-2" title="' + (c.programName || c.degreeLevel) + '">' + (c.programName || c.degreeLevel) + '</span>' +
          '</div>'
        : '<div class="h-[54px] flex flex-col justify-center bg-blue-50/50 px-3 rounded-xl border border-blue-100/60 text-xs">' +
          '<span class="text-slate-400 text-[10px] leading-none mb-0.5">หลักสูตร:</span>' +
          '<span class="font-semibold text-slate-800 leading-tight line-clamp-2" title="' + (c.programName || c.degreeLevel) + '">' + (c.programName || c.degreeLevel) + '</span>' +
          '</div>';

      var consensusBadge = stat.passCount === 5
        ? '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500 text-white font-black text-xs shadow-2xs whitespace-nowrap">✓ ผ่าน (5/5)</span>'
        : (stat.failCount > 0
          ? '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-500 text-white font-black text-xs shadow-2xs whitespace-nowrap">✕ ไม่ผ่าน (' + stat.passCount + '/5)</span>'
          : '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl ' + (isCurrent ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300 border border-slate-700') + ' font-bold text-xs whitespace-nowrap">⏳ รอผล (' + stat.submittedCount + '/5)</span>');

      var scoreBox = isCurrent
        ? '<div class="p-3 rounded-2xl bg-blue-600 text-white shadow-md flex items-center justify-between gap-2">' +
          '<div>' +
          '<span class="text-[10px] text-blue-200 font-bold uppercase tracking-wider block leading-none mb-1">คะแนนเฉลี่ย</span>' +
          '<div class="flex items-baseline gap-1 leading-none">' +
          '<span class="text-2xl font-black text-white whitespace-nowrap">' + stat.avgScore.toFixed(2) + '</span>' +
          '<span class="text-[11px] text-blue-200 font-medium whitespace-nowrap">/ 100</span>' +
          '</div>' +
          '</div>' +
          '<div class="text-right flex flex-col items-end">' +
          '<span class="text-[10px] text-blue-200 font-bold uppercase tracking-wider block leading-none mb-1">มติกรรมการ</span>' +
          consensusBadge +
          '</div>' +
          '</div>'
        : '<div class="p-3 rounded-2xl bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white shadow-md flex items-center justify-between gap-2 border border-slate-800">' +
          '<div>' +
          '<span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider block leading-none mb-1">คะแนนเฉลี่ย</span>' +
          '<div class="flex items-baseline gap-1 leading-none">' +
          '<span class="text-2xl font-black text-white whitespace-nowrap">' + stat.avgScore.toFixed(2) + '</span>' +
          '<span class="text-[11px] text-slate-400 font-medium whitespace-nowrap">/ 100</span>' +
          '</div>' +
          '</div>' +
          '<div class="text-right flex flex-col items-end">' +
          '<span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider block leading-none mb-1">มติกรรมการ</span>' +
          consensusBadge +
          '</div>' +
          '</div>';

      return '<div class="' + containerCls + ' cursor-pointer select-none" onclick="window.app.switchDashboardCandidate(\'' + c.id + '\')" ondblclick="window.app.openOnePageModal(\'' + c.id + '\')" title="คลิกเพื่อเลือกดูข้อมูล • ดับเบิ้ลคลิก (Double-click) เพื่อดู Dashboard สรุปผลการประเมิน">' +
        '<div class="space-y-3">' +
        
        // 1. Header: Large Prominent Photo Banner with Gradient Overlay & Status
        '<div class="relative rounded-2xl overflow-hidden mb-3 bg-gradient-to-b from-slate-100 to-slate-200 border ' + (isCurrent ? 'border-slate-700' : 'border-slate-200') + ' shadow-inner group cursor-pointer" onclick="event.stopPropagation(); window.app.switchDashboardCandidate(\'' + c.id + '\')" ondblclick="event.stopPropagation(); window.app.openOnePageModal(\'' + c.id + '\')" title="คลิกเพื่อเลือกดูข้อมูล • ดับเบิ้ลคลิกเพื่อเปิด Dashboard สรุปผลการประเมิน">' +
        '<div class="w-full h-52 relative overflow-hidden bg-slate-900">' +
        (c.photoUrl
          ? '<img src="' + c.photoUrl + '" alt="' + c.name + '" class="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300" />'
          : '<div class="w-full h-full bg-gradient-to-br ' + (c.avatarColor || 'from-blue-600 to-indigo-700') + ' flex items-center justify-center text-white text-4xl font-black">' + (c.name ? c.name.charAt(0) : (idx + 1)) + '</div>') +
        '<div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-transparent"></div>' +
        '<div class="absolute top-2.5 left-2.5">' +
        '<span class="inline-flex items-center text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-white/90 backdrop-blur-md text-slate-900 shadow-sm">ลำดับที่ ' + (idx + 1) + '</span>' +
        '</div>' +
        '<div class="absolute top-2.5 right-2.5">' +
        '<span class="inline-flex items-center text-[10px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-md ' + (stat.isMajorityPass ? 'bg-emerald-500/90 text-white shadow-sm' : (stat.failCount > 2 ? 'bg-rose-500/90 text-white shadow-sm' : 'bg-slate-900/80 text-white')) + '">' +
        (stat.isMajorityPass ? '🎉 ผ่านเกณฑ์' : (stat.failCount > 2 ? '❌ ไม่ผ่าน' : '⏳ รอผล')) +
        '</span>' +
        '</div>' +
        '<div class="absolute inset-x-0 bottom-0 p-3 text-white">' +
        '<h3 class="font-bold text-sm sm:text-base leading-tight truncate group-hover:text-blue-300 transition-colors drop-shadow-sm" title="' + c.name + '">' + c.name + '</h3>' +
        '<p class="text-[11px] text-blue-200/90 truncate mt-0.5" title="' + (c.nameEn || '') + '">' + (c.nameEn || '') + '</p>' +
        '</div>' +
        '</div>' +
        '</div>' +

        // 2. Badges: 9-Box & Tenure (Fixed Height: h-6)
        '<div class="h-6 flex items-center justify-between">' +
        '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ' + badgeColor + ' truncate max-w-[140px]">' +
        (c.nineBoxGrid || 'Future Leader') +
        '</span>' +
        '<span class="text-[11px] font-semibold ' + (isCurrent ? 'text-slate-300 bg-white/10 border border-white/10' : 'text-slate-500 bg-slate-100') + ' px-2 py-0.5 rounded-md whitespace-nowrap">' +
        'อายุงาน ' + (c.tenure || '-') + '</span>' +
        '</div>' +

        // 3. Affiliation Box (Fixed Height: h-[40px])
        affiliationBox +

        // 4. Course & Institute Box (Fixed Height: h-[54px])
        courseBox +

        // 5. Prominent Live Score & Consensus Box
        scoreBox +

        '</div>' +
        '</div>';
    }).join('');

    // 3. Build Master Dashboard HTML
    container.innerHTML = '<div class="space-y-8">' +
      
      // Top Executive Hero Header
      '<div class="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-blue-900/60">' +
      '<div class="flex items-center gap-2 mb-1.5"><span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-500/20 text-blue-300 border border-blue-400/30">Executive Summary</span><span class="text-xs text-emerald-400 font-bold flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> Real-Time Synchronized</span></div>' +
      '<h1 class="text-2xl md:text-3xl font-black tracking-tight">ภาพรวมการประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา</h1>' +
      '<p class="text-xs md:text-sm text-slate-300 mt-1">สรุปผลคะแนน มติคณะกรรมการ และข้อมูลประกอบการพิจารณาทุน BAFS Group 2569</p>' +
      '</div>' +

      // KPI Key Metrics Row
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">' +
      '<div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">' +
      '<div><span class="text-xs font-semibold text-slate-500 block">ผู้ขอรับทุนทั้งหมด</span><span class="text-3xl font-black text-slate-900">' + totalCandidates + ' ท่าน</span></div>' +
      '<div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl font-black">👥</div>' +
      '</div>' +
      '<div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">' +
      '<div><span class="text-xs font-semibold text-slate-500 block">มติผ่านการคัดเลือก</span><span class="text-3xl font-black text-emerald-600">' + totalPassedCandidates + ' ท่าน</span><span class="text-[11px] text-slate-400 mt-0.5 block">มติเอกฉันท์ 5/5 ท่าน</span></div>' +
      '<div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl font-black">✅</div>' +
      '</div>' +
      '<div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">' +
      '<div><span class="text-xs font-semibold text-slate-500 block">คณะกรรมการสัมภาษณ์</span><span class="text-3xl font-black text-indigo-600">' + totalCommittees + ' ท่าน</span><span class="text-[11px] text-slate-400 mt-0.5 block">EM, MD-BPT, TARCO, BPS, HZ</span></div>' +
      '<div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-black">🏛️</div>' +
      '</div>' +
      '<div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">' +
      '<div><span class="text-xs font-semibold text-slate-500 block">งบประมาณรวมทั้ง 4 ท่าน</span><span class="text-2xl font-black text-amber-600">' + (totalBudget ? totalBudget.toLocaleString() : '1,082,000') + ' ฿</span><span class="text-[11px] text-slate-400 mt-0.5 block">ค่าใช้จ่ายตลอดหลักสูตร</span></div>' +
      '<div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-xl font-black">💰</div>' +
      '</div>' +
      '</div>' +

      // Section 1: 4 Candidate Cards Grid (Strictly Symmetrical & Real Photos)
      '<div>' +
      '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">' +
      '<h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg><span>ผู้ขอรับทุนการศึกษาทั้ง 4 ท่าน (Real-Time Leaderboard)</span></h2>' +
      '<span class="text-xs text-slate-500 font-medium">คลิกเพื่อสลับดูข้อมูล • <strong class="text-blue-600 font-bold">ดับเบิ้ลคลิก (Double-click)</strong> เพื่อเปิด Dashboard สรุปผลการประเมินรายบุคคล</span>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">' +
      candidateCardsHtml +
      '</div>' +
      '</div>' +

      '</div>';
  }

  function renderMultiCandidateBarChart(candidateStats) {
    var ctx = document.getElementById('barChart');
    if (!ctx || typeof Chart === 'undefined') return;

    if (barChartInstance) {
      barChartInstance.destroy();
    }

    var labels = candidateStats.map(function (s) {
      var name = s.candidate.name;
      return name ? (name.split(' ')[0] + ' ' + (name.split(' ')[1] || '')) : 'ผู้สมัคร';
    });

    var dataScores = candidateStats.map(function (s) { return s.avgScore; });
    var backgroundColors = candidateStats.map(function (s) {
      if (s.isMajorityPass) return 'rgba(16, 185, 129, 0.85)';
      if (s.failCount > 2) return 'rgba(244, 63, 94, 0.85)';
      return 'rgba(59, 130, 246, 0.85)';
    });

    barChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'คะแนนเฉลี่ยสุทธิ (เต็ม 100)',
          data: dataScores,
          backgroundColor: backgroundColors,
          borderRadius: 10,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: 'rgba(241, 245, 249, 1)' },
            ticks: { font: { size: 10 } }
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 11, weight: 'bold', family: 'Prompt, sans-serif' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: function(context) {
                var s = candidateStats[context.dataIndex];
                return 'มติ: ผ่าน ' + s.passCount + ' / ไม่ผ่าน ' + s.failCount;
              }
            }
          }
        }
      }
    });
  }

  function renderRadarChart(criteria, criteriaAverages) {
    var ctx = document.getElementById('radarChart');
    if (!ctx || typeof Chart === 'undefined') return;

    if (radarChartInstance) {
      radarChartInstance.destroy();
    }

    var labels = criteria.map(function (c) { return c.shortTitle || c.title.split('. ')[1] || c.title; });
    var avgScores = criteria.map(function (c) { return Number((criteriaAverages[c.id] || 0).toFixed(2)); });
    var maxScores = criteria.map(function (c) { return c.weight; });

    radarChartInstance = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'คะแนนเฉลี่ยที่ได้',
            data: avgScores,
            backgroundColor: 'rgba(59, 130, 246, 0.25)',
            borderColor: 'rgba(37, 99, 235, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(37, 99, 235, 1)',
            pointRadius: 4
          },
          {
            label: 'คะแนนเต็มตามเกณฑ์',
            data: maxScores,
            backgroundColor: 'rgba(203, 213, 225, 0.1)',
            borderColor: 'rgba(148, 163, 184, 0.6)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: 'rgba(226, 232, 240, 0.8)' },
            grid: { color: 'rgba(226, 232, 240, 0.8)' },
            pointLabels: {
              font: { size: 10, family: 'Prompt, sans-serif' },
              color: '#475569'
            },
            ticks: { display: false }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11, family: 'Prompt, sans-serif' } }
          }
        }
      }
    });
  }

  // ==========================================
  // VIEW 2: EVALUATOR FORM VIEW
  // ==========================================
  function renderEvaluatorForm(forceFullRender) {
    if (forceFullRender === undefined) forceFullRender = true;
    var container = document.getElementById('evaluator-form-container');
    if (!container || !window.ASSESSMENT_DATA) return;

    try {
      var commInfo = window.ASSESSMENT_DATA.committees.find(function (c) { return c.id === state.currentCommitteeId; }) || window.ASSESSMENT_DATA.committees[0];
      if (!state.currentCommitteeId) {
        state.currentCommitteeId = commInfo.id;
      }

      var candId = state.activeCandidateId;
      if (!candId || !state.candidates.some(function (c) { return c.id === candId; })) {
        if (state.candidates && state.candidates.length > 0) {
          candId = state.candidates[0].id;
          state.activeCandidateId = candId;
        }
      }

      if (!state.evaluations) {
        state.evaluations = {};
      }
      if (!state.evaluations[candId]) {
        state.evaluations[candId] = {};
      }
      if (!state.evaluations[candId][commInfo.id]) {
        state.evaluations[candId][commInfo.id] = {
          scores: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
          strengths: '',
          weaknesses: '',
          commitment: '',
          comments: '',
          verdict: '',
          evaluatorName: commInfo.name,
          date: new Date().toISOString().split('T')[0],
          isSubmitted: false,
          updatedAt: Date.now()
        };
      }

      var evalData = state.evaluations[candId][commInfo.id];
      if (!evalData.scores || typeof evalData.scores !== 'object') {
        evalData.scores = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      }
      for (var k = 1; k <= 6; k++) {
        if (evalData.scores[k] === undefined || evalData.scores[k] === null) {
          evalData.scores[k] = 0;
        }
      }

      var scoreTotals = window.ASSESSMENT_DATA.calculateTotalScores(evalData.scores);

      if (forceFullRender) {
        var criteriaHtml = window.ASSESSMENT_DATA.criteria.map(function (c) {
          var rawScore = Number(evalData.scores[c.id]) || 0;
          var weightedScore = window.ASSESSMENT_DATA.calculateCriterionWeightedScore(rawScore, c.weight);

          var scoreStyles = {
            1: {
              unselected: 'bg-rose-50/70 text-rose-700 hover:bg-rose-100 hover:border-rose-300 border-rose-200',
              selected: 'bg-gradient-to-tr from-rose-600 to-red-500 text-white shadow-lg shadow-rose-600/30 ring-2 ring-rose-500 ring-offset-2 scale-[1.03]'
            },
            2: {
              unselected: 'bg-amber-50/70 text-amber-800 hover:bg-amber-100 hover:border-amber-300 border-amber-200',
              selected: 'bg-gradient-to-tr from-amber-600 to-orange-500 text-white shadow-lg shadow-amber-600/30 ring-2 ring-amber-500 ring-offset-2 scale-[1.03]'
            },
            3: {
              unselected: 'bg-sky-50/70 text-sky-800 hover:bg-sky-100 hover:border-sky-300 border-sky-200',
              selected: 'bg-gradient-to-tr from-sky-600 to-blue-500 text-white shadow-lg shadow-sky-600/30 ring-2 ring-sky-500 ring-offset-2 scale-[1.03]'
            },
            4: {
              unselected: 'bg-blue-50/70 text-blue-800 hover:bg-blue-100 hover:border-blue-300 border-blue-200',
              selected: 'bg-gradient-to-tr from-blue-700 via-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/30 ring-2 ring-indigo-500 ring-offset-2 scale-[1.03]'
            },
            5: {
              unselected: 'bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-300 border-emerald-200',
              selected: 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-600/30 ring-2 ring-emerald-500 ring-offset-2 scale-[1.03]'
            }
          };

          var isLocked = (evalData.isSubmitted === true);

          var scoreButtons = [1, 2, 3, 4, 5].map(function (score) {
            var isSelected = (rawScore === score);
            var st = scoreStyles[score] || scoreStyles[3];
            var cls = '';
            if (isLocked) {
              cls = isSelected ? (st.selected + ' cursor-default ring-2 ring-blue-300') : ('border ' + st.unselected + ' opacity-30 cursor-not-allowed');
            } else {
              cls = isSelected ? st.selected : ('border ' + st.unselected);
            }
            var desc = (score === 5 ? 'โดดเด่น' : score === 4 ? 'ชัดเจน' : score === 3 ? 'ปานกลาง' : score === 2 ? 'น้อย' : 'ไม่แสดงออก');
            var fullDesc = (c.rubric && c.rubric[score]) ? c.rubric[score] : ('ระดับคะแนน ' + score);
            var onClick = isLocked ? '' : ('onclick="window.app.setCriteriaScore(' + c.id + ', ' + score + ')"');
            var disabledAttr = isLocked ? 'disabled' : '';

            return '<button type="button" ' + onClick + ' ' + disabledAttr + ' title="' + fullDesc + '" class="group relative flex-1 py-2.5 sm:py-3 px-1 sm:px-2 rounded-xl text-center font-bold text-sm md:text-base transition-all duration-150 ' + cls + '">' +
              '<div class="text-base md:text-lg font-black leading-tight">' + score + '</div>' +
              '<div class="text-[11px] md:text-xs font-semibold opacity-95 mt-0.5 truncate">' + desc + '</div>' +
              '</button>';
          }).join('');

          var selectedRubricText = rawScore > 0 ? (c.rubric && c.rubric[rawScore] ? c.rubric[rawScore] : ('ระดับคะแนน ' + rawScore)) : 'โปรดเลือกระดับคะแนน (1 - 5)';
          var rubricColor = rawScore === 5 ? 'text-emerald-700 font-bold' : rawScore === 4 ? 'text-indigo-700 font-bold' : rawScore === 3 ? 'text-sky-700 font-bold' : rawScore === 2 ? 'text-amber-700 font-bold' : rawScore === 1 ? 'text-rose-700 font-bold' : 'text-slate-400 font-normal';

          return '<div class="bg-white rounded-2xl p-5 md:p-6 border border-slate-200 shadow-sm transition-all duration-200 hover:border-blue-200 hover:shadow-md mb-4" id="criteria-card-' + c.id + '">' +
            '<div class="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3">' +
            '<div class="flex-1">' +
            '<div class="flex items-center gap-2.5 flex-wrap">' +
            '<span class="text-xl">' + (c.icon || '📌') + '</span>' +
            '<span class="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold bg-blue-100 text-blue-800">น้ำหนัก ' + c.weight + '%</span>' +
            '<h3 class="text-base md:text-lg font-bold text-slate-800">' + c.title + '</h3>' +
            '</div>' +
            '<p class="text-xs md:text-sm text-slate-500 whitespace-pre-line mt-2 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">' + c.description + '</p>' +
            '</div>' +
            '<div class="flex md:flex-col items-center md:items-end justify-between bg-blue-50/70 p-3 rounded-xl border border-blue-100 min-w-[120px]">' +
            '<span class="text-[11px] font-semibold text-blue-600">คะแนนถ่วงน้ำหนัก</span>' +
            '<div class="text-xl md:text-2xl font-black text-blue-700">' +
            '<span id="weighted-score-' + c.id + '">' + weightedScore.toFixed(2) + '</span>' +
            '<span class="text-xs font-normal text-blue-500">/ ' + c.weight + '</span>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="mt-4">' +
            '<div class="text-xs font-semibold text-slate-600 mb-2 flex items-center justify-between flex-wrap gap-1">' +
            '<span>เลือกระดับคะแนน (ดิบ 1 - 5):</span>' +
            '<span class="text-xs ' + rubricColor + '" id="rubric-desc-' + c.id + '">' + selectedRubricText + '</span>' +
            '</div>' +
            '<div class="grid grid-cols-5 gap-2 md:gap-3">' + scoreButtons + '</div>' +
            '</div>' +
            '</div>';
        }).join('');

      var renderTags = function (field, tags) {
        if (!tags) return '';
        return tags.map(function (tag) {
          return '<button type="button" onclick="window.app.appendQuickTag(\'' + field + '\', \'' + tag + '\')" class="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-slate-200 transition-colors shadow-2xs">' +
            tag + '</button>';
        }).join('');
      };

      var committeeIcons = {
        'EM': '👔',
        'MD-BPT': '⛽',
        'MD-TARCO': '✈️',
        'MD-BPS': '⚡',
        'HZ': '💡'
      };
      var commIcon = committeeIcons[commInfo.id] || '👔';
      var isFormLocked = (evalData.isSubmitted === true);

      // Milestone calculations
      var totalCriteria = (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.criteria) ? window.ASSESSMENT_DATA.criteria.length : 6;
      var scoredCount = 0;
      if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.criteria) {
        window.ASSESSMENT_DATA.criteria.forEach(function (c) {
          if (Number(evalData.scores && evalData.scores[c.id]) > 0) {
            scoredCount++;
          }
        });
      }
      var isCriteriaComplete = (scoredCount === totalCriteria);
      var hasComments = !!((evalData.strengths && evalData.strengths.trim().length > 0) ||
                           (evalData.weaknesses && evalData.weaknesses.trim().length > 0) ||
                           (evalData.commitment && evalData.commitment.trim().length > 0) ||
                           (evalData.comments && evalData.comments.trim().length > 0));
      var isVerdictComplete = !!evalData.verdict;

      var step1Percent = Math.round((scoredCount / totalCriteria) * 50);
      var step2Percent = hasComments ? 25 : 0;
      var step3Percent = isVerdictComplete ? 25 : 0;
      var overallProgress = isFormLocked ? 100 : (step1Percent + step2Percent + step3Percent);

      var milestoneHtml =
        '<div class="bg-white rounded-2xl p-4 md:p-5 border border-slate-200 shadow-sm mb-6">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">' +
        '<div class="flex items-center gap-2">' +
        '<span class="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-black">🎯</span>' +
        '<span class="text-xs md:text-sm font-bold text-slate-800">ขั้นตอนการประเมิน (Evaluation Milestones)</span>' +
        '</div>' +
        '<div class="flex items-center gap-2.5">' +
        '<span class="text-xs font-black text-blue-600">' + overallProgress + '% เสร็จสมบูรณ์</span>' +
        '<div class="w-24 md:w-32 h-2.5 rounded-full bg-slate-100 overflow-hidden border border-slate-200">' +
        '<div class="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 rounded-full transition-all duration-300" style="width: ' + overallProgress + '%"></div>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
        // Milestone 1: Scores
        '<div class="flex items-center gap-3 p-3 rounded-xl border ' + (isCriteriaComplete ? 'bg-emerald-50/70 border-emerald-200' : 'bg-slate-50 border-slate-200') + '">' +
        '<div class="w-8 h-8 rounded-xl ' + (isCriteriaComplete ? 'bg-emerald-600 text-white' : 'bg-blue-100 text-blue-700') + ' flex items-center justify-center font-black text-xs flex-shrink-0">' + (isCriteriaComplete ? '✓' : '1') + '</div>' +
        '<div class="min-w-0 flex-1">' +
        '<div class="text-xs font-bold text-slate-900 truncate">1. ให้คะแนนเกณฑ์ 6 ข้อ</div>' +
        '<div class="text-[11px] ' + (isCriteriaComplete ? 'text-emerald-700 font-bold' : 'text-slate-500 font-medium') + '">' + (isCriteriaComplete ? '✅ ครบทั้ง 6 ข้อ' : ('ให้คะแนนแล้ว ' + scoredCount + '/' + totalCriteria + ' ข้อ')) + '</div>' +
        '</div>' +
        '</div>' +

        // Milestone 2: Qualitative Comments
        '<div class="flex items-center gap-3 p-3 rounded-xl border ' + (hasComments ? 'bg-emerald-50/70 border-emerald-200' : 'bg-slate-50 border-slate-200') + '">' +
        '<div class="w-8 h-8 rounded-xl ' + (hasComments ? 'bg-emerald-600 text-white' : 'bg-indigo-100 text-indigo-700') + ' flex items-center justify-center font-black text-xs flex-shrink-0">' + (hasComments ? '✓' : '2') + '</div>' +
        '<div class="min-w-0 flex-1">' +
        '<div class="text-xs font-bold text-slate-900 truncate">2. ข้อคิดเห็นเชิงคุณภาพ</div>' +
        '<div class="text-[11px] ' + (hasComments ? 'text-emerald-700 font-bold' : 'text-slate-500 font-medium') + '">' + (hasComments ? '✅ มีการระบุข้อคิดเห็น' : 'กรอกจุดเด่น/ข้อเสนอแนะ') + '</div>' +
        '</div>' +
        '</div>' +

        // Milestone 3: Final Verdict
        '<div class="flex items-center gap-3 p-3 rounded-xl border ' + (isFormLocked ? 'bg-emerald-50/70 border-emerald-200' : (isVerdictComplete ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200')) + '">' +
        '<div class="w-8 h-8 rounded-xl ' + (isFormLocked ? 'bg-emerald-600 text-white' : (isVerdictComplete ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700')) + ' flex items-center justify-center font-black text-xs flex-shrink-0">' + (isFormLocked ? '🔒' : (isVerdictComplete ? '✓' : '3')) + '</div>' +
        '<div class="min-w-0 flex-1">' +
        '<div class="text-xs font-bold text-slate-900 truncate">3. มติสรุปผลการประเมิน</div>' +
        '<div class="text-[11px] ' + (isFormLocked ? 'text-emerald-700 font-bold' : (isVerdictComplete ? 'text-blue-700 font-bold' : 'text-slate-500 font-medium')) + '">' + (isFormLocked ? ('🔒 ล็อกมติแล้ว: ' + (evalData.verdict === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน')) : (isVerdictComplete ? ('มติ: ' + (evalData.verdict === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน')) : 'รอยืนยันมติ')) + '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';

      var lockedBannerHtml = isFormLocked
        ? ('<div class="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 md:p-5 rounded-2xl mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-emerald-500/40 shadow-lg">' +
          '<div class="flex items-center gap-3.5">' +
          '<div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl font-bold flex-shrink-0">🔒</div>' +
          '<div>' +
          '<div class="font-black text-sm md:text-base text-emerald-400 flex items-center gap-2">ผลการประเมินได้รับการยืนยันและล็อกแล้ว (Finalized & Locked)</div>' +
          '<div class="text-xs text-slate-300 mt-0.5">มติของท่าน: <span class="font-bold ' + (evalData.verdict === 'PASS' ? 'text-emerald-300' : 'text-rose-300') + '">' + (evalData.verdict === 'PASS' ? 'ผ่านการคัดเลือก (PASS)' : 'ไม่ผ่านการคัดเลือก (FAIL)') + '</span> • คะแนนรวม ' + scoreTotals.weightedTotal.toFixed(2) + ' คะแนน (ไม่สามารถแก้ไขข้อมูลได้)</div>' +
          '</div>' +
          '</div>' +
          '<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 self-start sm:self-center">🔒 ล็อกผลการประเมินแล้ว</span>' +
          '</div>')
        : '';

      var textareaClass = isFormLocked
        ? 'w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed text-sm'
        : 'w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 text-sm text-slate-800 transition-all';
      var textareaReadonly = isFormLocked ? 'readonly disabled' : '';

      container.innerHTML = lockedBannerHtml +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-blue-700 via-indigo-800 to-blue-900 text-white p-4 md:p-5 rounded-2xl shadow-md mb-6">' +
        '<div class="flex items-center gap-3.5">' +
        '<div class="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center text-2xl shadow-inner flex-shrink-0">' + commIcon + '</div>' +
        '<div>' +
        '<span class="text-xs text-blue-200 font-medium block">แบบประเมินสำหรับกรรมการ:</span>' +
        '<h2 class="text-lg md:text-xl font-bold text-white flex items-center gap-2">กรรมการ ' + commInfo.name + (commInfo.fullName ? '<span class="text-xs text-blue-200 font-normal">(' + commInfo.fullName + ')</span>' : '') + '</h2>' +
        '</div>' +
        '</div>' +
        '<div class="flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/20">' +
        '<div class="text-right"><div class="text-[11px] text-blue-200">คะแนนรวมถ่วงน้ำหนัก</div>' +
        '<div class="text-2xl font-black text-white"><span id="header-total-weighted">' + scoreTotals.weightedTotal.toFixed(2) + '</span><span class="text-xs text-blue-200 font-normal">/ 100</span></div></div>' +
        '<div class="h-8 w-px bg-white/20"></div>' +
        '<div class="text-right"><div class="text-[11px] text-blue-200">คะแนนดิบ</div>' +
        '<div class="text-lg font-bold text-blue-100"><span id="header-total-raw">' + scoreTotals.rawTotal + '</span><span class="text-xs text-blue-300 font-normal">/ 30</span></div></div>' +
        '</div>' +
        '</div>' +
        milestoneHtml +
        '<div class="mb-8">' +
        '<div class="flex items-center justify-between mb-4">' +
        '<h3 class="text-lg font-bold text-slate-800 flex items-center gap-2"><span class="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</span>เกณฑ์การประเมิน 6 ข้อ (น้ำหนักรวม 100 คะแนน)</h3>' +
        '<span class="text-xs text-slate-500">' + (isFormLocked ? '🔒 ล็อกข้อมูลแล้ว' : 'บันทึกอัตโนมัติ Real-Time') + '</span>' +
        '</div>' +
        criteriaHtml +
        '</div>' +
        '<div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm mb-8">' +
        '<h3 class="text-lg font-bold text-slate-800 flex items-center gap-2 mb-6"><span class="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">2</span>ข้อคิดเห็นเชิงคุณภาพและมติกรรมการ</h3>' +
        '<div class="space-y-6">' +
        '<div>' +
        '<label class="block text-sm font-bold text-slate-700 mb-2"><span class="text-blue-600 font-extrabold">2.</span> โปรดระบุจุดเด่นหรือจุดแข็งของพนักงาน</label>' +
        '<textarea id="input-strengths" rows="3" ' + textareaReadonly + ' oninput="window.app.updateTextField(\'strengths\', this.value)" placeholder="ระบุจุดเด่น ความสามารถเฉพาะทาง หรือความประทับใจจากการสัมภาษณ์..." class="' + textareaClass + '">' + (evalData.strengths || '') + '</textarea>' +
        '</div>' +
        '<div>' +
        '<label class="block text-sm font-bold text-slate-700 mb-2"><span class="text-blue-600 font-extrabold">3.</span> โปรดระบุจุดอ่อนของพนักงานหากผ่านสัมภาษณ์</label>' +
        '<textarea id="input-weaknesses" rows="3" ' + textareaReadonly + ' oninput="window.app.updateTextField(\'weaknesses\', this.value)" placeholder="ระบุจุดที่ควรพัฒนาเพิ่มเติม ข้อจำกัด หรือข้อควรระวัง..." class="' + textareaClass + '">' + (evalData.weaknesses || '') + '</textarea>' +
        '</div>' +
        '<div>' +
        '<label class="block text-sm font-bold text-slate-700 mb-2"><span class="text-blue-600 font-extrabold">4.</span> โปรดแสดงความคิดเห็นเกี่ยวกับความมุ่งมั่นของพนักงานที่จะกลับมาพัฒนาองค์กร</label>' +
        '<textarea id="input-commitment" rows="3" ' + textareaReadonly + ' oninput="window.app.updateTextField(\'commitment\', this.value)" placeholder="ความมุ่งมั่นในการนำความรู้กลับมาต่อยอดธุรกิจ หรือ Action Plan หลังจบการศึกษา..." class="' + textareaClass + '">' + (evalData.commitment || '') + '</textarea>' +
        '</div>' +
        '<div>' +
        '<label class="block text-sm font-bold text-slate-700 mb-2"><span class="text-blue-600 font-extrabold">5.</span> ข้อคิดเห็นอื่นๆ (ถ้ามี)</label>' +
        '<textarea id="input-comments" rows="2" ' + textareaReadonly + ' oninput="window.app.updateTextField(\'comments\', this.value)" placeholder="ข้อเสนอแนะเพิ่มเติมสำหรับผู้บริหารหรือคณะกรรมการ..." class="' + textareaClass + '">' + (evalData.comments || '') + '</textarea>' +
        '</div>' +
        '</div>' +
        '<div class="pt-6 mt-6 border-t-2 border-slate-200">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">' +
        '<label class="text-base font-black text-slate-800 flex items-center gap-2">' +
        '<span class="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-black">6</span>' +
        '<span>มติของกรรมการสัมภาษณ์</span>' +
        '</label>' +
        '<span class="text-xs font-bold ' + (evalData.verdict === 'PASS' ? 'text-emerald-600' : evalData.verdict === 'FAIL' ? 'text-rose-600' : 'text-slate-400') + '">' +
        (isFormLocked ? (evalData.verdict === 'PASS' ? '🔒 ล็อกมติแล้ว: ผ่านการคัดเลือก' : '🔒 ล็อกมติแล้ว: ไม่ผ่านการคัดเลือก') : '⏳ คลิกเลือกมติเพื่อยืนยันผลการประเมิน') +
        '</span>' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
        '<button type="button" ' + (isFormLocked ? 'disabled' : 'onclick="window.app.openConfirmVerdictModal(\'PASS\')"') + ' class="relative flex items-center gap-3.5 p-4 rounded-2xl font-bold transition-all duration-200 text-left ' +
        (evalData.verdict === 'PASS'
          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/30 ring-4 ring-emerald-500/20 border-2 border-emerald-600 scale-[1.01]'
          : (isFormLocked
            ? 'bg-slate-100 border-2 border-slate-200 text-slate-400 opacity-30 cursor-not-allowed'
            : (evalData.verdict === 'FAIL'
              ? 'bg-white border-2 border-slate-200 text-slate-500 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50/50 shadow-sm opacity-70 hover:opacity-100'
              : 'bg-white border-2 border-slate-200 text-slate-700 hover:border-emerald-500 hover:bg-emerald-50/50 hover:text-emerald-700 shadow-sm'))) +
        '">' +
        '<span class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-black ' +
        (evalData.verdict === 'PASS' ? 'bg-white text-emerald-600 shadow-sm' : 'bg-emerald-100 text-emerald-700') +
        '">✓</span>' +
        '<div>' +
        '<div class="text-sm md:text-base font-extrabold leading-tight">ผ่านการคัดเลือก</div>' +
        '</div>' +
        '</button>' +
        '<button type="button" ' + (isFormLocked ? 'disabled' : 'onclick="window.app.openConfirmVerdictModal(\'FAIL\')"') + ' class="relative flex items-center gap-3.5 p-4 rounded-2xl font-bold transition-all duration-200 text-left ' +
        (evalData.verdict === 'FAIL'
          ? 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg shadow-rose-600/30 ring-4 ring-rose-500/20 border-2 border-rose-600 scale-[1.01]'
          : (isFormLocked
            ? 'bg-slate-100 border-2 border-slate-200 text-slate-400 opacity-30 cursor-not-allowed'
            : (evalData.verdict === 'PASS'
              ? 'bg-white border-2 border-slate-200 text-slate-500 hover:border-rose-400 hover:text-rose-700 hover:bg-rose-50/50 shadow-sm opacity-70 hover:opacity-100'
              : 'bg-white border-2 border-slate-200 text-slate-700 hover:border-rose-500 hover:bg-rose-50/50 hover:text-rose-700 shadow-sm'))) +
        '">' +
        '<span class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-black ' +
        (evalData.verdict === 'FAIL' ? 'bg-white text-rose-600 shadow-sm' : 'bg-rose-100 text-rose-700') +
        '">✕</span>' +
        '<div>' +
        '<div class="text-sm md:text-base font-extrabold leading-tight">ไม่ผ่านการคัดเลือก</div>' +
        '</div>' +
        '</button>' +
        '</div>' +
        '</div>' +
        '</div>';
    } else {
      updateScoreElementsOnly(evalData, scoreTotals);
    }
  } catch (err) {
    console.error('Error rendering evaluator form:', err);
  }
}

  function updateScoreElementsOnly(evalData, scoreTotals) {
    var hWeighted = document.getElementById('header-total-weighted');
    var hRaw = document.getElementById('header-total-raw');
    if (hWeighted) hWeighted.innerText = scoreTotals.weightedTotal.toFixed(2);
    if (hRaw) hRaw.innerText = scoreTotals.rawTotal;

    var scoreStyles = {
      1: {
        unselected: 'bg-rose-50/70 text-rose-700 hover:bg-rose-100 hover:border-rose-300 border-rose-200 border',
        selected: 'bg-gradient-to-tr from-rose-600 to-red-500 text-white shadow-lg shadow-rose-600/30 ring-2 ring-rose-500 ring-offset-2 scale-[1.03]'
      },
      2: {
        unselected: 'bg-amber-50/70 text-amber-800 hover:bg-amber-100 hover:border-amber-300 border-amber-200 border',
        selected: 'bg-gradient-to-tr from-amber-600 to-orange-500 text-white shadow-lg shadow-amber-600/30 ring-2 ring-amber-500 ring-offset-2 scale-[1.03]'
      },
      3: {
        unselected: 'bg-sky-50/70 text-sky-800 hover:bg-sky-100 hover:border-sky-300 border-sky-200 border',
        selected: 'bg-gradient-to-tr from-sky-600 to-blue-500 text-white shadow-lg shadow-sky-600/30 ring-2 ring-sky-500 ring-offset-2 scale-[1.03]'
      },
      4: {
        unselected: 'bg-blue-50/70 text-blue-800 hover:bg-blue-100 hover:border-blue-300 border-blue-200 border',
        selected: 'bg-gradient-to-tr from-blue-700 via-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/30 ring-2 ring-indigo-500 ring-offset-2 scale-[1.03]'
      },
      5: {
        unselected: 'bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-300 border-emerald-200 border',
        selected: 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-600/30 ring-2 ring-emerald-500 ring-offset-2 scale-[1.03]'
      }
    };

    if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.criteria) {
      window.ASSESSMENT_DATA.criteria.forEach(function (c) {
        var raw = Number(evalData.scores[c.id]) || 0;
        var weighted = window.ASSESSMENT_DATA.calculateCriterionWeightedScore(raw, c.weight);
        var wEl = document.getElementById('weighted-score-' + c.id);
        if (wEl) wEl.innerText = weighted.toFixed(2);

        var rDesc = document.getElementById('rubric-desc-' + c.id);
        if (rDesc) {
          rDesc.innerText = raw > 0 ? (c.rubric && c.rubric[raw] ? c.rubric[raw] : ('ระดับคะแนน ' + raw)) : 'โปรดเลือกระดับคะแนน (1 - 5)';
          rDesc.className = 'text-xs ' + (raw === 5 ? 'text-emerald-700 font-bold' : raw === 4 ? 'text-indigo-700 font-bold' : raw === 3 ? 'text-sky-700 font-bold' : raw === 2 ? 'text-amber-700 font-bold' : raw === 1 ? 'text-rose-700 font-bold' : 'text-slate-400 font-normal');
        }

        var card = document.getElementById('criteria-card-' + c.id);
        if (card) {
          var btns = card.querySelectorAll('button[onclick*="setCriteriaScore"]');
          btns.forEach(function (btn, idx) {
            var scoreVal = idx + 1;
            var isSel = (raw === scoreVal);
            var st = scoreStyles[scoreVal] || scoreStyles[3];
            btn.className = 'group relative flex-1 py-2.5 sm:py-3 px-1 sm:px-2 rounded-xl text-center font-bold text-sm md:text-base transition-all duration-150 ' + (isSel ? st.selected : st.unselected);
          });
        }
      });
    }
  }

  function setCriteriaScore(criteriaId, score) {
    var commId = state.currentCommitteeId;
    var candId = state.activeCandidateId;

    if (!state.evaluations[candId]) state.evaluations[candId] = {};
    if (!state.evaluations[candId][commId]) state.evaluations[candId][commId] = { scores: {} };

    state.evaluations[candId][commId].scores[criteriaId] = score;
    state.evaluations[candId][commId].updatedAt = Date.now();

    saveState(true);
    renderEvaluatorForm(false); // In-place DOM update for maximum 60fps speed
    renderCandidateCardBanner();
    renderCommitteeNav();
  }

  function applyScorePreset(score) {
    var commId = state.currentCommitteeId;
    var candId = state.activeCandidateId;

    if (!state.evaluations[candId]) state.evaluations[candId] = {};
    if (!state.evaluations[candId][commId]) state.evaluations[candId][commId] = { scores: {} };

    if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.criteria) {
      window.ASSESSMENT_DATA.criteria.forEach(function (c) {
        state.evaluations[candId][commId].scores[c.id] = score;
      });
    }
    state.evaluations[candId][commId].updatedAt = Date.now();

    saveState(true);
    renderEvaluatorForm(false);
    renderCandidateCardBanner();
    renderCommitteeNav();
  }

  function clearAllScores() {
    var commId = state.currentCommitteeId;
    var candId = state.activeCandidateId;

    if (!state.evaluations[candId]) state.evaluations[candId] = {};
    if (!state.evaluations[candId][commId]) state.evaluations[candId][commId] = { scores: {} };

    if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.criteria) {
      window.ASSESSMENT_DATA.criteria.forEach(function (c) {
        state.evaluations[candId][commId].scores[c.id] = 0;
      });
    }
    state.evaluations[candId][commId].updatedAt = Date.now();

    saveState(true);
    renderEvaluatorForm(false);
    renderCandidateCardBanner();
    renderCommitteeNav();
  }

  function appendQuickTag(field, tagText) {
    var cleanTag = tagText.replace(/^[🌟⚠️🚀💬]\s*/, '');
    var textarea = document.getElementById('input-' + field);
    if (!textarea) return;

    var currentVal = textarea.value.trim();
    if (currentVal.length > 0) {
      currentVal += '\n• ' + cleanTag;
    } else {
      currentVal = '• ' + cleanTag;
    }

    textarea.value = currentVal;
    updateTextField(field, currentVal);
  }

  function updateTextField(field, value) {
    var commId = state.currentCommitteeId;
    var candId = state.activeCandidateId;

    if (!state.evaluations[candId]) state.evaluations[candId] = {};
    if (!state.evaluations[candId][commId]) state.evaluations[candId][commId] = { scores: {} };

    state.evaluations[candId][commId][field] = value;
    state.evaluations[candId][commId].updatedAt = Date.now();

    saveState(true);
  }

  function setVerdict(verdict) {
    var commId = state.currentCommitteeId;
    var candId = state.activeCandidateId;

    if (!state.evaluations[candId]) state.evaluations[candId] = {};
    if (!state.evaluations[candId][commId]) state.evaluations[candId][commId] = { scores: {} };

    state.evaluations[candId][commId].verdict = verdict;
    state.evaluations[candId][commId].isSubmitted = true; // Final step auto-submits & confirms
    state.evaluations[candId][commId].updatedAt = Date.now();

    saveState(true, true); // Immediately push to Google Sheets and broadcast
    renderEvaluatorForm(true);
    renderCandidateCardBanner();
    renderCommitteeNav();
    showToast('📤 บันทึกและส่งผลการประเมินไปยัง Google Sheets สำเร็จเรียบร้อย!', 'success');

    if (typeof confetti !== 'undefined' && verdict === 'PASS') {
      confetti({
        particleCount: 75,
        spread: 60,
        origin: { y: 0.75 }
      });
    }
  }

  function openConfirmVerdictModal(verdict) {
    var candId = state.activeCandidateId;
    var commId = state.currentCommitteeId;
    var cand = state.candidates.find(function (c) { return c.id === candId; }) || {};
    var comm = window.ASSESSMENT_DATA.committees.find(function (c) { return c.id === commId; }) || { id: commId, name: commId };
    var evalData = (state.evaluations[candId] && state.evaluations[candId][commId]) ? state.evaluations[candId][commId] : { scores: {} };
    var totals = window.ASSESSMENT_DATA.calculateTotalScores(evalData.scores || {});

    var modal = document.getElementById('confirm-verdict-modal');
    var card = document.getElementById('confirm-verdict-card');
    var content = document.getElementById('confirm-verdict-content');
    if (!modal || !content) return;

    // Check if all 6 criteria are rated
    var unratedCriteria = [];
    if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.criteria) {
      window.ASSESSMENT_DATA.criteria.forEach(function (c) {
        var sc = Number(evalData.scores && evalData.scores[c.id]) || 0;
        if (sc <= 0) {
          unratedCriteria.push(c);
        }
      });
    }

    if (unratedCriteria.length > 0) {
      content.innerHTML =
        '<div class="p-6 bg-gradient-to-r from-amber-500 to-orange-600 text-white flex items-center justify-between border-b border-amber-600">' +
        '<div class="flex items-center gap-3">' +
        '<div class="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-black">⚠️</div>' +
        '<div>' +
        '<h3 class="text-lg font-black tracking-tight">ยังให้คะแนนไม่ครบทุกข้อ</h3>' +
        '<p class="text-xs text-amber-100">โปรดให้คะแนนเกณฑ์การประเมินให้ครบทั้ง 6 ข้อก่อนยืนยันมติ</p>' +
        '</div>' +
        '</div>' +
        '<button type="button" onclick="window.app.closeConfirmVerdictModal()" class="w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors">✕</button>' +
        '</div>' +

        '<div class="p-6 space-y-4">' +
        '<div class="text-xs font-semibold text-slate-700">' +
        'ท่านยังไม่ได้ให้คะแนนใน <span class="font-bold text-rose-600">' + unratedCriteria.length + ' ข้อ</span> ดังต่อไปนี้:' +
        '</div>' +
        '<div class="space-y-2 max-h-48 overflow-y-auto pr-1">' +
        unratedCriteria.map(function (c) {
          return '<div class="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between text-xs">' +
            '<div class="flex items-center gap-2 font-bold text-rose-800 truncate mr-2">' +
            '<span>' + (c.icon || '📌') + '</span><span class="truncate">ข้อที่ ' + c.id + ': ' + c.title + ' (น้ำหนัก ' + c.weight + '%)</span>' +
            '</div>' +
            '<button type="button" onclick="window.app.closeConfirmVerdictModal(); window.app.scrollToCriterion(' + c.id + ')" class="px-2.5 py-1 rounded-lg bg-white border border-rose-300 text-rose-700 font-bold hover:bg-rose-100 flex-shrink-0 shadow-2xs">ไปให้คะแนน ➔</button>' +
            '</div>';
        }).join('') +
        '</div>' +
        '<div class="p-3.5 rounded-xl bg-slate-100 text-slate-600 text-xs leading-relaxed">' +
        '💡 เกณฑ์การพิจารณาทุนกำหนดให้ต้องมีคะแนนครบทั้ง 6 ข้อ เพื่อคำนวณตามค่าน้ำหนัก 100 คะแนนเต็มอย่างถูกต้องและเป็นธรรม' +
        '</div>' +
        '</div>' +

        '<div class="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">' +
        '<button type="button" onclick="window.app.closeConfirmVerdictModal(); window.app.scrollToCriterion(' + unratedCriteria[0].id + ')" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs md:text-sm shadow-md transition-all">' +
        'กลับไปให้คะแนนข้อที่เหลือ' +
        '</button>' +
        '</div>';

      modal.classList.remove('hidden');
      requestAnimationFrame(function () {
        card.classList.remove('scale-95', 'opacity-0');
        card.classList.add('scale-100', 'opacity-100');
      });
      return;
    }

    var isPass = (verdict === 'PASS');
    var verdictTitle = isPass ? 'ผ่านการคัดเลือก' : 'ไม่ผ่านการคัดเลือก';
    var verdictColor = isPass ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-700';
    var verdictIcon = isPass ? '✓' : '✕';

    content.innerHTML = 
      '<div class="p-4 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-between border-b border-blue-900/60">' +
      '<div class="flex items-center gap-2.5">' +
      '<div class="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-base font-bold">🔒</div>' +
      '<div>' +
      '<h3 class="text-base font-black tracking-tight leading-tight">ยืนยันมติการประเมิน</h3>' +
      '<p class="text-[11px] text-slate-300 leading-tight">โปรดตรวจสอบความถูกต้องก่อนยืนยันมติ</p>' +
      '</div>' +
      '</div>' +
      '<button type="button" onclick="window.app.closeConfirmVerdictModal()" class="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center text-xs transition-colors">✕</button>' +
      '</div>' +

      '<div class="p-4 space-y-3">' +
      // Candidate info: Name ONLY with compact photo
      '<div class="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">' +
      (cand.photoUrl ? '<img src="' + cand.photoUrl + '" class="w-10 h-10 rounded-lg object-cover object-top border border-slate-300 shadow-xs flex-shrink-0">' : '<div class="w-10 h-10 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-sm flex-shrink-0">' + (cand.name ? cand.name.charAt(0) : 'C') + '</div>') +
      '<div class="flex-1 min-w-0">' +
      '<span class="text-[10px] text-slate-400 font-medium block leading-none mb-1">ผู้ขอรับทุน:</span>' +
      '<div class="text-sm font-black text-slate-900 truncate leading-tight">' + (cand.name || '') + '</div>' +
      '</div>' +
      '</div>' +

      '<div class="grid grid-cols-2 gap-2.5">' +
      '<div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">' +
      '<div class="text-[10px] text-slate-500 font-semibold">กรรมการผู้ประเมิน</div>' +
      '<div class="text-xs font-bold text-slate-800 mt-0.5 truncate">' + comm.name + (comm.fullName ? ' (' + comm.fullName + ')' : '') + '</div>' +
      '</div>' +
      '<div class="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-center">' +
      '<div class="text-[10px] text-blue-600 font-semibold">คะแนนรวมถ่วงน้ำหนัก</div>' +
      '<div class="text-base font-black text-blue-700 mt-0.5">' + totals.weightedTotal.toFixed(2) + ' <span class="text-[10px] font-normal text-blue-500">/ 100</span></div>' +
      '</div>' +
      '</div>' +

      '<div class="p-3 rounded-xl border-2 ' + (isPass ? 'border-emerald-500 bg-emerald-50/70 text-emerald-950' : 'border-rose-500 bg-rose-50/70 text-rose-950') + ' flex items-center gap-3">' +
      '<div class="w-8 h-8 rounded-lg ' + verdictColor + ' flex items-center justify-center text-sm font-black shadow-xs flex-shrink-0">' + verdictIcon + '</div>' +
      '<div class="min-w-0 flex-1">' +
      '<div class="text-[10px] font-bold uppercase tracking-wider ' + (isPass ? 'text-emerald-700' : 'text-rose-700') + ' leading-none">มติที่ท่านเลือก:</div>' +
      '<div class="text-sm font-black mt-0.5 leading-tight">' + verdictTitle + '</div>' +
      '</div>' +
      '</div>' +

      '<div class="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] leading-relaxed flex items-start gap-2">' +
      '<span class="text-sm flex-shrink-0">⚠️</span>' +
      '<div>' +
      '<span class="font-bold text-amber-950">คำเตือนสำคัญ:</span> เมื่อกด <strong>"ยืนยันมติ"</strong> แล้ว จะไม่สามารถแก้ไขคะแนนหรือมติได้อีก' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<div class="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">' +
      '<button type="button" onclick="window.app.closeConfirmVerdictModal()" class="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all">' +
      'ยกเลิก' +
      '</button>' +
      '<button type="button" onclick="window.app.confirmFinalVerdict(\'' + verdict + '\')" class="px-4 py-2 rounded-xl ' + (isPass ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30') + ' text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5">' +
      '<span>🔒 ยืนยันมติ</span>' +
      '</button>' +
      '</div>';

    modal.classList.remove('hidden');
    requestAnimationFrame(function () {
      card.classList.remove('scale-95', 'opacity-0');
      card.classList.add('scale-100', 'opacity-100');
    });
  }

  function closeConfirmVerdictModal() {
    var modal = document.getElementById('confirm-verdict-modal');
    var card = document.getElementById('confirm-verdict-card');
    if (!modal || !card) return;
    card.classList.remove('scale-100', 'opacity-100');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(function () {
      modal.classList.add('hidden');
    }, 250);
  }

  function confirmFinalVerdict(verdict) {
    closeConfirmVerdictModal();
    setVerdict(verdict);
  }

  function scrollToCriterion(criteriaId) {
    var el = document.getElementById('criteria-card-' + criteriaId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-amber-400');
      setTimeout(function () {
        el.classList.remove('ring-4', 'ring-amber-400');
      }, 2500);
    }
  }

  function submitEvaluation() {
    var commId = state.currentCommitteeId;
    var candId = state.activeCandidateId;

    if (!state.evaluations[candId]) state.evaluations[candId] = {};
    if (!state.evaluations[candId][commId]) state.evaluations[candId][commId] = { scores: {} };

    state.evaluations[candId][commId].isSubmitted = true;
    state.evaluations[candId][commId].updatedAt = Date.now();

    saveState(true, true);
    renderEvaluatorForm(true);
    renderCandidateCardBanner();
    renderCommitteeNav();
    showToast('✅ บันทึกและส่งผลการประเมินไปยัง Google Sheets เรียบร้อยแล้ว!', 'success');
  }

  // ==========================================
  // VIEW 3: ONE-PAGE CANDIDATE COMPARISON MATRIX
  // ==========================================
  function renderComparisonView() {
    var container = document.getElementById('comparison-container');
    if (!container || !window.ASSESSMENT_DATA) return;

    var candidates = state.candidates;
    var committees = window.ASSESSMENT_DATA.committees;

    var candidateCardsHtml = candidates.map(function (c, idx) {
      var isSelected = (c.id === state.activeCandidateId);
      var candEvals = state.evaluations[c.id] || {};

      var totalWeightedScoreSum = 0;
      var passCount = 0;
      var failCount = 0;
      var submittedCount = 0;
      var evaluatedCommCount = 0;

      committees.forEach(function (comm) {
        var ev = candEvals[comm.id];
        if (ev) {
          var t = window.ASSESSMENT_DATA.calculateTotalScores(ev.scores || {});
          totalWeightedScoreSum += t.weightedTotal;
          if (t.weightedTotal > 0) evaluatedCommCount++;
          if (ev.verdict === 'PASS') passCount++;
          if (ev.verdict === 'FAIL') failCount++;
          if (ev.isSubmitted) submittedCount++;
        }
      });
      var avgScore = evaluatedCommCount > 0 ? (totalWeightedScoreSum / evaluatedCommCount).toFixed(2) : '0.00';
      var isFutureLeader = (c.nineBoxGrid === 'Future Leader');
      var badgeColor = isFutureLeader ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800';

      var photoHtml = c.photoUrl
        ? '<img src="' + c.photoUrl + '" alt="' + c.name + '" class="w-14 h-16 rounded-xl object-cover object-top border-2 border-white shadow-sm ring-1 ring-slate-200 flex-shrink-0 group-hover:scale-105 transition-transform" />'
        : '<div class="w-14 h-16 rounded-xl bg-gradient-to-br ' + (c.avatarColor || 'from-blue-600 to-indigo-700') + ' text-white font-bold flex items-center justify-center text-lg shadow-sm flex-shrink-0">' + (c.name ? c.name.charAt(0) : (idx + 1)) + '</div>';

      return '<div class="bg-white rounded-2xl border ' + (isSelected ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-xl' : 'border-slate-200 shadow-sm') + ' p-4 sm:p-5 flex flex-col justify-between transition-all hover:shadow-md h-full">' +
        '<div class="space-y-3">' +
        
        // 1. Header: Large Prominent Photo Banner with Gradient Overlay & Status
        '<div class="relative rounded-2xl overflow-hidden mb-3 bg-gradient-to-b from-slate-100 to-slate-200 border border-slate-200 shadow-inner group cursor-pointer" onclick="window.app.openOnePageModal(\'' + c.id + '\')" title="คลิกเพื่อดูสรุป One-Page">' +
        '<div class="w-full h-52 relative overflow-hidden bg-slate-900">' +
        (c.photoUrl
          ? '<img src="' + c.photoUrl + '" alt="' + c.name + '" class="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300" />'
          : '<div class="w-full h-full bg-gradient-to-br ' + (c.avatarColor || 'from-blue-600 to-indigo-700') + ' flex items-center justify-center text-white text-4xl font-black">' + (c.name ? c.name.charAt(0) : (idx + 1)) + '</div>') +
        '<div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-transparent"></div>' +
        '<div class="absolute top-2.5 left-2.5">' +
        '<span class="inline-flex items-center text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-white/90 backdrop-blur-md text-slate-900 shadow-sm">ลำดับที่ ' + (idx + 1) + '</span>' +
        '</div>' +
        '<div class="absolute top-2.5 right-2.5">' +
        '<span class="inline-flex items-center text-[10px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-md ' + (passCount === 5 ? 'bg-emerald-500/90 text-white shadow-sm' : (failCount > 0 ? 'bg-rose-500/90 text-white shadow-sm' : 'bg-slate-900/80 text-white')) + '">' +
        (passCount === 5 ? '🎉 ผ่านเกณฑ์ (5/5)' : (failCount > 0 ? '❌ ไม่ผ่าน' : '⏳ รอผล')) +
        '</span>' +
        '</div>' +
        '<div class="absolute inset-x-0 bottom-0 p-3 text-white">' +
        '<h3 class="font-bold text-sm sm:text-base leading-tight truncate group-hover:text-blue-300 transition-colors drop-shadow-sm" title="' + c.name + '">' + c.name + '</h3>' +
        '<p class="text-[11px] text-blue-200/90 truncate mt-0.5" title="' + (c.nameEn || '') + '">' + (c.nameEn || '') + '</p>' +
        '</div>' +
        '</div>' +
        '</div>' +

        // 2. Badges: 9-Box & Tenure (Fixed Height)
        '<div class="h-6 flex items-center justify-between">' +
        '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ' + badgeColor + ' truncate max-w-[140px]">' +
        (c.nineBoxGrid || 'Future Leader') +
        '</span>' +
        '<span class="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md whitespace-nowrap">' +
        'อายุงาน ' + (c.tenure || '-') + '</span>' +
        '</div>' +

        // 3. Affiliation Box (Fixed Height: h-[40px])
        '<div class="h-[40px] flex items-center bg-slate-50 px-3 rounded-xl border border-slate-100 text-xs">' +
        '<div class="truncate w-full">' +
        '<span class="text-slate-400 text-[10px] block leading-none mb-0.5">สังกัด:</span>' +
        '<span class="font-bold text-blue-700 truncate block leading-tight" title="' + (c.department || c.company || '-') + '">' + (c.department || c.company || '-') + '</span>' +
        '</div>' +
        '</div>' +

        // 4. Course & Institute Box (Fixed Height: h-[54px])
        '<div class="h-[54px] flex flex-col justify-center bg-blue-50/50 px-3 rounded-xl border border-blue-100/60 text-xs">' +
        '<span class="text-slate-400 text-[10px] leading-none mb-0.5">หลักสูตร:</span>' +
        '<span class="font-semibold text-slate-800 leading-tight line-clamp-2" title="' + (c.programName || c.degreeLevel) + '">' + (c.programName || c.degreeLevel) + '</span>' +
        '</div>' +

        // 5. Budget Box (Fixed Height: h-[36px])
        '<div class="h-[36px] flex items-center justify-between px-3 bg-amber-50/70 rounded-xl border border-amber-200/60 text-xs">' +
        '<span class="text-slate-500 text-[11px]">งบประมาณ:</span>' +
        '<span class="font-black text-amber-700">' + (c.tuitionFee || '-') + '</span>' +
        '</div>' +

        // 6. Live Score & Consensus Box (Fixed Height: h-[68px])
        '<div class="h-[68px] p-3 rounded-xl bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white text-xs flex items-center justify-between shadow-sm">' +
        '<div>' +
        '<span class="text-[10px] text-blue-300 block">คะแนนเฉลี่ย</span>' +
        '<span class="text-2xl font-black text-white">' + avgScore + '</span>' +
        '<span class="text-[10px] text-blue-300">/ 100</span>' +
        '</div>' +
        '<div class="text-right">' +
        '<span class="text-[10px] text-blue-300 block">มติปัจจุบัน</span>' +
        '<span class="font-bold ' + (passCount === 5 ? 'text-emerald-400' : (failCount > 0 ? 'text-rose-400' : 'text-slate-300')) + '">' +
        (passCount === 5 ? '✓ ผ่านเอกฉันท์ (5/5)' : (failCount > 0 ? 'ไม่ผ่าน (ผ่าน ' + passCount + '/5)' : 'รอผล (' + submittedCount + '/5)')) +
        '</span>' +
        '<span class="text-[10px] text-slate-400 block">ส่งแล้ว ' + submittedCount + '/5 ท่าน</span>' +
        '</div>' +
        '</div>' +

        '</div>' +

        // 7. Action Buttons
        '<div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100">' +
        '<button type="button" onclick="window.app.openOnePageModal(\'' + c.id + '\')" class="py-2 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center gap-1 transition-all">' +
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>' +
        '<span>One-Page</span>' +
        '</button>' +
        '<button type="button" onclick="window.app.startEvaluation(\'' + c.id + '\')" class="py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 flex items-center justify-center gap-1 transition-all">' +
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>' +
        '<span>ประเมิน</span>' +
        '</button>' +
        '</div>' +
        '</div>';
    }).join('');

    container.innerHTML = '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">' +
      '<div><h2 class="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2"><span>สรุปข้อมูล One-Page ผู้ขอรับทุนการศึกษา (4 ท่าน)</span><span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">BAFS Scholarship</span></h2>' +
      '<p class="text-xs md:text-sm text-slate-500 mt-0.5">ข้อมูลหลักสูตร สถาบัน ค่าใช้จ่าย 9-Box Grid และความเห็นผู้บังคับบัญชา เพื่อประกอบการสัมภาษณ์</p></div>' +
      '<div class="flex items-center gap-2">' +
      '<button type="button" onclick="window.print()" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs shadow-sm transition-all">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>' +
      '<span>พิมพ์ตารางสรุป One-Page</span></button>' +
      '</div></div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 items-stretch">' +
      candidateCardsHtml +
      '</div>';
  }

  // ==========================================
  // CANDIDATE MANAGER VIEW
  // ==========================================
  // ==========================================
  // VIEW 4: ADMIN CONTROL CENTER
  // ==========================================
    function loadDemoData() {
    if (!confirm('🧪 คุณต้องการสร้างข้อมูลผลการประเมินจำลอง (Demo Data) หรือไม่?\n\nระบบจะสร้างคะแนน มติ และข้อคิดเห็นที่สมจริงสำหรับผู้สมัครทั้ง 4 ท่านจากกรรมการทั้ง 5 ท่าน เพื่อใช้ในการทดสอบระบบ การแสดงผลกราฟ และการนำเสนอ')) {
      return;
    }

    if (!window.ASSESSMENT_DATA) return;
    var candidates = state.candidates;
    var committees = window.ASSESSMENT_DATA.committees;

    var demoTemplates = {
      1: {
        scoresByComm: {
          EM: { 1: 5, 2: 4, 3: 4, 4: 5, 5: 4, 6: 4 },
          'MD-BPT': { 1: 5, 2: 5, 3: 4, 4: 4, 5: 5, 6: 4 },
          'MD-TARCO': { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 },
          'MD-BPS': { 1: 4, 2: 5, 3: 4, 4: 5, 5: 4, 6: 4 },
          HZ: { 1: 5, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 }
        },
        verdicts: { EM: 'PASS', 'MD-BPT': 'PASS', 'MD-TARCO': 'PASS', 'MD-BPS': 'PASS', HZ: 'PASS' },
        strengths: 'มีความเป็นผู้นำ มีความเชี่ยวชาญด้านเทคนิคคลังน้ำมัน และมีความพร้อมในการบริหารระดับสูง',
        weaknesses: 'เสริมมุมมองด้าน Strategic Financial Management เพิ่มเติม',
        commitment: 'พร้อมนำความรู้มาพัฒนาระบบ Operation & Logistics ของกลุ่มบริษัท BAFS ให้มีมาตรฐานระดับสากล',
        comments: 'ผู้สมัครมีความพร้อมสูงทั้งด้านทักษะและความผูกพันต่อองค์กร เห็นควรสนับสนุนให้รับทุนการศึกษา'
      },
      2: {
        scoresByComm: {
          EM: { 1: 5, 2: 5, 3: 4, 4: 5, 5: 5, 6: 4 },
          'MD-BPT': { 1: 4, 2: 5, 3: 5, 4: 4, 5: 4, 6: 4 },
          'MD-TARCO': { 1: 5, 2: 5, 3: 4, 4: 4, 5: 4, 6: 5 },
          'MD-BPS': { 1: 5, 2: 4, 3: 4, 4: 5, 5: 5, 6: 4 },
          HZ: { 1: 4, 2: 5, 3: 4, 4: 4, 5: 4, 6: 4 }
        },
        verdicts: { EM: 'PASS', 'MD-BPT': 'PASS', 'MD-TARCO': 'PASS', 'MD-BPS': 'PASS', HZ: 'PASS' },
        strengths: 'เชี่ยวชาญด้านบริหารจัดการข้อมูลและระบบสารสนเทศ มีความมุ่งมั่นและวิสัยทัศน์ที่ชัดเจน',
        weaknesses: 'ขยายเครือข่ายความร่วมมือข้ามสายงานและการจัดการความเปลี่ยนแปลง',
        commitment: 'นำความรู้ Data Architecture และ Digital Strategy มาขับเคลื่อน Digital Transformation ขององค์กร',
        comments: 'หลักสูตรตรงกับสายงานและทิศทางการพัฒนาเทคโนโลยีของกลุ่มบริษัท เห็นชอบอย่างยิ่ง'
      },
      3: {
        scoresByComm: {
          EM: { 1: 4, 2: 4, 3: 3, 4: 4, 5: 4, 6: 3 },
          'MD-BPT': { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 },
          'MD-TARCO': { 1: 4, 2: 3, 3: 4, 4: 3, 5: 4, 6: 4 },
          'MD-BPS': { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 3 },
          HZ: { 1: 3, 2: 4, 3: 3, 4: 4, 5: 3, 6: 4 }
        },
        verdicts: { EM: 'PASS', 'MD-BPT': 'PASS', 'MD-TARCO': 'PASS', 'MD-BPS': 'PASS', HZ: 'PASS' },
        strengths: 'มีทักษะการวางแผนโครงการที่ดี ละเอียดรอบคอบ และมีความรับผิดชอบสูง',
        weaknesses: 'พัฒนาทักษะการสื่อสารโน้มน้าวใจในระดับบริหาร',
        commitment: 'มุ่งมั่นนำแนวคิดบริหารโครงการมาเพิ่มประสิทธิภาพต้นทุนในสายงาน',
        comments: 'มีศักยภาพในการเติบโตเป็นผู้บริหารระดับโครงการ เห็นควรสนับสนุน'
      },
      4: {
        scoresByComm: {
          EM: { 1: 4, 2: 4, 3: 4, 4: 3, 5: 4, 6: 3 },
          'MD-BPT': { 1: 4, 2: 4, 3: 3, 4: 4, 5: 3, 6: 4 },
          'MD-TARCO': { 1: 4, 2: 4, 3: 4, 4: 3, 5: 4, 6: 4 },
          'MD-BPS': { 1: 3, 2: 4, 3: 3, 4: 4, 5: 4, 6: 3 },
          HZ: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 }
        },
        verdicts: { EM: 'PASS', 'MD-BPT': 'PASS', 'MD-TARCO': 'PASS', 'MD-BPS': 'PASS', HZ: 'PASS' },
        strengths: 'มีวินัยการทำงานสูง มีความตั้งใจเรียนรู้สิ่งใหม่ๆ ตลอดเวลา',
        weaknesses: 'เพิ่มประสบการณ์การบริหารจัดการทีมงานขนาดใหญ่',
        commitment: 'พร้อมนำความรู้ด้านการจัดการมาปรับปรุงกระบวนการทำงานให้รวดเร็วและมีประสิทธิภาพ',
        comments: 'มีความตั้งใจสูงและมีเป้าหมายการเรียนที่ชัดเจน เห็นควรสนับสนุน'
      }
    };

    if (!state.evaluations) state.evaluations = {};

    candidates.forEach(function (cand, idx) {
      var candKey = (idx + 1);
      var template = demoTemplates[candKey] || demoTemplates[1];

      if (!state.evaluations[cand.id]) {
        state.evaluations[cand.id] = {};
      }

      committees.forEach(function (comm) {
        var commScores = (template.scoresByComm && template.scoresByComm[comm.id])
          ? template.scoresByComm[comm.id]
          : { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 };

        var verdict = (template.verdicts && template.verdicts[comm.id])
          ? template.verdicts[comm.id]
          : 'PASS';

        state.evaluations[cand.id][comm.id] = {
          scores: Object.assign({}, commScores),
          verdict: verdict,
          strengths: template.strengths,
          weaknesses: template.weaknesses,
          commitment: template.commitment,
          comments: template.comments,
          isSubmitted: true,
          updatedAt: Date.now()
        };
      });
    });

    saveState(true);

    if (typeof confetti === 'function') {
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
    }

    renderAdminControlCenter();
    renderDashboard();
    renderCandidateCardBanner();
    renderCommitteeNav();

    alert('🎉 สร้างข้อมูลจำลอง (Demo Data) สำเร็จครบทั้ง 4 ผู้สมัครและกรรมการทั้ง 5 ท่านเรียบร้อยแล้ว!\n\nท่านสามารถทดลองดู Dashboard, กราฟ, ผลคะแนน และส่งออก Excel ได้ทันที');
  }

  function renderAdminControlCenter() {
    var container = document.getElementById('admin-container') || document.getElementById('candidates-manager-container');
    if (!container || !window.ASSESSMENT_DATA) return;

    var candCount = state.candidates.length;
    var totalEvalsSubmitted = 0;
    var committees = window.ASSESSMENT_DATA.committees || [];

    state.candidates.forEach(function (cand) {
      var evals = state.evaluations[cand.id] || {};
      committees.forEach(function (comm) {
        if (evals[comm.id] && evals[comm.id].isSubmitted) {
          totalEvalsSubmitted++;
        }
      });
    });

    var candListHtml = state.candidates.map(function (c, idx) {
      var evals = state.evaluations[c.id] || {};
      var totalScore = 0;
      var subCount = 0;
      var evalCount = 0;
      committees.forEach(function (comm) {
        if (evals[comm.id]) {
          var t = window.ASSESSMENT_DATA.calculateTotalScores(evals[comm.id].scores || {});
          totalScore += t.weightedTotal;
          if (t.weightedTotal > 0) evalCount++;
          if (evals[comm.id].isSubmitted) subCount++;
        }
      });
      var avgScore = evalCount > 0 ? (totalScore / evalCount).toFixed(2) : '0.00';

      return '<tr class="hover:bg-slate-50/80 border-b border-slate-100 transition-colors">' +
        '<td class="px-4 py-3.5 text-center text-xs font-bold text-slate-400">' + (idx + 1) + '</td>' +
        '<td class="px-4 py-3.5 font-bold text-slate-800 text-sm flex items-center gap-3">' +
        (c.photoUrl
          ? '<img src="' + c.photoUrl + '" class="w-10 h-12 rounded-xl object-cover object-top border border-slate-200 shadow-2xs flex-shrink-0" />'
          : '<div class="w-10 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold flex items-center justify-center text-xs shadow-2xs flex-shrink-0">' + (idx + 1) + '</div>') +
        '<div>' +
        '<div class="font-bold text-slate-900">' + c.name + '</div>' +
        (c.nameEn ? '<span class="text-xs text-slate-400 block font-normal">' + c.nameEn + '</span>' : '') +
        '</div></td>' +
        '<td class="px-4 py-3.5 text-slate-600 text-xs">' +
        '<span class="font-bold text-slate-800 block">' + (c.position || '-') + '</span>' +
        '<span class="text-blue-600 font-medium">' + (c.department || c.company || '-') + '</span>' +
        '<span class="text-slate-400 block text-[11px]">อายุงาน ' + (c.tenure || '-') + '</span>' +
        '</td>' +
        '<td class="px-4 py-3.5 text-slate-600 text-xs">' +
        '<span class="inline-block px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold">' + (c.degreeLevel || 'ปริญญาโท') + '</span>' +
        '<span class="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md inline-block mt-1">' + (c.nineBoxGrid || 'Future Leader') + '</span>' +
        '</td>' +
        '<td class="px-4 py-3.5 text-slate-600 text-xs">' +
        '<span class="font-bold text-slate-800 block">' + (c.programName || '-') + '</span>' +
        '<span class="text-slate-500">' + (c.institute || '-') + '</span>' +
        '</td>' +
        '<td class="px-4 py-3.5 text-center">' +
        '<span class="text-sm font-black text-blue-700 block">' + avgScore + '</span>' +
        '<span class="text-[10px] text-slate-400">ส่งแล้ว ' + subCount + '/5</span>' +
        '</td>' +
        '<td class="px-4 py-3.5 text-center">' +
        '<div class="flex items-center justify-center">' +
        '<button type="button" onclick="window.app.deleteCandidate(\'' + c.id + '\')" class="p-1.5 px-2.5 rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-colors flex items-center gap-1.5 text-xs font-semibold" title="ลบรายชื่อผู้ขอรับทุน">' +
        '<svg class="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
        '<span>ลบ</span>' +
        '</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div class="space-y-6">' +
      // Admin Header Hero (Symmetrical & Clean One-Row Layout)
      '<div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-indigo-900/50 flex flex-col xl:flex-row xl:items-center justify-between gap-5">' +
      '<div class="flex items-center gap-4 min-w-0">' +
      '<div class="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-2xl font-black text-indigo-300 flex-shrink-0">⚙️</div>' +
      '<div class="min-w-0">' +
      '<div class="flex items-center gap-2.5 flex-wrap">' +
      '<h2 class="text-xl md:text-2xl font-black text-white whitespace-nowrap">ศูนย์ควบคุมสำหรับผู้ดูแลระบบ</h2>' +
      '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 whitespace-nowrap">Admin Mode</span>' +
      '</div>' +
      '<p class="text-xs md:text-sm text-slate-300 mt-1 truncate">จัดการรายชื่อผู้ขอรับทุนการศึกษา, ตรวจสอบสถานะการส่งคะแนน และส่งออกรายงานสรุปผล</p>' +
      '</div>' +
      '</div>' +
      '<div class="flex items-center gap-3 flex-wrap sm:flex-nowrap flex-shrink-0">' +
      '<button type="button" onclick="window.app.loadDemoData()" class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-indigo-600/30 border border-indigo-400/30 transition-all whitespace-nowrap" title="สร้างผลประเมินจำลองครบ 4 ท่านและกรรมการ 5 ท่าน">' +
      '<span>🧪 สร้างข้อมูลจำลอง (Demo Data)</span></button>' +
      '<button type="button" onclick="window.app.exportToExcel()" class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs md:text-sm shadow-lg shadow-emerald-600/30 transition-all whitespace-nowrap">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
      '<span>ส่งออกรายงาน Master Excel</span></button>' +
      '</div>' +
      '</div>' +

      // 3 Quick Action Cards
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
      // Card 1
      '<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">' +
      '<div>' +
      '<div class="flex items-center justify-between mb-2">' +
      '<span class="text-xs font-bold text-slate-500 uppercase tracking-wider">รายชื่อผู้ขอรับทุน</span>' +
      '<span class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">👥</span>' +
      '</div>' +
      '<div class="text-2xl font-black text-slate-900 mb-1">' + candCount + ' <span class="text-sm font-normal text-slate-500">ท่านในระบบ</span></div>' +
      '<p class="text-xs text-slate-400">โครงสร้างผู้สมัครทุนศึกษา BAFS Group</p>' +
      '</div>' +
      '<div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">' +
      '<button type="button" onclick="window.app.showAddCandidateModal()" class="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span>เพิ่มผู้สมัคร</span></button>' +
      '<button type="button" onclick="window.app.resetDefaultCandidates()" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors" title="รีเซ็ตเป็น 4 ผู้สมัครหลัก">รีเซ็ต 4 ท่าน</button>' +
      '</div>' +
      '</div>' +

      // Card 2
      '<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">' +
      '<div>' +
      '<div class="flex items-center justify-between mb-2">' +
      '<span class="text-xs font-bold text-slate-500 uppercase tracking-wider">สถานะการประเมิน</span>' +
      '<span class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">📊</span>' +
      '</div>' +
      '<div class="text-2xl font-black text-slate-900 mb-1">' + totalEvalsSubmitted + ' <span class="text-sm font-normal text-slate-500">/' + (candCount * 5) + ' ใบประเมิน</span></div>' +
      '<p class="text-xs text-slate-400">ส่งผลคะแนนเรียบร้อยแล้วโดยกรรมการ 5 ท่าน</p>' +
      '</div>' +
      '<div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">' +
      '<button type="button" onclick="window.app.exportToExcel()" class="flex-1 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs border border-emerald-200 transition-colors flex items-center justify-center gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg><span>โหลด Excel</span></button>' +
      '<button type="button" onclick="window.app.adminResetAllEvaluations()" class="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-xs border border-amber-200 transition-colors" title="ล้างคะแนนการประเมินทั้งหมด">ล้างคะแนน</button>' +
      '</div>' +
      '</div>' +

      // Card 3
      '<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">' +
      '<div>' +
      '<div class="flex items-center justify-between mb-2">' +
      '<span class="text-xs font-bold text-slate-500 uppercase tracking-wider">คณะกรรมการสัมภาษณ์</span>' +
      '<span class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">🔒</span>' +
      '</div>' +
      '<div class="text-2xl font-black text-slate-900 mb-1">5 <span class="text-sm font-normal text-slate-500">ท่าน (ครบองค์ประชุม)</span></div>' +
      '<p class="text-xs text-slate-400 truncate">EM, MD-BPT, MD-TARCO, MD-BPS, HZ</p>' +
      '</div>' +
      '<div class="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-xs">' +
      '<span class="text-slate-500 font-medium">ระบบเชื่อมต่อ Real-time:</span>' +
      '<span class="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> พร้อมใช้งาน</span>' +
      '</div>' +
      '</div>' +
      '</div>' +

      // Candidate List Table Card
      '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">' +
      '<div class="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60">' +
      '<div>' +
      '<h3 class="text-base font-bold text-slate-800">รายชื่อผู้ขอรับทุนการศึกษาทั้งหมด</h3>' +
      '<p class="text-xs text-slate-500">จัดการข้อมูลผู้สมัคร ดู One-Page สรุป หรือเข้าสู่หน้าให้คะแนน</p>' +
      '</div>' +
      '<button type="button" onclick="window.app.showAddCandidateModal()" class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-all">' +
      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span>เพิ่มผู้สมัครใหม่</span>' +
      '</button>' +
      '</div>' +
      '<div class="overflow-x-auto"><table class="w-full text-left border-collapse">' +
      '<thead><tr class="bg-slate-100/70 text-slate-700 text-xs uppercase font-bold border-b border-slate-200">' +
      '<th class="px-4 py-3 text-center w-12">#</th>' +
      '<th class="px-4 py-3">ชื่อ-นามสกุล ผู้ขอรับทุน</th>' +
      '<th class="px-4 py-3">ตำแหน่ง / สังกัดฝ่าย</th>' +
      '<th class="px-4 py-3">ระดับทุน / 9-Box</th>' +
      '<th class="px-4 py-3">หลักสูตรและสถาบันที่ตอบรับ</th>' +
      '<th class="px-4 py-3 text-center">คะแนนเฉลี่ย</th>' +
      '<th class="px-4 py-3 text-center">จัดการ</th>' +
      '</tr></thead>' +
      '<tbody>' + candListHtml + '</tbody>' +
      '</table></div>' +
      '</div>' +

      // 4. System Data Cleanup & Reset Section
      '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-5 md:p-6">' +
      '<div class="flex items-center gap-3 mb-4 pb-3 border-b border-slate-100">' +
      '<div class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-lg font-bold">🧹</div>' +
      '<div>' +
      '<h3 class="text-base font-bold text-slate-900">จัดการและล้างข้อมูลระบบ (Data Cleanup & System Reset)</h3>' +
      '<p class="text-xs text-slate-500">เลือกรูปแบบการล้างข้อมูลสำหรับผู้ดูแลระบบ พร้อมระบบยืนยันความปลอดภัย</p>' +
      '</div>' +
      '</div>' +
      '<div class="w-full bg-slate-50 p-5 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">' +
      '<div class="flex-1">' +
      '<div class="flex items-center gap-2 mb-1">' +
      '<span class="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0"></span>' +
      '<h4 class="font-bold text-sm text-slate-800">ล้างผลคะแนนประเมินทั้งหมด (Reset Scores Only)</h4>' +
      '</div>' +
      '<p class="text-xs text-slate-500 leading-relaxed">ล้างคะแนนการประเมิน ข้อคิดเห็น และมติกรรมการทั้งหมดของทุกท่านกลับเป็น 0 (รายชื่อผู้สมัครทั้ง 4 ท่านยังคงอยู่ตามเดิม)</p>' +
      '</div>' +
      '<div class="flex-shrink-0">' +
      '<button type="button" onclick="window.app.adminResetAllEvaluations()" class="w-full sm:w-auto py-2.5 px-6 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm hover:shadow transition-all flex items-center justify-center gap-2">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
      '<span>ล้างคะแนนประเมินทั้งหมด</span>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '</div>';
  }

  function renderCandidateManager() {
    renderAdminControlCenter();
  }

  function showAddCandidateModal() {
    var modal = document.getElementById('add-candidate-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function hideAddCandidateModal() {
    var modal = document.getElementById('add-candidate-modal');
    if (modal) modal.classList.add('hidden');
  }

  function saveNewCandidate() {
    var name = document.getElementById('new-cand-name').value.trim();
    var dept = document.getElementById('new-cand-dept').value.trim();
    var degree = document.getElementById('new-cand-degree').value.trim();
    var inst = document.getElementById('new-cand-institute').value.trim();

    if (!name) {
      alert('โปรดระบุชื่อผู้ขอรับทุน');
      return;
    }

    var newCand = {
      id: 'cand-' + Date.now(),
      name: name,
      department: dept || 'BAFS Group',
      degreeLevel: degree || 'ปริญญาโท',
      institute: inst || '',
      registeredDate: new Date().toISOString().split('T')[0]
    };

    state.candidates.push(newCand);
    state.activeCandidateId = newCand.id;

    saveState(true);
    hideAddCandidateModal();
    renderCandidateSelector();
    renderCandidateManager();
    showToast('เพิ่มผู้ขอรับทุน "' + name + '" เรียบร้อยแล้ว', 'success');
  }

  function deleteCandidate(candId) {
    if (state.candidates.length <= 1) {
      alert('ต้องมีผู้ขอรับทุนอย่างน้อย 1 ท่านในระบบ');
      return;
    }
    if (!confirm('ยืนยันการลบรายชื่อผู้ขอรับทุนนี้?')) return;

    state.candidates = state.candidates.filter(function (c) { return c.id !== candId; });
    if (state.activeCandidateId === candId) {
      state.activeCandidateId = state.candidates[0].id;
    }

    saveState(true);
    renderCandidateSelector();
    renderCandidateManager();
    showToast('ลบรายชื่อเรียบร้อยแล้ว', 'info');
  }

  function adminResetAllEvaluations() {
    if (!confirm('⚠️ คำเตือน: คุณต้องการล้างคะแนนการประเมิน ข้อคิดเห็น และมติกรรมการ "ทั้งหมดทุกท่าน" ใช่หรือไม่?\n(รายชื่อผู้ขอรับทุนจะยังคงอยู่ตามเดิม)')) return;

    state.evaluations = {};
    if (state.candidates && window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.committees) {
      state.candidates.forEach(function (cand) {
        state.evaluations[cand.id] = {};
        window.ASSESSMENT_DATA.committees.forEach(function (comm) {
          state.evaluations[cand.id][comm.id] = {
            scores: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
            strengths: '',
            weaknesses: '',
            commitment: '',
            comments: '',
            verdict: '',
            evaluatorName: comm.name,
            date: new Date().toISOString().split('T')[0],
            isSubmitted: false,
            updatedAt: Date.now()
          };
        });
      });
    }

    saveState(true, true);
    renderAdminControlCenter();
    renderCommitteeNav();
    showToast('ล้างคะแนนการประเมินทั้งหมดในระบบเรียบร้อยแล้ว', 'success');
  }

  function adminFactoryReset() {
    if (!confirm('🚨 คำเตือนขั้นสูง: ต้องการล้างข้อมูลทั้งหมดในระบบ คืนค่ารายชื่อ 4 ท่านตามเอกสาร PDF และล้างผลคะแนนทั้งหมดใช่หรือไม่?')) return;

    if (window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.defaultCandidates) {
      state.candidates = JSON.parse(JSON.stringify(window.ASSESSMENT_DATA.defaultCandidates));
      state.activeCandidateId = state.candidates[0].id;
    }

    state.evaluations = {};
    if (state.candidates && window.ASSESSMENT_DATA && window.ASSESSMENT_DATA.committees) {
      state.candidates.forEach(function (cand) {
        state.evaluations[cand.id] = {};
        window.ASSESSMENT_DATA.committees.forEach(function (comm) {
          state.evaluations[cand.id][comm.id] = {
            scores: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
            strengths: '',
            weaknesses: '',
            commitment: '',
            comments: '',
            verdict: '',
            evaluatorName: comm.name,
            date: new Date().toISOString().split('T')[0],
            isSubmitted: false,
            updatedAt: Date.now()
          };
        });
      });
    }

    saveState(true, true);
    renderCandidateSelector();
    renderAdminControlCenter();
    renderCommitteeNav();
    showToast('รีเซ็ตระบบเป็นค่าเริ่มต้นสมบูรณ์ 100% แล้ว', 'success');
  }

    // ==========================================
  // EXPORT TO EXCEL GENERATOR (MASTER MULTI-SHEET WORKBOOK + LOGS)
  // ==========================================
  function exportToExcel(targetCandId) {
    if (typeof XLSX === 'undefined') {
      alert('กำลังโหลดโมดูล Excel กรุณาลองใหม่อีกครั้ง');
      return;
    }

    var candidates = targetCandId
      ? state.candidates.filter(function (c) { return c.id === targetCandId; })
      : state.candidates;

    if (!candidates || candidates.length === 0) {
      candidates = state.candidates;
    }

    var committees = window.ASSESSMENT_DATA.committees;
    var criteria = window.ASSESSMENT_DATA.criteria;
    var wb = XLSX.utils.book_new();

    // -------------------------------------------------------------
    // SHEET 1: EXECUTIVE_SUMMARY (สรุปภาพรวมเปรียบเทียบผู้สมัครทุกท่าน)
    // -------------------------------------------------------------
    var execSummaryData = [
      [],
      ["", "รายงานสรุปผลการประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา BAFS Group ประจำปี 2569"],
      ["", "วันที่ออกรายงาน: " + new Date().toLocaleString('th-TH'), "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      [],
      [
        "",
        "ลำดับ",
        "ชื่อ - นามสกุล",
        "ตำแหน่ง / สังกัด",
        "ระดับการศึกษา",
        "หลักสูตรที่สมัคร",
        "สถาบันการศึกษา",
        "9-Box Grid",
        "งบประมาณ (บาท)",
        "EM (100)",
        "MD-BPT (100)",
        "MD-TARCO (100)",
        "MD-BPS (100)",
        "HZ (100)",
        "คะแนนเฉลี่ยรวม (100)",
        "มติกรรมการ (ผ่าน/ไม่ผ่าน)",
        "ผลการตัดสิน"
      ]
    ];

    candidates.forEach(function (c, idx) {
      var candEvals = state.evaluations[c.id] || {};
      var commScores = committees.map(function (comm) {
        var ev = candEvals[comm.id] || { scores: {} };
        return window.ASSESSMENT_DATA.calculateTotalScores(ev.scores || {}).weightedTotal;
      });
      var passCount = 0;
      var failCount = 0;
      committees.forEach(function (comm) {
        var ev = candEvals[comm.id];
        if (ev && ev.verdict === 'PASS') passCount++;
        if (ev && ev.verdict === 'FAIL') failCount++;
      });
      var nonZeroScores = commScores.filter(function (s) { return s > 0; });
      var avgScore = nonZeroScores.length > 0 ? Number((nonZeroScores.reduce(function (a, b) { return a + b; }, 0) / nonZeroScores.length).toFixed(2)) : 0;
      var isPass = (passCount === 5);
      var finalVerdict = isPass ? 'ผ่านการคัดเลือก (มติเอกฉันท์ 5/5)' : (failCount > 0 ? 'ไม่ผ่านการคัดเลือก' : 'รอสรุปผล');

      execSummaryData.push([
        "",
        (idx + 1),
        c.name || "-",
        (c.position ? c.position + " " : "") + (c.department || c.company || "-"),
        c.degreeLevel || "ปริญญาโท",
        c.programName || "-",
        c.institute || "-",
        c.nineBoxGrid || "Future Leader",
        c.tuitionNumber || (c.tuitionFee || "-"),
        commScores[0],
        commScores[1],
        commScores[2],
        commScores[3],
        commScores[4],
        avgScore,
        "ผ่าน " + passCount + " / ไม่ผ่าน " + failCount,
        finalVerdict
      ]);
    });

    var execWs = XLSX.utils.aoa_to_sheet(execSummaryData);
    XLSX.utils.book_append_sheet(wb, execWs, "Executive_Summary");

    // -------------------------------------------------------------
    // SHEETS 2..N: INDIVIDUAL CANDIDATE SUMMARY SHEETS (แยกชีทรายคน)
    // -------------------------------------------------------------
    candidates.forEach(function (cand, idx) {
      var candEvals = state.evaluations[cand.id] || {};
      var shortName = cand.name ? (cand.name.split(' ')[0] || cand.name) : ('Candidate_' + (idx + 1));
      var sheetName = ((idx + 1) + '. ' + shortName).substring(0, 31);

      var candSheetData = [
        [],
        ["", "แบบสรุปผลการประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา (รายบุคคล)"],
        [],
        ["", "ชื่อผู้ขอรับทุน:", cand.name || "", "ตำแหน่ง / สังกัด:", (cand.position || "") + " " + (cand.department || cand.company || "")],
        ["", "ขอรับทุนระดับ:", cand.degreeLevel || "ปริญญาโท", "สถาบันที่ตอบรับ:", cand.institute || ""],
        ["", "หลักสูตร:", cand.programName || "", "9-Box Grid:", cand.nineBoxGrid || "Future Leader"],
        ["", "รูปแบบการเรียน:", cand.studyFormat || "-", "งบประมาณตลอดหลักสูตร:", cand.tuitionFee || "-"],
        [],
        ["", "เกณฑ์การประเมิน", "น้ำหนัก (Weight)", "EM", "MD-BPT", "MD-TARCO", "MD-BPS", "HZ", "คะแนนเฉลี่ย"],
        ["", "", "", "กรรมการ 1", "กรรมการ 2", "กรรมการ 3", "กรรมการ 4", "กรรมการ 5", ""]
      ];

      var criteriaRows = criteria.map(function (crit) {
        var commScores = committees.map(function (comm) {
          var ev = candEvals[comm.id] || { scores: {} };
          var raw = Number(ev.scores[crit.id]) || 0;
          return window.ASSESSMENT_DATA.calculateCriterionWeightedScore(raw, crit.weight);
        });
        var avg = commScores.reduce(function (a, b) { return a + b; }, 0) / commScores.length;

        return [
          "",
          crit.title,
          crit.weight,
          commScores[0],
          commScores[1],
          commScores[2],
          commScores[3],
          commScores[4],
          Number(avg.toFixed(2))
        ];
      });

      criteriaRows.forEach(function (r) { candSheetData.push(r); });

      var commTotals = committees.map(function (comm) {
        var ev = candEvals[comm.id] || { scores: {} };
        return window.ASSESSMENT_DATA.calculateTotalScores(ev.scores || {}).weightedTotal;
      });
      var grandAvg = commTotals.reduce(function (a, b) { return a + b; }, 0) / commTotals.length;

      candSheetData.push([
        "",
        "ผลคะแนนคำนวณตามค่าน้ำหนัก (คะแนนเต็ม 100)",
        100,
        commTotals[0],
        commTotals[1],
        commTotals[2],
        commTotals[3],
        commTotals[4],
        Number(grandAvg.toFixed(2))
      ]);

      candSheetData.push([]);
      candSheetData.push(["", "2. จุดเด่นหรือจุดแข็งของพนักงาน (ข้อคิดเห็นจากคณะกรรมการ 5 ท่าน)"]);
      committees.forEach(function (c) {
        var ev = candEvals[c.id];
        if (ev && ev.strengths) candSheetData.push(["", "• [" + c.name + "]: " + ev.strengths]);
      });

      candSheetData.push([]);
      candSheetData.push(["", "3. จุดอ่อน / จุดที่ควรพัฒนาของพนักงาน (ข้อคิดเห็นจากคณะกรรมการ 5 ท่าน)"]);
      committees.forEach(function (c) {
        var ev = candEvals[c.id];
        if (ev && ev.weaknesses) candSheetData.push(["", "• [" + c.name + "]: " + ev.weaknesses]);
      });

      candSheetData.push([]);
      candSheetData.push(["", "4. ความคิดเห็นเกี่ยวกับความมุ่งมั่นของพนักงานที่จะกลับมาพัฒนาองค์กร"]);
      committees.forEach(function (c) {
        var ev = candEvals[c.id];
        if (ev && ev.commitment) candSheetData.push(["", "• [" + c.name + "]: " + ev.commitment]);
      });

      candSheetData.push([]);
      candSheetData.push(["", "5. ข้อคิดเห็นอื่นๆ"]);
      committees.forEach(function (c) {
        var ev = candEvals[c.id];
        if (ev && ev.comments) candSheetData.push(["", "• [" + c.name + "]: " + ev.comments]);
      });

      candSheetData.push([]);
      var verdictList = committees.map(function (c) {
        var v = (candEvals[c.id] || {}).verdict;
        return c.name + ": " + (v === 'PASS' ? 'ผ่าน' : v === 'FAIL' ? 'ไม่ผ่าน' : 'ยังไม่ลงมติ');
      }).join(' | ');

      var pCount = 0;
      var fCount = 0;
      committees.forEach(function (c) {
        var v = (candEvals[c.id] || {}).verdict;
        if (v === 'PASS') pCount++;
        if (v === 'FAIL') fCount++;
      });
      var finalDecision = (pCount === 5) ? 'ผ่านการคัดเลือก (มติเอกฉันท์ 5/5 ท่าน)' : (fCount > 0 ? 'ไม่ผ่านการคัดเลือก' : 'รอสรุปผล');

      candSheetData.push(["", "6. มติของกรรมการสัมภาษณ์", "", verdictList]);
      candSheetData.push(["", "7. ผลการตัดสินชี้ขาด", "", finalDecision]);

      var candWs = XLSX.utils.aoa_to_sheet(candSheetData);
      XLSX.utils.book_append_sheet(wb, candWs, sheetName);
    });

    // -------------------------------------------------------------
    // SHEET: EVALUATION_LOGS (บันทึกประวัติ Log การประเมิน)
    // -------------------------------------------------------------
    var logData = [
      [],
      ["", "บันทึกประวัติการลงคะแนนและประเมินผลสัมภาษณ์ (Audit Trail & Evaluation Logs)"],
      ["", "สร้างเมื่อ: " + new Date().toLocaleString('th-TH'), "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      [],
      [
        "",
        "ลำดับ",
        "วัน-เวลาบันทึก (Timestamp)",
        "ชื่อผู้ขอรับทุน",
        "กรรมการผู้ประเมิน",
        "กลยุทธ์ BAFS (25%)",
        "ความผูกพัน (25%)",
        "เป้าหมายเรียน (15%)",
        "ภาวะผู้นำ (15%)",
        "การวางแผน (10%)",
        "การมีส่วนร่วม (10%)",
        "คะแนนรวมถ่วงน้ำหนัก (100)",
        "มติกรรมการ",
        "จุดเด่น / จุดแข็ง",
        "จุดที่ควรพัฒนา",
        "ความมุ่งมั่นพัฒนาองค์กร",
        "ข้อคิดเห็นอื่นๆ"
      ]
    ];

    var logIndex = 1;
    candidates.forEach(function (cand) {
      var candEvals = state.evaluations[cand.id] || {};
      committees.forEach(function (comm) {
        var ev = candEvals[comm.id];
        if (ev && (ev.isSubmitted || ev.verdict || (ev.scores && Object.keys(ev.scores).length > 0))) {
          var totals = window.ASSESSMENT_DATA.calculateTotalScores(ev.scores || {});
          var timeStr = ev.updatedAt ? new Date(ev.updatedAt).toLocaleString('th-TH') : new Date().toLocaleString('th-TH');
          logData.push([
            "",
            logIndex++,
            timeStr,
            cand.name || "-",
            comm.name + " (" + comm.fullName + ")",
            Number(ev.scores[1]) || 0,
            Number(ev.scores[2]) || 0,
            Number(ev.scores[3]) || 0,
            Number(ev.scores[4]) || 0,
            Number(ev.scores[5]) || 0,
            Number(ev.scores[6]) || 0,
            totals.weightedTotal,
            ev.verdict === 'PASS' ? 'ผ่าน (PASS)' : (ev.verdict === 'FAIL' ? 'ไม่ผ่าน (FAIL)' : 'ยังไม่ระบุมติ'),
            ev.strengths || "-",
            ev.weaknesses || "-",
            ev.commitment || "-",
            ev.comments || "-"
          ]);
        }
      });
    });

    var logWs = XLSX.utils.aoa_to_sheet(logData);
    XLSX.utils.book_append_sheet(wb, logWs, "Evaluation_Logs");

    var dateStr = new Date().toISOString().slice(0, 10);
    var fileName = "แบบประเมินสัมภาษณ์ทุน_BAFS_Group_Master_" + dateStr + ".xlsx";
    XLSX.writeFile(wb, fileName);
    showToast('ส่งออกไฟล์ Master Excel (' + candidates.length + ' ผู้สมัคร + Logs) สำเร็จ', 'success');
  }// Toast Notification System
  function showToast(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) return;

    container.innerHTML = ''; // prevent stacking

    var toast = document.createElement('div');
    var bgClass = (type === 'success') ? 'bg-emerald-600' : (type === 'warning') ? 'bg-rose-600' : 'bg-slate-800';

    toast.className = 'flex items-center gap-2.5 px-4 py-3 rounded-xl text-white text-xs md:text-sm font-medium shadow-xl ' + bgClass + ' transform transition-all duration-300 translate-y-2 opacity-0';
    toast.innerHTML = '<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' +
      '<span>' + message + '</span>';

    container.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(function () {
      toast.classList.add('opacity-0', '-translate-y-2');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // Setup Event Listeners
  function setupEventListeners() {
    window.addEventListener('resize', function () {
      if (radarChartInstance) radarChartInstance.resize();
      if (barChartInstance) barChartInstance.resize();
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeOnePageModal();
      }
    });
  }

  // Expose API
  // ==========================================
  // GOOGLE SHEETS 2-WAY REAL-TIME SYNC ENGINE
  // ==========================================
  var DEFAULT_GSHEETS_URL = "https://script.google.com/macros/s/AKfycbwaRjgOcfM1Ys6sr3EJFOFORikL4e1Y4242zd9wMVlRui-ycB4BC16fI_no_VfU0Gsd/exec";
  var googleSyncTimer = null;
  var isSyncingWithSheets = false;

  function getEffectiveGSheetsUrl() {
    var stored = localStorage.getItem('BAFS_GSHEETS_URL');
    if (!stored || stored.indexOf('AKfycbyH8mlX4NPCGOZKiH3V9LfpMRoaAhRtTDAYE') > -1) {
      localStorage.setItem('BAFS_GSHEETS_URL', DEFAULT_GSHEETS_URL);
      return DEFAULT_GSHEETS_URL;
    }
    return stored;
  }

  function openGoogleSheetsModal() {
    var modal = document.getElementById('google-sheets-modal');
    var input = document.getElementById('gs-webhook-url');
    if (input) {
      input.value = getEffectiveGSheetsUrl();
    }
    if (modal) modal.classList.remove('hidden');
  }

  function closeGoogleSheetsModal() {
    var modal = document.getElementById('google-sheets-modal');
    if (modal) modal.classList.add('hidden');
  }

  function saveAndSyncGoogleSheets() {
    var input = document.getElementById('gs-webhook-url');
    var url = input ? input.value.trim() : '';
    if (!url) {
      alert('กรุณากรอก Google Apps Script Web App URL');
      return;
    }
    localStorage.setItem('BAFS_GSHEETS_URL', url);
    syncToGoogleSheets(false);
  }

  function syncToGoogleSheets(isAuto) {
    var input = document.getElementById('gs-webhook-url');
    if (input && input.value.trim()) {
      localStorage.setItem('BAFS_GSHEETS_URL', input.value.trim());
    }
    var url = getEffectiveGSheetsUrl();
    if (!url) {
      if (!isAuto) openGoogleSheetsModal();
      return;
    }

    var payload = {
      candidates: state.candidates,
      evaluations: state.evaluations,
      committees: window.ASSESSMENT_DATA.committees,
      timestamp: Date.now()
    };

    fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      state.lastSyncTimestamp = Date.now();
      showSyncIndicator();
      if (!isAuto) {
        showToast('📤 ส่งข้อมูลไปยัง Google Sheets สำเร็จเรียบร้อย!', 'success');
        closeGoogleSheetsModal();
      }
    }).catch(function (err) {
      if (!isAuto) {
        showToast('เกิดข้อผิดพลาดในการส่งข้อมูล: ' + err.message, 'error');
      }
    });
  }

  function syncFromGoogleSheets(isAuto) {
    var input = document.getElementById('gs-webhook-url');
    if (input && input.value.trim()) {
      localStorage.setItem('BAFS_GSHEETS_URL', input.value.trim());
    }
    var url = getEffectiveGSheetsUrl();
    if (!url) {
      if (!isAuto) openGoogleSheetsModal();
      return;
    }
    if (isSyncingWithSheets) return;

    isSyncingWithSheets = true;
    var fetchUrl = url + (url.indexOf('?') > -1 ? '&' : '?') + '_t=' + new Date().getTime();
    
    fetch(fetchUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    }).then(function (response) {
      return response.json();
    }).then(function (res) {
      isSyncingWithSheets = false;
      if (res && res.status === 'success' && res.data) {
        var incoming = res.data;
        if (incoming.evaluations && Object.keys(incoming.evaluations).length > 0) {
          var hasChanges = false;
          Object.keys(incoming.evaluations).forEach(function (candKey) {
            if (!state.evaluations[candKey]) {
              state.evaluations[candKey] = {};
              hasChanges = true;
            }
            var commMap = incoming.evaluations[candKey];
            Object.keys(commMap).forEach(function (commId) {
              var inEv = commMap[commId];
              var localEv = state.evaluations[candKey][commId];

              var isCurrentActiveComm = (commId === state.currentCommitteeId);

              if (inEv.isSubmitted) {
                // Incoming submitted assessment wins over local unsubmitted
                if (localEv && localEv.isSubmitted && localEv.updatedAt && inEv.updatedAt && (localEv.updatedAt > inEv.updatedAt)) {
                  return; // Local submitted is newer
                }
              } else {
                // Incoming is not submitted: protect active committee draft
                if (isCurrentActiveComm) {
                  return;
                }
              }

              if (!localEv || JSON.stringify(inEv.scores) !== JSON.stringify(localEv.scores) || inEv.verdict !== localEv.verdict || inEv.isSubmitted !== localEv.isSubmitted || inEv.comments !== localEv.comments) {
                state.evaluations[candKey][commId] = inEv;
                hasChanges = true;
              }
            });
          });

          if (hasChanges) {
            state.lastSyncTimestamp = Date.now();
            saveState(false);
            if (state.viewMode === 'dashboard') {
              renderDashboard();
            } else if (state.viewMode === 'comparison') {
              renderComparisonView();
            } else if (state.viewMode === 'evaluator') {
              var activeEl = document.activeElement;
              var isFocusedInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
              if (!isFocusedInput) {
                renderEvaluatorForm(false);
              }
            }

            renderCandidateCardBanner();
            renderCommitteeNav();
            renderCandidateSelector();
            showSyncIndicator();
            if (!isAuto) {
              showToast('🔄 ดึงข้อมูลล่าสุดจาก Google Sheets สำเร็จ!', 'success');
              closeGoogleSheetsModal();
            }
          } else if (!isAuto) {
            showToast('ข้อมูลบนเว็บตรงกับ Google Sheets ล่าสุดแล้ว', 'info');
            closeGoogleSheetsModal();
          }
        }
      }
    }).catch(function (err) {
      isSyncingWithSheets = false;
      if (!isAuto) {
        showToast('ไม่สามารถดึงข้อมูลจาก Google Sheets: ' + err.message, 'error');
      }
    });
  }

  function startGoogleSheetsAutoSync() {
    if (googleSyncTimer) clearInterval(googleSyncTimer);
    // Continuous 2-way cloud auto-sync loop (every 3.5s)
    googleSyncTimer = setInterval(function () {
      syncFromGoogleSheets(true);
    }, 3500);

    // Immediate bootsync on startup
    setTimeout(function () {
      syncFromGoogleSheets(true);
    }, 150);

    setTimeout(function () {
      syncFromGoogleSheets(true);
    }, 1500);
  }

  function copyGoogleAppsScriptCode() {
    var code = `// BAFS Group Scholarship Assessment - Google Sheets Integration Script (Code.gs)
// ดูโค้ดฉบับเต็มทั้งหมดได้ในไฟล์ Google_Sheets_Integration_Code.gs ในโฟลเดอร์โครงการ
var SPREADSHEET_ID = "1lPD0rCDg8uLP2JlBMRnaYYa35e-OtkQWf_MwLULIzp4";`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(function () {
        showToast('คัดลอกแล้ว! เปิดดูโค้ดตัวเต็มในไฟล์ Google_Sheets_Integration_Code.gs', 'success');
      });
    } else {
      showToast('ดูโค้ดตัวเต็มได้ในไฟล์ Google_Sheets_Integration_Code.gs', 'info');
    }
  }

  function copyAssessmentJson() {
    var payload = {
      candidates: state.candidates,
      evaluations: state.evaluations,
      committees: window.ASSESSMENT_DATA.committees
    };
    var jsonStr = JSON.stringify(payload, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(jsonStr).then(function () {
        showToast('คัดลอก JSON ผลการประเมินเรียบร้อยแล้ว!', 'success');
      });
    } else {
      showToast('คัดลอกข้อมูลเรียบร้อยแล้ว', 'success');
    }
  }

    function isAdminAuthenticated() {
    return sessionStorage.getItem('BAFS_ADMIN_AUTH') === 'true';
  }

  function openAdminLoginModal() {
    var modal = document.getElementById('admin-login-modal');
    var input = document.getElementById('admin-password-input');
    var error = document.getElementById('admin-login-error');
    if (error) error.classList.add('hidden');
    if (input) {
      input.value = '';
      input.classList.remove('border-rose-500', 'ring-2', 'ring-rose-200');
    }
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(function () {
        if (input) input.focus();
      }, 100);
    }
  }

  function closeAdminLoginModal() {
    var modal = document.getElementById('admin-login-modal');
    if (modal) modal.classList.add('hidden');
  }

  function submitAdminLogin() {
    var input = document.getElementById('admin-password-input');
    var error = document.getElementById('admin-login-error');
    var pwd = input ? input.value : '';

    if (pwd === 'hod2026') {
      sessionStorage.setItem('BAFS_ADMIN_AUTH', 'true');
      closeAdminLoginModal();
      setView('admin');
      showToast('เข้าสู่ระบบผู้ดูแลระบบสำเร็จ', 'success');
    } else {
      if (error) error.classList.remove('hidden');
      if (input) {
        input.classList.add('border-rose-500', 'ring-2', 'ring-rose-200');
        input.focus();
        input.select();
      }
    }
  }

  function toggleAdminPasswordVisibility() {
    var input = document.getElementById('admin-password-input');
    var icon = document.getElementById('admin-pwd-toggle-icon');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.innerText = '🙈';
    } else {
      input.type = 'password';
      if (icon) icon.innerText = '👁️';
    }
  }

  function adminLogout() {
    sessionStorage.removeItem('BAFS_ADMIN_AUTH');
    setView('dashboard');
    showToast('ออกจากระบบผู้ดูแลระบบเรียบร้อยแล้ว', 'info');
  }

  window.app = {
    init: init,
    selectCommittee: function (id) { setView('evaluator', id); },
    selectDashboard: function () { setView('dashboard'); },
    selectEvaluator: function () { setView('evaluator'); },
    selectComparison: function () { setView('comparison'); },
    selectCandidatesManager: function () {
      if (isAdminAuthenticated()) {
        setView('admin');
      } else {
        openAdminLoginModal();
      }
    },
    selectAdmin: function () {
      if (isAdminAuthenticated()) {
        setView('admin');
      } else {
        openAdminLoginModal();
      }
    },
    openAdminLoginModal: openAdminLoginModal,
    closeAdminLoginModal: closeAdminLoginModal,
    submitAdminLogin: submitAdminLogin,
    toggleAdminPasswordVisibility: toggleAdminPasswordVisibility,
    adminLogout: adminLogout,
    openOnePageModal: openOnePageModal,
    closeOnePageModal: closeOnePageModal,
    toggleModalFullscreen: toggleModalFullscreen,
    changeActiveCandidate: function (candId) {
      if (candId) {
        state.activeCandidateId = candId;
      }
      if (!state.currentCommitteeId) {
        state.currentCommitteeId = 'EM';
      }
      state.viewMode = 'evaluator'; // Directly open candidate evaluation form
      renderCandidateSelector();
      updateView();
      renderCommitteeNav();
      saveState(true);
    },
    switchDashboardCandidate: function (candId) {
      if (candId) {
        state.activeCandidateId = candId;
      }
      renderCandidateSelector();
      if (state.viewMode === 'dashboard') {
        renderDashboard();
      } else {
        updateView();
      }
      saveState(true);
    },
    setCriteriaScore: setCriteriaScore,
    applyScorePreset: applyScorePreset,
    clearAllScores: clearAllScores,
    appendQuickTag: appendQuickTag,
    updateTextField: updateTextField,
    setVerdict: setVerdict,
    openConfirmVerdictModal: openConfirmVerdictModal,
    closeConfirmVerdictModal: closeConfirmVerdictModal,
    confirmFinalVerdict: confirmFinalVerdict,
    scrollToCriterion: scrollToCriterion,
    submitEvaluation: submitEvaluation,
    loadDemoData: loadDemoData,
    exportToExcel: exportToExcel,
    showAddCandidateModal: showAddCandidateModal,
    hideAddCandidateModal: hideAddCandidateModal,
    saveNewCandidate: saveNewCandidate,
    deleteCandidate: deleteCandidate,
    resetDefaultCandidates: adminFactoryReset,
    adminResetAllEvaluations: adminResetAllEvaluations,
    adminFactoryReset: adminFactoryReset,
    openGoogleSheetsModal: openGoogleSheetsModal,
    closeGoogleSheetsModal: closeGoogleSheetsModal,
    saveAndSyncGoogleSheets: saveAndSyncGoogleSheets,
    syncToGoogleSheets: syncToGoogleSheets,
    syncFromGoogleSheets: syncFromGoogleSheets,
    copyGoogleAppsScriptCode: copyGoogleAppsScriptCode,
    copyAssessmentJson: copyAssessmentJson,
    startEvaluation: function (candId) {
      if (candId) {
        state.activeCandidateId = candId;
      }
      if (!state.currentCommitteeId) {
        state.currentCommitteeId = 'EM';
      }
      setView('evaluator', state.currentCommitteeId);
      renderCandidateSelector();
      saveState(true);
    }
  };

  // Safe Auto-Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
