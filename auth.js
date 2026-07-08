/* ═══════════════════════════════════════════════════
   AUTH.JS — Username / Password Authentication
   Works in two modes:
   • Demo Mode  → localStorage (no Firebase needed)
   • Live Mode  → Firebase Auth (email/password)
     Users just see "username + password" — email
     is constructed as username@studyai.app internally
   ═══════════════════════════════════════════════════ */

let currentUser = null;  // { uid, username, name, isGuest, isDemo }
let authMode = "login";  // "login" | "signup"
let firebaseAuth = null;

/* ══════════════════════════════════════
   BOOT — Check existing session
══════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  tryAutoLogin();
});

function tryAutoLogin() {
  const cfg = APP_CONFIG;
  const hasFirebase = !!(cfg.firebase?.apiKey && cfg.firebase?.projectId && cfg.firebase?.databaseURL);

  if (hasFirebase) {
    bootWithFirebase(cfg);
  } else {
    showAuthScreen();
    showAuthError("Error: Firebase configurations are missing or incorrect.");
  }
}

/* ── Firebase Auth Boot ── */
function bootWithFirebase(cfg) {
  try {
    const app = firebase.initializeApp({
      apiKey:     cfg.firebase.apiKey,
      authDomain: cfg.firebase.authDomain || `${cfg.firebase.projectId}.firebaseapp.com`,
      projectId:  cfg.firebase.projectId,
      databaseURL: cfg.firebase.databaseURL,
    }, "study-ai-main");
    firebaseAuth = firebase.auth(app);

    // Listen for auth state
    firebaseAuth.onAuthStateChanged(user => {
      if (user) {
        const username = user.displayName || user.email.split("@")[0];
        onLoginSuccess({ uid: user.uid, username, name: user.displayName || username, isGuest: false, isDemo: false, firebaseUser: user });
      } else {
        showAuthScreen();
      }
    });

    // Init firebase bridge with this app
    initFirebase({
      apiKey:      cfg.firebase.apiKey,
      authDomain:  cfg.firebase.authDomain || `${cfg.firebase.projectId}.firebaseapp.com`,
      projectId:   cfg.firebase.projectId,
      databaseURL: cfg.firebase.databaseURL,
    });

  } catch (err) {
    console.error("Firebase boot failed:", err);
    showAuthScreen();
    showAuthError("Failed to initialize Firebase Auth.");
  }
}

/* ── LocalStorage Auth Boot ── */
function bootWithLocalStorage() {
  const remember = localStorage.getItem("auth_remember") === "true";
  const saved = sessionStorage.getItem("auth_user") || (remember ? localStorage.getItem("auth_user") : null);
  if (saved) {
    try {
      const user = JSON.parse(saved);
      onLoginSuccess({ ...user, isDemo: true });
    } catch {
      showAuthScreen();
    }
  } else {
    showAuthScreen();
  }
}

/* ══════════════════════════════════════
   AUTH SCREEN SHOW/HIDE
══════════════════════════════════════ */
function showAuthScreen() {
  const screen = document.getElementById("authScreen");
  screen.style.display = "flex";
  screen.style.opacity = "1";
  // Focus username after mount
  setTimeout(() => document.getElementById("authUsername")?.focus(), 300);
}

function hideAuthScreen() {
  const screen = document.getElementById("authScreen");
  screen.style.transition = "all 0.5s cubic-bezier(0.4,0,0.2,1)";
  screen.style.opacity = "0";
  screen.style.transform = "scale(1.04)";
  setTimeout(() => screen.style.display = "none", 500);
}

/* ══════════════════════════════════════
   AUTH TAB TOGGLE
══════════════════════════════════════ */
function switchAuthTab(mode) {
  authMode = mode;
  const isSignup = mode === "signup";

  document.getElementById("tabLogin").classList.toggle("active", !isSignup);
  document.getElementById("tabSignup").classList.toggle("active", isSignup);

  const nameField    = document.getElementById("nameField");
  const rememberFld  = document.getElementById("rememberField");
  const btnText      = document.getElementById("authBtnText");

  // Animate field transition
  if (isSignup) {
    nameField.style.display = "flex";
    nameField.style.opacity = "0"; nameField.style.transform = "translateY(-8px)";
    setTimeout(() => {
      nameField.style.transition = "all 0.3s ease";
      nameField.style.opacity = "1"; nameField.style.transform = "translateY(0)";
    }, 10);
    rememberFld.style.display = "none";
    btnText.textContent = "Create Account";
  } else {
    nameField.style.display = "none";
    rememberFld.style.display = "flex";
    btnText.textContent = "Sign In";
  }
  clearAuthError();
}

/* ══════════════════════════════════════
   FORM SUBMIT
══════════════════════════════════════ */
async function handleAuth(e) {
  e.preventDefault();
  const username = document.getElementById("authUsername").value.trim().toLowerCase();
  const password = document.getElementById("authPassword").value;
  const name     = document.getElementById("authName")?.value.trim() || username;
  const remember = document.getElementById("rememberMe")?.checked ?? true;

  if (!username || !password) return showAuthError("Please fill in all fields");
  if (username.length < 3)    return showAuthError("Username must be at least 3 characters");
  if (password.length < 6)    return showAuthError("Password must be at least 6 characters");
  if (authMode === "signup" && !/^[a-z0-9_]+$/.test(username)) {
    return showAuthError("Username can only contain letters, numbers, and underscores");
  }

  setAuthLoading(true);

  try {
    if (firebaseAuth) {
      await handleFirebaseAuth(username, password, name, remember);
    } else {
      await handleLocalAuth(username, password, name, remember);
    }
  } catch (err) {
    setAuthLoading(false);
    showAuthError(friendlyAuthError(err));
  }
}

/* ── Firebase Auth ── */
async function handleFirebaseAuth(username, password, name, remember) {
  const email = `${username}@studyai.local`;
  try {
    let cred;
    if (authMode === "signup") {
      cred = await firebaseAuth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name || username });
    } else {
      cred = await firebaseAuth.signInWithEmailAndPassword(email, password);
    }
    // onAuthStateChanged fires → onLoginSuccess called automatically
  } catch (err) {
    throw err;
  }
}

/* ── LocalStorage Auth (Demo Mode) ── */
async function handleLocalAuth(username, password, name, remember) {
  await sleep(600); // Simulate network delay feel

  const usersKey = "studyai_users";
  const users    = JSON.parse(localStorage.getItem(usersKey) || "{}");
  const hash     = simpleHash(password);

  if (authMode === "signup") {
    if (users[username]) throw new Error("Username already taken");
    users[username] = { hash, name: name || username, uid: "uid_" + Date.now(), createdAt: Date.now() };
    localStorage.setItem(usersKey, JSON.stringify(users));
    showToast("✅ Account created!", "success");
  } else {
    const user = users[username];
    if (!user) throw new Error("No account found for that username");
    if (user.hash !== hash) throw new Error("Incorrect password");
  }

  const user = users[username];
  const userObj = { uid: user.uid, username, name: user.name, isGuest: false, isDemo: true };

  // Persist session
  const serialised = JSON.stringify(userObj);
  sessionStorage.setItem("auth_user", serialised);
  if (remember) {
    localStorage.setItem("auth_user", serialised);
    localStorage.setItem("auth_remember", "true");
  }

  setAuthLoading(false);
  onLoginSuccess(userObj);
}

/* ── Guest / Demo ── */
function continueAsGuest() {
  const guestUser = { uid: "guest_" + Date.now(), username: "guest", name: "Demo User", isGuest: true, isDemo: true };
  onLoginSuccess(guestUser);
}

/* ══════════════════════════════════════
   ON LOGIN SUCCESS
══════════════════════════════════════ */
function onLoginSuccess(user) {
  currentUser = user;
  setAuthLoading(false);
  hideAuthScreen();
  updateNavUser(user);

  // Sync user-specific device ID
  const savedDevId = localStorage.getItem(`device_id_${user.uid}`) || APP_CONFIG.defaultDeviceId;
  localStorage.setItem("device_id", savedDevId);
  if (typeof deviceId !== "undefined") window.deviceId = savedDevId;

  // ── Inject Gemini key into state so AI features work live ──
  if (typeof state !== "undefined" && APP_CONFIG.geminiApiKey) {
    state.geminiKey = APP_CONFIG.geminiApiKey;
  }

  launchDashboard();
}

/* ══════════════════════════════════════
   LOGOUT
══════════════════════════════════════ */
async function logout() {
  toggleUserMenu(); // close menu
  if (firebaseAuth) { try { await firebaseAuth.signOut(); } catch {} }
  sessionStorage.removeItem("auth_user");
  localStorage.removeItem("auth_user");
  localStorage.removeItem("auth_remember");
  currentUser = null;
  // Soft reload to auth screen
  ["statusBar","navbar","appMain","mobileBottomNav"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  showAuthScreen();
  // Reset auth form
  document.getElementById("authUsername").value = "";
  document.getElementById("authPassword").value = "";
  clearAuthError();
  showToast("Signed out successfully", "info");
}

/* ══════════════════════════════════════
   NAV USER AVATAR
══════════════════════════════════════ */
function updateNavUser(user) {
  const avatar = document.getElementById("navAvatar");
  const umName = document.getElementById("umName");
  const umRole = document.getElementById("umRole");
  if (avatar) {
    avatar.textContent = (user.name || user.username || "U").charAt(0).toUpperCase();
    // Color based on first char
    const colors = ["#7c3aed","#06b6d4","#10b981","#f59e0b","#f43f5e","#4f46e5","#ec4899"];
    const idx = avatar.textContent.charCodeAt(0) % colors.length;
    avatar.style.background = `linear-gradient(135deg, ${colors[idx]}, ${colors[(idx+2)%colors.length]})`;
  }
  if (umName) umName.textContent = user.name || user.username;
  if (umRole) umRole.textContent = user.isGuest ? "Demo Guest" : `@${user.username}`;
}

function toggleUserMenu() {
  const menu = document.getElementById("userMenu");
  if (!menu) return;
  const isOpen = menu.style.display !== "none";
  menu.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    menu.style.opacity = "0"; menu.style.transform = "translateY(-8px) scale(0.96)";
    setTimeout(() => {
      menu.style.transition = "all 0.2s cubic-bezier(0.34,1.56,0.64,1)";
      menu.style.opacity = "1"; menu.style.transform = "translateY(0) scale(1)";
    }, 10);
  }
  // Close on outside click
  if (!isOpen) {
    setTimeout(() => document.addEventListener("click", closeMenuOutside, { once: true }), 50);
  }
}

function closeMenuOutside(e) {
  const navUser = document.getElementById("navUser");
  if (navUser && !navUser.contains(e.target)) {
    const menu = document.getElementById("userMenu");
    if (menu) menu.style.display = "none";
  }
}

/* ══════════════════════════════════════
   PROFILE MODAL
══════════════════════════════════════ */
function openProfileModal() {
  const menu = document.getElementById("userMenu");
  if (menu) menu.style.display = "none";

  const u = currentUser;
  if (!u) return;

  document.getElementById("profileBigAvatar").textContent = (u.name || u.username || "U").charAt(0).toUpperCase();
  document.getElementById("profileName").textContent = u.name || u.username;
  document.getElementById("profileUsername").textContent = `@${u.username}`;
  document.getElementById("profileModeBadge").textContent = u.isDemo ? (u.isGuest ? "Demo Guest" : "Local Mode") : "Live Mode";

  const devId = document.getElementById("profileDeviceId");
  if (devId) devId.value = localStorage.getItem(`device_id_${u.uid}`) || APP_CONFIG.defaultDeviceId || "esp32-desk-01";

  // Load ESP32 Target Settings from DB
  const targetDur = document.getElementById("profileTargetDuration");
  const distThresh = document.getElementById("profileDistanceThreshold");
  if (typeof getDeviceSettingsFromDB === "function") {
    getDeviceSettingsFromDB().then(settings => {
      if (targetDur) targetDur.value = settings.targetDurationMins || 120;
      if (distThresh) distThresh.value = settings.distanceThresholdCm || 80;
    });
  }

  // Fill stats from current sessions
  const sessions = typeof state !== "undefined" ? (state.sessions || DEMO_SESSIONS) : DEMO_SESSIONS;
  const avgFocus = sessions.length ? Math.round(sessions.reduce((s,x)=>s+x.focusPct,0)/sessions.length) : 0;
  document.getElementById("psTotal").textContent = sessions.length;
  document.getElementById("psStreak").textContent = (typeof calcStreak === "function" ? calcStreak(sessions) : 7) + "🔥";
  document.getElementById("psFocus").textContent = avgFocus + "%";

  document.getElementById("profileModal").classList.add("open");
}

function closeProfileModal() { document.getElementById("profileModal").classList.remove("open"); }
function closeProfileOnOverlay(e) { if (e.target === document.getElementById("profileModal")) closeProfileModal(); }

async function saveProfile() {
  const devId = document.getElementById("profileDeviceId")?.value.trim();
  const targetMins = parseInt(document.getElementById("profileTargetDuration")?.value) || 120;
  const distCm = parseInt(document.getElementById("profileDistanceThreshold")?.value) || 80;

  let deviceChanged = false;
  if (devId && currentUser) {
    const oldDevId = localStorage.getItem(`device_id_${currentUser.uid}`);
    if (oldDevId !== devId) {
      deviceChanged = true;
      localStorage.setItem(`device_id_${currentUser.uid}`, devId);
      localStorage.setItem("device_id", devId);
      if (typeof window.deviceId !== "undefined") window.deviceId = devId;
      if (typeof deviceId !== "undefined") deviceId = devId;
    }
  }

  // Save device settings to Firebase/local
  let ok = false;
  if (typeof writeDeviceSettingsToDB === "function") {
    ok = await writeDeviceSettingsToDB({
      targetDurationMins: targetMins,
      distanceThresholdCm: distCm,
      updatedAt: Date.now()
    });
  }

  closeProfileModal();

  if (deviceChanged) {
    showToast("🔄 Reconnecting to new device ID...", "info");
    if (typeof cleanupListeners === "function") cleanupListeners();
    if (typeof listenDeviceStatus === "function" && typeof onDeviceStatusUpdate === "function") {
      listenDeviceStatus(onDeviceStatusUpdate);
    }
    if (typeof listenDeviceSessions === "function" && typeof onSessionsUpdate === "function") {
      listenDeviceSessions(onSessionsUpdate);
    }
  }

  if (ok) {
    showToast("✅ Settings synced with device!", "success");
  } else {
    showToast("✅ Profile saved!", "success");
  }
}

/* ══════════════════════════════════════
   SETTINGS MODAL (status only — no config exposed)
══════════════════════════════════════ */
function openSettings() {
  const menu = document.getElementById("userMenu");
  if (menu) menu.style.display = "none";
  buildConfigStatus();
  document.getElementById("settingsModal").classList.add("open");
}
function closeSettings() { document.getElementById("settingsModal").classList.remove("open"); }
function closeSettingsOnOverlay(e) { if (e.target === document.getElementById("settingsModal")) closeSettings(); }

function buildConfigStatus() {
  const cfg = APP_CONFIG;
  const fbOk  = !!(cfg.firebase?.apiKey && cfg.firebase?.projectId);
  const gOk   = !!cfg.geminiApiKey;
  const row   = document.getElementById("configStatusRow");
  if (!row) return;
  row.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">System Status</div>
    <div class="cfg-status-item ${fbOk ? "ok" : "warn"}">
      <span>${fbOk ? "✓" : "○"}</span>
      <span>Firebase: ${fbOk ? "Connected" : "Demo Mode (local data)"}</span>
    </div>
    <div class="cfg-status-item ${gOk ? "ok" : "warn"}">
      <span>${gOk ? "✓" : "○"}</span>
      <span>Gemini AI: ${gOk ? "Connected" : "Using smart fallback responses"}</span>
    </div>
    <div class="cfg-status-item ok">
      <span>✓</span>
      <span>Logged in as: <strong>${currentUser?.username || "Guest"}</strong></span>
    </div>
    <div style="margin-top:14px;padding:12px;background:rgba(124,58,237,0.08);border-radius:var(--radius-md);border:1px solid rgba(124,58,237,0.2)">
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.6">
        ${!fbOk || !gOk
          ? `<strong style="color:var(--violet-bright)">Admin Setup:</strong> Edit <code style="font-family:var(--font-mono);background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px">config.js</code> to connect Firebase and Gemini AI.`
          : `<strong style="color:var(--green)">All systems connected!</strong> Your data syncs in real-time.`
        }
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════
   AUTH UI HELPERS
══════════════════════════════════════ */
function showAuthError(msg) {
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  el.style.animation = "none";
  requestAnimationFrame(() => { el.style.animation = "authShake 0.4s ease"; });
}

function clearAuthError() {
  const el = document.getElementById("authError");
  if (el) el.style.display = "none";
}

function setAuthLoading(on) {
  const btn     = document.getElementById("authSubmitBtn");
  const spinner = document.getElementById("authSpinner");
  const text    = document.getElementById("authBtnText");
  if (!btn) return;
  btn.disabled = on;
  if (spinner) spinner.style.display = on ? "inline-block" : "none";
  if (text)   text.style.opacity = on ? "0.5" : "1";
}

function togglePasswordVisibility() {
  const input = document.getElementById("authPassword");
  const icon  = document.getElementById("eyeIcon");
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  if (icon) icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

function showForgotMessage() {
  showToast("Contact your admin to reset your password", "info");
}

function friendlyAuthError(err) {
  const msg = err?.message || err?.code || "";
  if (msg.includes("user-not-found") || msg.includes("No account")) return "No account found. Try signing up!";
  if (msg.includes("wrong-password")  || msg.includes("Incorrect"))  return "Incorrect password. Try again.";
  if (msg.includes("email-already"))  return "Username already taken. Try a different one.";
  if (msg.includes("weak-password"))  return "Password too weak. Use at least 6 characters.";
  if (msg.includes("network"))        return "Connection error. Check your internet and try again.";
  if (msg.includes("too-many"))       return "Too many attempts. Please wait a moment.";
  return msg || "Something went wrong. Please try again.";
}

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */
function simpleHash(str) {
  // Simple deterministic hash for local-only storage (not for production security)
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36) + str.length.toString(36);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
