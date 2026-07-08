/* ═══════════════════════════════════════════════════
   FIREBASE BRIDGE — Real-time data layer
   Works with Firebase RTDB + Firestore
   Falls back to demo data if not configured
   ═══════════════════════════════════════════════════ */

let firebaseApp = null;
let rtdb = null;
let firestore = null;
let deviceId = "esp32-desk-01";
let isFirebaseConnected = false;
let isGeminiConnected = false;

/* ── Active listeners (for cleanup) ── */
const _listeners = [];

/* ══════════════════════════════════════
   INITIALISE FIREBASE
══════════════════════════════════════ */
function initFirebase(config) {
  try {
    // ✅ Reuse the app already created by auth.js (named "study-ai-main")
    // Creating a second app with a different name causes rtdb to be a separate
    // disconnected instance — commands never reach Firebase and show as "demo".
    try {
      firebaseApp = firebase.app("study-ai-main");
    } catch (e) {
      // App not yet created — init it ourselves as a fallback
      firebaseApp = firebase.initializeApp(config, "study-ai-main");
    }

    rtdb      = firebase.database(firebaseApp);
    firestore = firebase.firestore(firebaseApp);
    deviceId  = localStorage.getItem("device_id") || "esp32-desk-01";
    isFirebaseConnected = true;
    console.log("[Bridge] ✅ Firebase connected. RTDB ready.");
    return true;
  } catch (err) {
    console.error("[Bridge] Firebase init failed:", err);
    isFirebaseConnected = false;
    return false;
  }
}

/* ══════════════════════════════════════
   REAL-TIME DEVICE STATUS (RTDB)
   Path: /devices/{id}/status
══════════════════════════════════════ */
function listenDeviceStatus(onUpdate) {
  if (!rtdb) {
    // No Firebase — show device as offline
    onUpdate({ online: false, presence: false, sessionActive: false });
    return;
  }

  const ref = rtdb.ref(`/devices/${deviceId}/status`);
  const handler = ref.on("value", snap => {
    const data = snap.val();
    if (data) onUpdate(data);
    else onUpdate({ online: false, presence: false, sessionActive: false });
  }, err => {
    console.warn("RTDB status error:", err);
    onUpdate({ online: false, presence: false, sessionActive: false });
  });
  _listeners.push({ type: "rtdb", ref, handler });
}

/* ══════════════════════════════════════
   REAL-TIME SESSIONS (RTDB)
   Path: /devices/{id}/sessions
══════════════════════════════════════ */
function listenDeviceSessions(onUpdate) {
  if (!rtdb) {
    onUpdate([]);  // No Firebase — empty for new user
    return;
  }

  const ref = rtdb.ref(`/devices/${deviceId}/sessions`).orderByKey().limitToLast(50);
  const handler = ref.on("value", snap => {
    const raw = snap.val() || {};
    const sessions = Object.entries(raw)
      .map(([key, s]) => normaliseSession(key, s))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    onUpdate(sessions);  // Always return real data (may be empty [])
  }, err => {
    console.warn("RTDB sessions error:", err);
    onUpdate([]);
  });
  _listeners.push({ type: "rtdb", ref, handler });
}

/* ══════════════════════════════════════
   WRITE COMMAND → RTDB
   Path: /devices/{id}/commands/latest
══════════════════════════════════════ */
async function writeCommandToRTDB(type) {
  if (!rtdb) return false;
  try {
    await rtdb.ref(`/devices/${deviceId}/commands/latest`).set({
      type,
      timestamp: Date.now(),
      consumed: false,   // ✅ matches what ESP32 firmware reads (was "handled")
      source: "webapp",
    });
    return true;
  } catch (err) {
    console.error("Command write failed:", err);
    return false;
  }
}

/* ══════════════════════════════════════
   WRITE SESSION → RTDB
   Called from manual start/end
══════════════════════════════════════ */
async function writeSessionToRTDB(sessionData) {
  if (!rtdb) return null;
  try {
    const ref = rtdb.ref(`/devices/${deviceId}/sessions`).push();
    await ref.set({ ...sessionData, source: "webapp", timestamp: Date.now() });
    return ref.key;
  } catch (err) {
    console.error("Session write failed:", err);
    return null;
  }
}

/* ══════════════════════════════════════
   SAVE AI INSIGHT → FIRESTORE
   Path: /users/{deviceId}/insights
══════════════════════════════════════ */
async function saveInsightToFirestore(insightText, sessions) {
  if (!firestore) return;
  try {
    await firestore
      .collection("users").doc(deviceId)
      .collection("insights").add({
        text: insightText,
        model: "gemini-2.5-flash",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sessionCount: sessions.length,
      });
  } catch (err) {
    console.warn("Firestore insight save failed:", err);
  }
}

/* ══════════════════════════════════════
   LOAD PAST INSIGHTS → FIRESTORE
══════════════════════════════════════ */
async function loadInsightsFromFirestore() {
  if (!firestore) return [];  // No Firebase — empty
  try {
    const snap = await firestore
      .collection("users").doc(deviceId)
      .collection("insights")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    if (snap.empty) return [];  // New user — no insights yet

    return snap.docs.map(d => {
      const data = d.data();
      const ts = data.createdAt?.toDate();
      return {
        date: ts ? formatRelativeTime(ts) : "Recently",
        text: data.text,
        tags: extractTags(data.text),
      };
    });
  } catch (err) {
    console.warn("Firestore insights load failed:", err);
    return [];
  }
}

/* ══════════════════════════════════════
   CHECK FIREBASE CONNECTIVITY
══════════════════════════════════════ */
function checkFirebaseConnectivity(onResult) {
  if (!rtdb) { onResult(false); return; }
  rtdb.ref(".info/connected").once("value", snap => {
    onResult(snap.val() === true);
  });
}

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function normaliseSession(key, raw) {
  const start = raw.startTime || raw.start || raw.timestamp || Date.now();
  const dur = raw.duration || raw.durationMs / 60000 || 60;
  const pct = raw.focusPct ?? raw.focusPercent ?? raw.presence_pct ?? 75;
  const interrupts = raw.interruptions ?? raw.interrupt_count ?? 0;
  const quality =
    pct >= 85 ? "excellent" :
    pct >= 70 ? "good" :
    pct >= 55 ? "fair" : "poor";

  const d = new Date(typeof start === "number" ? start : Date.parse(start));
  return {
    key,
    title: raw.title || "Focus Session",
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    start: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    duration: Math.round(dur),
    durationStr: formatDuration(Math.round(dur)),
    focusPct: Math.round(pct),
    interruptions: interrupts,
    quality,
  };
}

function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function extractTags(text) {
  const tags = [];
  if (/focus|concentrat/i.test(text)) tags.push("Focus");
  if (/break|rest|pause/i.test(text)) tags.push("Breaks");
  if (/streak|consistent|daily/i.test(text)) tags.push("Streak");
  if (/morn|afternoon|evening|time/i.test(text)) tags.push("Timing");
  if (/improv|better|progress/i.test(text)) tags.push("Progress");
  if (/interrupt|distract/i.test(text)) tags.push("Focus");
  return tags.slice(0, 3).length > 0 ? tags.slice(0, 3) : ["Insight"];
}

function cleanupListeners() {
  _listeners.forEach(l => {
    if (l.type === "rtdb") l.ref.off();
    if (l.type === "interval") clearInterval(l.ref);
  });
  _listeners.length = 0;
}

/* ══════════════════════════════════════
   UPDATE SESSION TITLE
══════════════════════════════════════ */
async function updateSessionTitleInDB(sessionKey, newTitle) {
  if (!rtdb) return false;  // No Firebase — cannot update
  try {
    await rtdb.ref(`/devices/${deviceId}/sessions/${sessionKey}`).update({
      title: newTitle
    });
    return true;
  } catch (err) {
    console.error("Failed to update session title in DB:", err);
    return false;
  }
}

/* ══════════════════════════════════════
   SYNC DEVICE SETTINGS
══════════════════════════════════════ */
async function writeDeviceSettingsToDB(settings) {
  if (!rtdb) {
    localStorage.setItem(`device_settings_${deviceId}`, JSON.stringify(settings));
    return true;
  }
  try {
    await rtdb.ref(`/devices/${deviceId}/settings`).set(settings);
    return true;
  } catch (err) {
    console.error("Failed to write device settings to DB:", err);
    return false;
  }
}

async function getDeviceSettingsFromDB() {
  if (!rtdb) {
    const saved = localStorage.getItem(`device_settings_${deviceId}`);
    return saved ? JSON.parse(saved) : { targetDurationMins: 120, distanceThresholdCm: 80 };
  }
  try {
    const snap = await rtdb.ref(`/devices/${deviceId}/settings`).get();
    return snap.exists() ? snap.val() : { targetDurationMins: 120, distanceThresholdCm: 80 };
  } catch (err) {
    console.error("Failed to get device settings from DB:", err);
    return { targetDurationMins: 120, distanceThresholdCm: 80 };
  }
}

