/* ═══════════════════════════════════════════════════════
   APP.JS — Dashboard logic (auth handled by auth.js)
   launchDashboard() is called by auth.js after login
   ═══════════════════════════════════════════════════════ */

/* ─── App State ─── */
const state = {
  tab: "dashboard",
  sessions: [],
  deviceStatus: null,
  sessionRunning: false,
  sessionStartTime: null,
  timerInterval: null,
  insightText: "",
  isDemo: false,
  lastSync: null,
  geminiKey: (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.geminiApiKey : "") || "",
};

/* ═══════════════════════════
   LAUNCH DASHBOARD
   Called by auth.js after successful login
═══════════════════════════ */
async function launchDashboard() {
  const cfg = APP_CONFIG;
  state.isDemo = false;

  // Load Gemini key from config
  state.geminiKey = cfg.geminiApiKey || "";
  if (state.geminiKey) {
    localStorage.setItem("gemini_api_key", state.geminiKey);
    console.log("[Gemini] API key loaded ✅");
  } else {
    console.warn("[Gemini] No API key in config.js");
  }

  // Reset any stale session state — truth comes from Firebase RTDB only
  state.sessionRunning   = false;
  state.sessionStartTime = null;
  state.deviceStatus     = null;

  // Make UI visible
  showDashboard();
  startSessionTimer();
  initAllCharts();

  // Wire real-time data listeners (these set the true device state)
  listenDeviceStatus(onDeviceStatusUpdate);
  listenDeviceSessions(onSessionsUpdate);

  // Load past AI insights
  const insights = await loadInsightsFromFirestore();
  onInsightsLoaded(insights);

  startAutoRefresh();
}

/* (old setup wizard removed — auth handled by auth.js) */

async function stepProgress(stepId, work) {
  const el = document.getElementById(stepId);
  if (el) {
    el.querySelector(".step-icon").textContent = "⟳";
    el.querySelector(".step-icon").style.color = "var(--violet-bright)";
  }
  await work();
  if (el) {
    el.querySelector(".step-icon").textContent = "✓";
    el.querySelector(".step-icon").style.color = "var(--green)";
  }
}

/* ════════════════════════════════════════
   LOADING / DASHBOARD VISIBILITY
════════════════════════════════════════ */
function showDashboard() {
  ["statusBar", "navbar", "appMain", "mobileBottomNav"].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = "";
    el.style.opacity = "0";
    el.style.transform = "translateY(10px)";
    setTimeout(() => {
      el.style.transition = "all 0.5s cubic-bezier(0.4,0,0.2,1)";
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    }, 80 + i * 60);
  });
  updateStatusBar();
  animateStatCards();
}

function updateStatusBar() {
  const dot  = document.getElementById("sbDot");
  const text = document.getElementById("sbModeText");
  const info = document.getElementById("sbInfo");
  const user = typeof currentUser !== "undefined" ? currentUser : null;

  if (state.isDemo) {
    if (dot)  { dot.style.background = "var(--amber)"; dot.style.boxShadow = "0 0 6px var(--amber)"; }
    if (text) text.textContent = user?.isGuest ? "Demo Guest" : "Local Mode";
    if (info) info.textContent = "All data stored locally on this device";
  } else {
    if (dot)  { dot.style.background = "var(--green)"; dot.style.boxShadow = "0 0 6px var(--green)"; }
    if (text) text.textContent = "Live";
    if (info) info.innerHTML = `Firebase · <strong>@${user?.username || "user"}</strong>`;
  }
  markSync();
}

function markSync() {
  state.lastSync = new Date();
  const el = document.getElementById("sbSyncTime");
  if (el) el.textContent = state.lastSync.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ════════════════════════════════════════
   DATA CALLBACKS
════════════════════════════════════════ */
function onDeviceStatusUpdate(status) {
  state.deviceStatus = status;
  renderDeviceStatus(status);
  markSync();
}

function onSessionsUpdate(sessions) {
  state.sessions = sessions;
  renderAllStats(sessions);
  updateCharts(sessions);
  renderSessionTable(sessions);
  updateChatContext(sessions);
  updateCoachStats(sessions);
  markSync();

  // Auto-generate insight on first real session load
  if (!state.insightText && sessions.length > 0) {
    autoGenerateInsight(sessions);
  }
}

function onInsightsLoaded(insights) {
  renderInsightsTimeline(insights);
}

/* ════════════════════════════════════════
   DEVICE STATUS RENDERING
════════════════════════════════════════ */
function renderDeviceStatus(status) {
  const online  = status?.online ?? false;
  const present = status?.presence ?? false;
  const active  = status?.sessionActive ?? false;
  const startTs = status?.startTime || status?.sessionStart;

  // Navbar pill
  const dot  = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const pill = document.getElementById("devicePill");

  if (online) {
    dot.style.background = "var(--green)";
    dot.style.boxShadow  = "0 0 8px var(--green)";
    text.textContent = present ? "At Desk" : "Online · Away";
    pill.style.background = "rgba(16,185,129,0.1)";
    pill.style.borderColor = "rgba(16,185,129,0.25)";
    pill.style.color = "var(--green)";
  } else {
    dot.style.background = "var(--text-muted)";
    dot.style.boxShadow  = "none";
    dot.style.animation  = "none";
    text.textContent = "Device Offline";
    pill.style.background = "rgba(255,255,255,0.04)";
    pill.style.borderColor = "var(--border)";
    pill.style.color = "var(--text-muted)";
  }

  // Device badge in controls
  const dbadge  = document.getElementById("deviceBadge");
  const dbDot   = document.getElementById("deviceDot");
  const dbText  = document.getElementById("deviceBadgeText");
  if (dbadge && dbDot && dbText) {
    dbDot.className = "dot-pulse " + (online ? "green" : "red");
    dbText.textContent = online ? (present ? "At Desk" : "Online") : "Offline";
    dbadge.style.color = online ? "var(--green)" : "var(--rose)";
  }

  // Presence ring
  const ring   = document.getElementById("presenceRing");
  const icon   = document.getElementById("ringIcon");
  const pStatus = document.getElementById("presenceStatus");
  const pSub   = document.getElementById("presenceSub");

  if (present && active) {
    icon.textContent = "🧑‍💻";
    pStatus.textContent = "At Desk";
    pSub.textContent = "Focused & Active";
    if (ring) ring.style.filter = "none";
  } else if (online && !present) {
    icon.textContent = "☕";
    pStatus.textContent = "Away";
    pSub.textContent = "Taking a break";
    if (ring) ring.style.filter = "grayscale(0.5)";
  } else if (!online) {
    icon.textContent = "😴";
    pStatus.textContent = "Offline";
    pSub.textContent = "Device not connected";
    if (ring) ring.style.filter = "grayscale(0.8)";
  }

  // Session running state
  if (active && startTs) {
    state.sessionRunning = true;
    state.sessionStartTime = typeof startTs === "number" ? startTs : Date.parse(startTs);
    document.getElementById("livePill").style.opacity = "1";
    document.getElementById("sessionStateBadge").textContent = "🟢 Active";
    document.getElementById("sessionStartBadge").textContent =
      "Started " + new Date(state.sessionStartTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } else {
    state.sessionRunning = false;
    document.getElementById("livePill").style.opacity = "0";
    document.getElementById("sessionStateBadge").textContent = "⬜ Idle";
    document.getElementById("sessionStartBadge").textContent = "No active session";
  }
}

/* ════════════════════════════════════════
   STATS RENDERING
════════════════════════════════════════ */
function renderAllStats(sessions) {
  if (!sessions) sessions = [];

  // Today's sessions
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const todaySessions = sessions.filter(s => s.date === today);
  const todayMins = todaySessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const todayInterrupts = todaySessions.reduce((sum, s) => sum + (s.interruptions || 0), 0);
  const todayFocusPct = todaySessions.length
    ? Math.round(todaySessions.reduce((sum, s) => sum + s.focusPct, 0) / todaySessions.length)
    : 0;

  // Week stats
  const weekAgo = Date.now() - 7 * 864e5;
  const weekSessions = sessions.filter(s => {
    try { return new Date(s.date).getTime() > weekAgo; } catch { return false; }
  });
  const weekMins  = weekSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const avgFocus  = sessions.length
    ? Math.round(sessions.reduce((sum, s) => sum + s.focusPct, 0) / sessions.length)
    : 0;
  const best      = sessions.reduce((best, s) => s.duration > (best?.duration || 0) ? s : best, null);
  const streak    = calcStreak(sessions);

  animateVal("todayFocus",   formatDuration(todayMins));
  animateVal("focusPct",     `${todayFocusPct}%`);
  animateVal("interruptions",`${todayInterrupts}`);
  animateVal("streakDays",   `${streak}🔥`);

  animateVal("weekTotal",    formatDuration(weekMins));
  animateVal("avgFocus",     `${avgFocus}%`);
  animateVal("bestSession",  best ? formatDuration(best.duration) : "—");
  animateVal("totalSessions",`${sessions.length}`);

  const el = document.getElementById("weekChange");
  if (el) {
    el.textContent = `${weekSessions.length} sessions this week`;
    el.className = "stat-card-change" + (weekSessions.length >= 3 ? " positive" : "");
  }

  const el2 = document.getElementById("focusChange");
  if (el2) { el2.textContent = `↑ improving`; el2.className = "stat-card-change positive"; }

  const el3 = document.getElementById("bestSessionMeta");
  if (el3 && best) el3.textContent = `${best.focusPct}% focus · ${best.date}`;

  const el4 = document.getElementById("sessionsChange");
  if (el4) { el4.textContent = `${weekSessions.length} this week`; el4.className = "stat-card-change positive"; }

  // Session count label
  const sc = document.getElementById("sessionCountLabel");
  if (sc) sc.textContent = `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;

  // Update sparklines
  const weekData = last7DaysData(sessions);
  const focusTrend = sessions.slice(0, 10).map(s => s.focusPct).reverse();
  const durationTrend = sessions.slice(0, 7).map(s => s.duration).reverse();
  const intrTrend = sessions.slice(0, 7).map(s => s.interruptions).reverse();

  drawSparkline("sparkline1", weekData.focusMins, "rgba(124, 58, 237, 1)");
  drawSparkline("sparkline2", focusTrend,         "rgba(6, 182, 212, 1)");
  drawSparkline("sparkline3", durationTrend,       "rgba(245, 158, 11, 1)");
  drawSparkline("sparkline4", intrTrend,           "rgba(244, 63, 94, 1)");
}

function animateVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = val;
  el.style.opacity = "0";
  el.style.transform = "translateY(8px)";
  requestAnimationFrame(() => {
    el.style.transition = "all 0.4s cubic-bezier(0.4,0,0.2,1)";
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
}

function calcStreak(sessions) {
  if (!sessions.length) return 0;
  const dates = [...new Set(sessions.map(s => s.date))].sort().reverse();
  let streak = 0;
  let check = new Date();
  check.setHours(0, 0, 0, 0);
  for (const d of dates) {
    const sd = new Date(d);
    sd.setHours(0, 0, 0, 0);
    if (Math.abs(check - sd) <= 86400000) {
      streak++;
      check = new Date(sd.getTime() - 86400000);
    } else break;
  }
  return streak;
}

function last7DaysData(sessions) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const dayMins = sessions
      .filter(s => s.date === label)
      .reduce((sum, s) => sum + (s.duration || 0), 0);
    days.push({ label: d.toLocaleDateString("en-US", { weekday: "short" }), focusMins: dayMins });
  }
  return {
    labels:    days.map(d => d.label),
    focusMins: days.map(d => d.focusMins),
    target:    days.map(() => 120),
  };
}

/* ════════════════════════════════════════
   CHART UPDATES (from live data)
════════════════════════════════════════ */
function updateCharts(sessions) {
  const weekData   = last7DaysData(sessions);
  const focusTrend = sessions.slice(0, 10).map(s => s.focusPct).reverse();
  const intrData   = sessions.slice(0, 10).map(s => s.interruptions).reverse();
  const labels10   = sessions.slice(0, 10).map((_, i) => `S${i+1}`).reverse();

  if (window.focusBarChart) {
    focusBarChart.data.labels = weekData.labels;
    focusBarChart.data.datasets[0].data = weekData.focusMins;
    focusBarChart.data.datasets[1].data = weekData.target;
    focusBarChart.update("active");
  }
  if (window.focusLineChart) {
    focusLineChart.data.labels = labels10;
    focusLineChart.data.datasets[0].data = focusTrend;
    focusLineChart.update("active");
  }
  if (window.interruptChart) {
    interruptChart.data.labels = labels10;
    interruptChart.data.datasets[0].data = intrData;
    interruptChart.data.datasets[0].backgroundColor = intrData.map(v =>
      v <= 2 ? "rgba(16,185,129,1)" : v <= 4 ? "rgba(245,158,11,1)" : "rgba(244,63,94,1)"
    );
    interruptChart.update("active");
  }

  // Update data source pill
  const pill = document.getElementById("dataSourcePill");
  const txt  = document.getElementById("dataSourceText");
  if (pill && txt) {
    txt.textContent = state.isDemo ? "📊 Demo Data" : `🔴 Live · ${sessions.length} sessions`;
    pill.style.background = state.isDemo ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)";
    pill.style.borderColor = state.isDemo ? "rgba(245,158,11,0.3)" : "rgba(16,185,129,0.3)";
    pill.style.color = state.isDemo ? "var(--amber)" : "var(--green)";
  }
}

/* ════════════════════════════════════════
   SESSION TABLE
════════════════════════════════════════ */
function renderSessionTable(sessions) {
  const tbody = document.getElementById("sessionTableBody");
  if (!tbody || !sessions.length) return;
  tbody.innerHTML = sessions.slice(0, 20).map(s => `
    <tr>
      <td>
        <div class="session-title-cell" onclick="editSessionTitle('${s.key}')">
          <span class="session-title-text" id="title-text-${s.key}">${s.title || 'Focus Session'}</span>
          <span class="edit-icon">✏️</span>
        </div>
      </td>
      <td>
        <div style="font-weight: 500; color: var(--text-primary)">${s.date}</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px">${s.start}</div>
      </td>
      <td><span style="font-family:var(--font-mono);font-size:12px">${s.durationStr}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:50px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08)">
            <div style="width:${s.focusPct}%;height:100%;border-radius:2px;background:${s.focusPct>=80?"var(--green)":s.focusPct>=65?"var(--cyan)":"var(--amber)"}"></div>
          </div>
          <span>${s.focusPct}%</span>
        </div>
      </td>
      <td>${s.interruptions}</td>
      <td><span class="quality-badge ${s.quality}">${s.quality.charAt(0).toUpperCase()+s.quality.slice(1)}</span></td>
    </tr>
  `).join("");
}

async function editSessionTitle(key) {
  const span = document.getElementById(`title-text-${key}`);
  if (!span) return;
  const currentTitle = span.textContent;
  
  const newTitle = prompt("What did you study during this session?", currentTitle);
  if (newTitle === null) return;
  
  const formattedTitle = newTitle.trim() || "Focus Session";
  span.textContent = formattedTitle;
  
  let ok = false;
  if (typeof updateSessionTitleInDB === "function") {
    ok = await updateSessionTitleInDB(key, formattedTitle);
  }
  
  if (ok) {
    showToast("Topic updated successfully!", "success");
    const session = state.sessions.find(s => s.key === key);
    if (session) session.title = formattedTitle;
  } else {
    showToast("Session saved locally", "info");
    const session = state.sessions.find(s => s.key === key);
    if (session) session.title = formattedTitle;
  }
}

/* ════════════════════════════════════════
   SESSION TIMER (1-second tick)
════════════════════════════════════════ */
function startSessionTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    const el = document.getElementById("sessionTimer");
    if (!el) return;
    if (!state.sessionRunning || !state.sessionStartTime) {
      el.textContent = "00:00:00";
      return;
    }
    const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
    el.textContent = `${pad(Math.floor(elapsed/3600))}:${pad(Math.floor((elapsed%3600)/60))}:${pad(elapsed%60)}`;
  }, 1000);
}

function pad(n) { return String(n).padStart(2, "0"); }

/* ════════════════════════════════════════
   AI INSIGHTS
════════════════════════════════════════ */
async function autoGenerateInsight(sessions) {
  const key = APP_CONFIG.geminiApiKey;
  if (!key) {
    renderInsight(
      "Add your Blu AI API key in config.js to unlock personalized study insights!",
      ["Setup"],
      "Blu AI · API key required"
    );
    return;
  }
  try {
    const text = await generateStudyInsight(sessions);
    renderInsight(text, extractTags(text), `Just now · ${sessions.length} sessions analysed`);
    await saveInsightToFirestore(text, sessions);
    state.insightText = text;
  } catch (e) {
    renderInsight(
      "Could not generate insight right now. Please try again shortly.",
      ["Error"],
      "Blu AI · Generation failed"
    );
  }
}

async function refreshInsight() {
  const icon    = document.getElementById("refreshIcon");
  const content = document.getElementById("insightContent");
  if (!icon || !content) return;

  const sessions = state.sessions;
  if (!sessions || !sessions.length) {
    showToast("Record a focus session first!", "info");
    return;
  }

  const key = APP_CONFIG.geminiApiKey;
  if (!key) {
    showToast("API Key missing in config.js", "error");
    return;
  }

  icon.classList.add("spin");
  content.style.opacity = "0.5";

  try {
    const text = await generateStudyInsight(sessions);
    renderInsight(text, extractTags(text), `Just now · ${sessions.length} sessions`);
    await saveInsightToFirestore(text, sessions);
    const insights = await loadInsightsFromFirestore();
    renderInsightsTimeline(insights);
    showToast("✨ New insight generated!", "success");
  } catch (e) {
    showToast("Error generating insight", "error");
  } finally {
    icon.classList.remove("spin");
    content.style.opacity = "1";
  }
}

function renderInsight(text, tags = [], meta = "") {
  const textEl = document.getElementById("insightText");
  const tagsEl = document.getElementById("insightTags");
  const timeEl = document.getElementById("insightTime");
  if (textEl) textEl.textContent = text;
  if (tagsEl) tagsEl.innerHTML = tags.map(t => `<span class="tag violet">${t}</span>`).join("");
  if (timeEl) timeEl.textContent = meta;
  state.insightText = text;
}

async function generateInsight() { await refreshInsight(); }

function renderInsightsTimeline(insights) {
  const container = document.getElementById("insightsTimeline");
  if (!container || !insights.length) return;
  container.innerHTML = insights.map((ins, i) => `
    <div class="glass-card insight-card-item" style="animation-delay:${i * 0.08}s">
      <div class="insight-card-date">${ins.date}</div>
      <div class="insight-card-text">${ins.text}</div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${(ins.tags || []).map(t => `<span class="tag violet">${t}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

/* ════════════════════════════════════════
   DEVICE COMMANDS
════════════════════════════════════════ */
async function sendCommand(type) {
  const labels = {
    break_reminder: "☕ Break Reminder",
    focus_nudge:    "⚡ Focus Nudge",
    start_session:  "▶ Start Session",
    end_session:    "⏹ End Session",
  };
  const btnMap = {
    break_reminder: "btnBreak",
    focus_nudge:    "btnFocus",
    start_session:  "btnStart",
    end_session:    "btnEnd",
  };

  // ── GUARD: Device must be online to accept commands ──────────────────
  const deviceOnline = state.deviceStatus?.online === true;
  if (!deviceOnline) {
    showToast("⚠️ Device is offline. Turn on your ESP32 first!", "error");
    return;
  }

  // Button press animation
  const btn = document.getElementById(btnMap[type]);
  if (btn) {
    btn.style.transform = "scale(0.95)";
    btn.style.transition = "transform 0.15s ease";
    setTimeout(() => { btn.style.transform = ""; }, 200);
  }

  // Write command to Firebase — ESP32 will pick it up and respond
  // DO NOT update local UI state here. The RTDB listener (onDeviceStatusUpdate)
  // will automatically update the dashboard when the ESP32 actually responds.
  const sent = await writeCommandToRTDB(type);


  // Log entry
  const log = document.getElementById("commandLog");
  if (log) {
    const now = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    // Remove placeholder
    const placeholder = log.querySelector(".cmd-log-placeholder");
    if (placeholder) placeholder.remove();
    const item = document.createElement("div");
    item.className = "cmd-log-item";
    item.style.cssText = "opacity:0;transform:translateX(-10px);transition:all 0.3s ease";
    item.innerHTML = `
      <span class="cmd-time">${now}</span>
      <span class="cmd-text">${labels[type]}</span>
      <span class="cmd-badge ${sent ? 'green' : 'violet'}">${sent ? "Sent" : "Demo"}</span>
    `;
    log.insertBefore(item, log.firstChild);
    requestAnimationFrame(() => { item.style.opacity = "1"; item.style.transform = ""; });
    // Keep log to 5 items
    while (log.children.length > 5) log.removeChild(log.lastChild);
  }

  showToast(`${labels[type]} ${sent ? "sent to device ✓" : "logged (demo)"}`, sent ? "success" : "info");
}

/* ════════════════════════════════════════
   RECOMMENDATIONS
════════════════════════════════════════ */
function populateRecommendations() {
  const sessions = state.sessions;
  const container = document.getElementById("recommendationsList");
  if (!container) return;

  if (!sessions || !sessions.length) {
    container.innerHTML = `
      <div class="rec-item">
        <div class="rec-icon">⚡</div>
        <div class="rec-text">Complete your first study session to get custom focus recommendations!</div>
      </div>
    `;
    return;
  }

  const avgFocus = sessions.reduce((s, x) => s + x.focusPct, 0) / sessions.length;
  const avgIntr  = sessions.reduce((s, x) => s + x.interruptions, 0) / sessions.length;
  const avgDur   = sessions.reduce((s, x) => s + x.duration, 0) / sessions.length;

  const recs = [
    avgFocus < 75
      ? { icon: "🎯", text: `<strong>Boost your focus score</strong> — your current average is ${Math.round(avgFocus)}%. Try the Pomodoro method: 25 min focus, 5 min break.` }
      : { icon: "⏰", text: `<strong>Peak focus window detected</strong> — your ${Math.round(avgFocus)}% average is strong. Push sessions to 90 min for deeper work.` },
    avgIntr > 4
      ? { icon: "🔕", text: `<strong>Reduce interruptions</strong> — you're averaging ${avgIntr.toFixed(1)} per session. Try phone-free mode and close unnecessary tabs.` }
      : { icon: "✅", text: `<strong>Low interruptions — great discipline!</strong> Averaging ${avgIntr.toFixed(1)} interruptions. Consider longer unbroken blocks.` },
    avgDur < 60
      ? { icon: "⏱️", text: `<strong>Extend your sessions</strong> — you average ${Math.round(avgDur)} min. Aim for at least 60–90 min to enter a deep flow state.` }
      : { icon: "🏆", text: `<strong>Excellent session length</strong> — ${Math.round(avgDur)} min average is solid. Your best sessions show the highest focus scores.` },
    { icon: "🌙", text: `<strong>Track your peak hours</strong> — open the Chat tab and ask "When am I most focused?" to get a personalised time recommendation.` },
  ];

  container.innerHTML = recs.map(r => `
    <div class="rec-item">
      <div class="rec-icon">${r.icon}</div>
      <div class="rec-text">${r.text}</div>
    </div>
  `).join("");
}

function updateCoachStats(sessions) {
  const el1 = document.getElementById("mTotalSessions");
  const el2 = document.getElementById("mInsightCount");
  const el3 = document.getElementById("mStreak");
  if (el1) el1.textContent = sessions.length;
  if (el2) el2.textContent = document.querySelectorAll(".insight-card-item").length;
  if (el3) el3.textContent = calcStreak(sessions) + "🔥";
}

/* ════════════════════════════════════════
   CHAT
════════════════════════════════════════ */
function updateChatContext(sessions) {
  const el = document.getElementById("contextList");
  if (!el) return;
  el.innerHTML = `
    <div class="ctx-item"><span class="ctx-icon">📊</span><span>${sessions.length} sessions loaded</span></div>
    <div class="ctx-item"><span class="ctx-icon">📈</span><span>Focus trends</span></div>
    <div class="ctx-item"><span class="ctx-icon">⏱️</span><span>Session durations</span></div>
    <div class="ctx-item"><span class="ctx-icon">🔥</span><span>${calcStreak(sessions)}-day streak</span></div>
    <div class="ctx-item"><span class="ctx-icon">🏆</span><span>Quality scores</span></div>
  `;
  const sc = document.getElementById("ssSessionCount");
  const ds = document.getElementById("ssDataSource");
  const lu = document.getElementById("ssLastUpdated");
  if (sc) sc.textContent = sessions.length;
  if (ds) ds.textContent = state.isDemo ? "Demo" : "Firebase";
  if (lu) lu.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  autoResizeTextarea(input);
  hideSuggestions();
  appendUserMessage(msg);
  showTypingIndicator();
  document.getElementById("sendBtn").disabled = true;

  try {
    const sessions = state.sessions;
    const reply = await sendChatToGemini(msg, sessions);
    hideTypingIndicator();
    appendAIMessage(reply);
  } catch (err) {
    hideTypingIndicator();
    appendAIMessage(err.message === "NO_API_KEY"
      ? "I need a Gemini API key to reply. Add it via the Settings (⚙️) button. In Demo Mode I can still show you sample answers!"
      : "Something went wrong: " + err.message
    );
  } finally {
    document.getElementById("sendBtn").disabled = false;
  }
}

function appendUserMessage(text) {
  const c = document.getElementById("chatMessages");
  const now = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const div = document.createElement("div");
  div.className = "chat-msg user";
  div.style.cssText = "opacity:0;transform:translateX(20px)";
  div.innerHTML = `
    <div class="msg-avatar">👤</div>
    <div class="msg-bubble">
      <p>${escapeHtml(text)}</p>
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px;text-align:right">${now}</div>
    </div>`;
  c.appendChild(div);
  requestAnimationFrame(() => {
    div.style.transition = "all 0.35s cubic-bezier(0.4,0,0.2,1)";
    div.style.opacity = "1"; div.style.transform = "none";
  });
  scrollChatToBottom();
}

function appendAIMessage(text) {
  const c = document.getElementById("chatMessages");
  const now = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const div = document.createElement("div");
  div.className = "chat-msg ai";
  div.style.cssText = "opacity:0;transform:translateX(-20px)";
  const formatted = text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, `<code style="font-family:var(--font-mono);background:rgba(124,58,237,0.15);padding:1px 5px;border-radius:4px">$1</code>`)
    .split("\n\n").map(p => `<p>${p.replace(/\n/g,"<br>")}</p>`).join("");
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      ${formatted}
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px">${now} · Blu AI</div>
    </div>`;
  c.appendChild(div);
  requestAnimationFrame(() => {
    div.style.transition = "all 0.35s cubic-bezier(0.4,0,0.2,1)";
    div.style.opacity = "1"; div.style.transform = "none";
  });
  scrollChatToBottom();
}

let typingEl = null;
function showTypingIndicator() {
  const c = document.getElementById("chatMessages");
  typingEl = document.createElement("div");
  typingEl.className = "chat-msg ai"; typingEl.id = "typingIndicator";
  typingEl.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  c.appendChild(typingEl);
  scrollChatToBottom();
}
function hideTypingIndicator() { if (typingEl) { typingEl.remove(); typingEl = null; } }
function scrollChatToBottom() { const c = document.getElementById("chatMessages"); if (c) setTimeout(() => c.scrollTop = c.scrollHeight, 50); }
function hideSuggestions() {
  const s = document.getElementById("chatSuggestions");
  if (s) { s.style.transition = "all 0.3s ease"; s.style.opacity = "0"; s.style.maxHeight = "0"; s.style.overflow = "hidden"; }
}
function sendSuggestion(btn) { document.getElementById("chatInput").value = btn.textContent; sendChatMessage(); }
function injectPrompt(text) {
  document.getElementById("chatInput").value = text;
  document.getElementById("chatInput").focus();
  autoResizeTextarea(document.getElementById("chatInput"));
  switchTab("chat", document.querySelector('[data-tab="chat"]'));
}
function handleChatKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }
function autoResizeTextarea(el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }
function clearChat() {
  resetChat();
  document.getElementById("chatMessages").innerHTML = `<div class="chat-msg ai"><div class="msg-avatar">🤖</div><div class="msg-bubble"><p>Chat cleared! Ready for your next question.</p></div></div>`;
  const s = document.getElementById("chatSuggestions");
  if (s) { s.style.opacity = "1"; s.style.maxHeight = ""; s.style.overflow = ""; }
  showToast("Chat cleared", "info");
}

function exportChat() {
  const msgs = document.querySelectorAll(".chat-msg");
  let text = "Study AI Companion — Chat Export\n" + new Date().toLocaleString() + "\n\n";
  msgs.forEach(m => {
    const who = m.classList.contains("user") ? "You" : "Mentor";
    const bubble = m.querySelector(".msg-bubble");
    if (bubble) text += `[${who}]\n${bubble.innerText.trim()}\n\n`;
  });
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `study-chat-${Date.now()}.txt`;
  a.click();
  showToast("Chat exported!", "success");
}

/* ════════════════════════════════════════
   ANALYTICS RANGE
════════════════════════════════════════ */
function setRange(range, btn) {
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const sessions = state.sessions;
  let filtered = sessions;
  if (range === "7d")  filtered = filterByDays(sessions, 7);
  if (range === "30d") filtered = filterByDays(sessions, 30);

  updateCharts(filtered);
  renderSessionTable(filtered);
  showToast(`Showing ${range === "7d" ? "7 days" : range === "30d" ? "30 days" : "all time"}`, "info");
}

function filterByDays(sessions, days) {
  const cutoff = Date.now() - days * 864e5;
  return sessions.filter(s => { try { return new Date(s.date).getTime() > cutoff; } catch { return true; } });
}

/* ════════════════════════════════════════
   TAB SWITCHING
════════════════════════════════════════ */
function switchTab(tabName, btn) {
  // Sync active states on all tab elements (desktop and mobile bottom nav)
  document.querySelectorAll(".nav-tab, .mobile-nav-tab").forEach(t => {
    if (t.getAttribute("data-tab") === tabName) {
      t.classList.add("active");
    } else {
      t.classList.remove("active");
    }
  });

  const old = document.getElementById(`tab-${state.tab}`);
  if (old) {
    old.style.opacity = "0"; old.style.transform = "translateY(-8px)";
    old.style.transition = "all 0.18s ease";
    setTimeout(() => {
      old.classList.remove("active"); old.style.opacity = ""; old.style.transform = "";
      const next = document.getElementById(`tab-${tabName}`);
      if (next) { next.classList.add("active"); state.tab = tabName; }
      // Refresh recommendations when coach tab opened
      if (tabName === "coach") populateRecommendations();
    }, 180);
  }
}

/* Settings delegated to auth.js (openSettings, closeSettings, closeSettingsOnOverlay defined there) */

/* Config now lives in config.js (APP_CONFIG) — loaded once by admin */

/* ════════════════════════════════════════
   MISC HELPERS
════════════════════════════════════════ */
function animateStatCards() {
  document.querySelectorAll(".stat-card").forEach((card, i) => {
    card.style.opacity = "0"; card.style.transform = "translateY(20px)";
    setTimeout(() => {
      card.style.transition = "all 0.4s cubic-bezier(0.4,0,0.2,1)";
      card.style.opacity = "1"; card.style.transform = "translateY(0)";
    }, 100 + i * 70);
  });
}

function startAutoRefresh() {
  // Update sync time every 30s
  setInterval(markSync, 30000);
  // Auto-refresh recommendations every 5 min
  setInterval(populateRecommendations, 300000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(text) {
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

let toastTimeout;
function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.className = "toast", 3500);
}

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeSettings();
    const overlay = document.getElementById("setupOverlay");
    if (overlay && overlay.style.display !== "none") skipToDemo();
  }
  if ((e.metaKey || e.ctrlKey) && ["1","2","3","4"].includes(e.key)) {
    const tabs = ["dashboard","history","coach","chat"];
    const t = tabs[parseInt(e.key)-1];
    const btn = document.querySelector(`[data-tab="${t}"]`);
    if (btn) switchTab(t, btn);
    e.preventDefault();
  }
});

// Connection quality indicator (pulse ring every 3s during session)
setInterval(() => {
  if (state.sessionRunning) {
    const r = document.querySelector(".ring-outer");
    if (r) {
      r.style.boxShadow = "0 0 24px rgba(124,58,237,0.8)";
      setTimeout(() => r.style.boxShadow = "", 600);
    }
  }
}, 3000);

/* ═══════════════════════════════════════════
   MOBILE BOTTOM NAV — syncs with desktop tabs
═══════════════════════════════════════════ */
function switchMobileTab(tabName, clickedBtn) {
  // Switch the main tab content
  switchTab(tabName, null);

  // Update mobile nav active state
  document.querySelectorAll(".mobile-nav-btn").forEach(b => b.classList.remove("active"));
  if (clickedBtn) clickedBtn.classList.add("active");

  // Also sync desktop nav
  document.querySelectorAll(".nav-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });

  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Keep mobile nav in sync when desktop tabs are clicked
const _origSwitchTab = typeof switchTab === "function" ? switchTab : null;
