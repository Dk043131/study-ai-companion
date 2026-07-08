/* ═══════════════════════════════════════════════════════════════════════════
   STUDY AI COMPANION — ESP32 FOCUS TIMER FIRMWARE v3.1
   ─────────────────────────────────────────────────────────────────────────
   FEATURES:
   ✅ Physical button start/stop with debounce
   ✅ Ultrasonic presence detection (Green LED = present, Red LED = absent)
   ✅ Interruption counting + buzzer nudge when user leaves desk
   ✅ Accurate focus % calculation
   ✅ Smartwatch-style offline session queue (stored in flash memory)
   ✅ Auto-sync offline sessions when WiFi reconnects
   ✅ NTP time sync for accurate timestamps
   ✅ Real-time Firebase status push every second during session
   ✅ Commands from web app (start/stop/nudge remotely)
   ✅ Auto-reconnect WiFi in background
   ═══════════════════════════════════════════════════════════════════════════ */

#include <WiFi.h>

// ── Reduce ESP32 Flash Size by Disabling Unused Firebase Features ──
#define FIREBASE_DISABLE_FIRESTORE
#define FIREBASE_DISABLE_STORAGE
#define FIREBASE_DISABLE_FCM
#define FIREBASE_DISABLE_FUNCTIONS

#include <Firebase_ESP_Client.h>
#include <Preferences.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

/* ────────────────────────────────────────
   PIN DEFINITIONS  (match your wiring)
──────────────────────────────────────── */
#define PIN_BUTTON     4   // Push button (one leg to GND, other to D4)
#define PIN_BUZZER     15  // Changed from D2 to D15 (D2 can cause issues)
#define PIN_LED_GREEN 21   // Green LED anode (cathode → GND via 220Ω)
#define PIN_LED_RED   19   // Red LED anode   (cathode → GND via 220Ω)
#define PIN_US_TRIG    5   // HC-SR04 TRIG
#define PIN_US_ECHO   18   // HC-SR04 ECHO

/* ────────────────────────────────────────
   NETWORK / FIREBASE CREDENTIALS
──────────────────────────────────────── */
#define WIFI_SSID      "IDEALAB"
#define WIFI_PASSWORD  ""
#define FIREBASE_KEY   "AIzaSyC7R3un13VYZGkcrdtQFHnJJ-5J7QJ2n6Q"
#define FIREBASE_URL   "https://study-ai-3a685-default-rtdb.firebaseio.com"

const char* deviceId = "esp32-desk-01";

/* ────────────────────────────────────────
   TUNABLE SETTINGS
──────────────────────────────────────── */
int distThreshCm  = 80;   // cm — closer than this = you are at desk
int targetMins    = 120;  // target session duration (for future UI)

/* ────────────────────────────────────────
   SESSION STATE
──────────────────────────────────────── */
bool          isActive      = false;   // timer running?
bool          isPresent     = false;   // currently detected at desk?
bool          lastPresent   = false;   // state in previous second (interrupt edge)
unsigned long sessionStartTs = 0;      // Unix timestamp or millis at session start
unsigned long focusSecs     = 0;       // seconds actually present at desk
unsigned long totalSecs     = 0;       // total elapsed seconds
int           interruptCount = 0;      // how many times user left desk
int           absenceStreak = 0;       // consecutive seconds away (for buzzer delay)

/* ────────────────────────────────────────
   TIMING / DEBOUNCE
──────────────────────────────────────── */
unsigned long lastBtnPress   = 0;
const unsigned long DEBOUNCE = 60;    // ms — button debounce window

unsigned long lastSecTick    = 0;     // tracks 1-second interval for session
unsigned long lastStatusPush = 0;     // tracks 5-second interval for Firebase status
unsigned long lastWifiCheck  = 0;     // tracks WiFi watchdog

/* ────────────────────────────────────────
   FIREBASE
──────────────────────────────────────── */
FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig fbCfg;
Preferences    prefs;

bool firebaseReady = false;

/* ═══════════════════════════════════════
   BUZZER HELPERS (Fixed for ESP32 LEDC)
═══════════════════════════════════════ */
void beep(int freq, int durationMs) {
  // Use ESP32 native hardware PWM to avoid "LEDC not initialized" errors
  ledcSetup(0, freq, 8);         // Channel 0, frequency, 8-bit resolution
  ledcAttachPin(PIN_BUZZER, 0);  // Attach pin 2 to channel 0
  ledcWrite(0, 128);             // 50% duty cycle
  delay(durationMs);
  ledcWrite(0, 0);               // 0% duty cycle (Off)
  delay(10);
}

void beepStartSession() {
  beep(1000, 120);
  delay(60);
  beep(1400, 120);
  delay(60);
  beep(1800, 200);
}

void beepEndSession() {
  beep(1800, 120);
  delay(60);
  beep(1400, 120);
  delay(60);
  beep(900, 300);
}

void beepNudge() {
  // Short urgent triple-beep to nudge user back to desk
  for (int i = 0; i < 3; i++) {
    beep(880, 80);
    delay(60);
  }
}

void beepStartup() {
  beep(1200, 80);
  delay(40);
  beep(1600, 120);
}

/* ═══════════════════════════════════════
   LED HELPERS
═══════════════════════════════════════ */
void ledStudying() {
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_RED,   LOW);
}

void ledAbsent() {
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED,   HIGH);
}

void ledOff() {
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED,   LOW);
}

void ledBothFlash(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_RED,   HIGH);
    delay(ms);
    ledOff();
    delay(ms);
  }
}

/* ═══════════════════════════════════════
   ULTRASONIC DISTANCE MEASUREMENT
   Returns distance in cm (999 = no echo)
═══════════════════════════════════════ */
int getDistance() {
  // Take 3 readings and return the median to reduce false triggers
  int readings[3];
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_US_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_US_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
    long dur = pulseIn(PIN_US_ECHO, HIGH, 25000);  // 25ms timeout ≈ 430cm max
    readings[i] = (dur == 0) ? 999 : (int)(dur * 0.034f / 2.0f);
    delay(15);  // brief pause between readings
  }
  // Simple sort for median
  if (readings[0] > readings[1]) { int t = readings[0]; readings[0] = readings[1]; readings[1] = t; }
  if (readings[1] > readings[2]) { int t = readings[1]; readings[1] = readings[2]; readings[2] = t; }
  if (readings[0] > readings[1]) { int t = readings[0]; readings[0] = readings[1]; readings[1] = t; }
  return readings[1]; // median
}

/* ═══════════════════════════════════════
   FIREBASE STATUS PUSH
   Path: /devices/{id}/status
═══════════════════════════════════════ */
void pushStatus() {
  if (!firebaseReady || WiFi.status() != WL_CONNECTED) return;
  if (!Firebase.ready()) return;

  String path = "/devices/" + String(deviceId) + "/status";
  FirebaseJson json;
  json.add("online",        true);
  json.add("presence",      isPresent);
  json.add("sessionActive", isActive);
  json.add("startTime",     (isActive ? (int)sessionStartTs : 0));
  json.add("focusSecs",     (int)focusSecs);
  json.add("totalSecs",     (int)totalSecs);
  json.add("interruptions", interruptCount);
  json.add("distThreshCm",  distThreshCm);
  json.add("targetMins",    targetMins);
  json.add("timestamp",     (int)time(nullptr));

  if (!Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json)) {
    Serial.print("[Firebase] Status push failed: ");
    Serial.println(fbdo.errorReason());
  }
}

/* ═══════════════════════════════════════
   UPLOAD SESSION TO FIREBASE OR QUEUE
   Called when a session ends
═══════════════════════════════════════ */
void uploadSession(unsigned long ts, int durMins, int focusPct, int intrCount) {
  String path = "/devices/" + String(deviceId) + "/sessions/" + String(ts);
  FirebaseJson json;
  json.add("startTime",     (int)ts);
  json.add("duration",      durMins);
  json.add("focusPct",      focusPct);
  json.add("interruptions", intrCount);
  json.add("title",         "Focus Session");
  json.add("source",        "device");

  if (firebaseReady && WiFi.status() == WL_CONNECTED && Firebase.ready()) {
    Serial.println("[Firebase] Uploading session...");
    if (Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json)) {
      Serial.println("[Firebase] ✅ Session uploaded successfully!");
    } else {
      Serial.print("[Firebase] ❌ Upload failed: ");
      Serial.println(fbdo.errorReason());
      Serial.println("[Queue] Saving to offline queue instead...");
      goto saveOffline;
    }
    return;
  }

saveOffline:
  Serial.println("[Queue] WiFi offline — saving session to flash memory...");
  prefs.begin("study_q", false);
  int c = prefs.getInt("count", 0) + 1;
  String prefix = String(c) + "_";
  prefs.putULong((prefix + "t").c_str(), ts);
  prefs.putInt((prefix + "d").c_str(),   durMins);
  prefs.putInt((prefix + "f").c_str(),   focusPct);
  prefs.putInt((prefix + "i").c_str(),   intrCount);
  prefs.putInt("count", c);
  prefs.end();
  Serial.print("[Queue] Queued as entry #"); Serial.println(c);
}

/* ═══════════════════════════════════════
   SYNC OFFLINE QUEUE TO FIREBASE
   Called periodically when WiFi is up
═══════════════════════════════════════ */
void syncOfflineQueue() {
  if (!firebaseReady || WiFi.status() != WL_CONNECTED) return;
  if (!Firebase.ready()) return;

  prefs.begin("study_q", false);
  int count = prefs.getInt("count", 0);
  if (count == 0) { prefs.end(); return; }

  Serial.print("[Sync] Found "); Serial.print(count);
  Serial.println(" offline session(s) to sync...");

  int uploaded = 0;
  for (int i = 1; i <= count; i++) {
    String prefix = String(i) + "_";
    unsigned long ts   = prefs.getULong((prefix + "t").c_str(), 0);
    int           dur  = prefs.getInt((prefix + "d").c_str(), 0);
    int           foc  = prefs.getInt((prefix + "f").c_str(), 0);
    int           intr = prefs.getInt((prefix + "i").c_str(), 0);
    if (ts == 0) { uploaded++; continue; }  // skip corrupted entry

    String path = "/devices/" + String(deviceId) + "/sessions/" + String(ts);
    FirebaseJson json;
    json.add("startTime",     (int)ts);
    json.add("duration",      dur);
    json.add("focusPct",      foc);
    json.add("interruptions", intr);
    json.add("title",         "Focus Session");
    json.add("source",        "device-offline");

    if (Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json)) {
      uploaded++;
      Serial.print("[Sync] ✅ Entry #"); Serial.print(i); Serial.println(" uploaded.");
    } else {
      Serial.print("[Sync] ❌ Entry #"); Serial.print(i);
      Serial.print(" failed: "); Serial.println(fbdo.errorReason());
      break;  // stop on failure; retry next loop cycle
    }
  }

  if (uploaded == count) {
    prefs.clear();
    prefs.putInt("count", 0);
    Serial.println("[Sync] All offline sessions synced! Queue cleared.");
  }
  prefs.end();
}

/* ═══════════════════════════════════════
   HANDLE REMOTE COMMANDS FROM WEB APP
   Path: /devices/{id}/commands/latest
═══════════════════════════════════════ */
void handleCommands() {
  if (!firebaseReady || WiFi.status() != WL_CONNECTED) return;
  if (!Firebase.ready()) return;

  String path = "/devices/" + String(deviceId) + "/commands/latest";
  if (!Firebase.RTDB.getJSON(&fbdo, path.c_str())) return;

  FirebaseJson& json = fbdo.jsonObject();
  FirebaseJsonData handled, typeData, valueData;

  json.get(handled, "handled");
  if (!handled.success || handled.boolValue) return;  // already processed

  json.get(typeData, "type");
  if (!typeData.success) return;

  String cmd = typeData.stringValue;
  Serial.print("[CMD] Received: "); Serial.println(cmd);

  if      (cmd == "start_session"  && !isActive) startSession();
  else if (cmd == "end_session"    && isActive)  endSession();
  else if (cmd == "break_reminder")              { beep(700, 400); delay(100); beep(700, 400); }
  else if (cmd == "focus_nudge")                 beepNudge();
  else if (cmd == "set_threshold") {
    json.get(valueData, "value");
    if (valueData.success) {
      distThreshCm = valueData.intValue;
      Serial.print("[CMD] Distance threshold set to: "); Serial.println(distThreshCm);
    }
  }
  else if (cmd == "set_target_mins") {
    json.get(valueData, "value");
    if (valueData.success) {
      targetMins = valueData.intValue;
      Serial.print("[CMD] Target minutes set to: "); Serial.println(targetMins);
    }
  }

  // Mark command as handled
  Firebase.RTDB.setBool(&fbdo, (path + "/handled").c_str(), true);
}

/* ═══════════════════════════════════════
   SESSION START
═══════════════════════════════════════ */
void startSession() {
  isActive       = true;
  focusSecs      = 0;
  totalSecs      = 0;
  interruptCount = 0;
  absenceStreak  = 0;
  lastPresent    = false;
  isPresent      = false;

  // Use real Unix time if NTP synced, else millis as fallback
  sessionStartTs = (unsigned long)time(nullptr);
  if (sessionStartTs < 1700000000UL) {
    sessionStartTs = millis() / 1000;  // rough seconds since boot
  }

  Serial.println("\n╔══════════════════════════════════╗");
  Serial.println("║   🟢 FOCUS SESSION STARTED        ║");
  Serial.printf( "║   Timestamp: %-20lu║\n", sessionStartTs);
  Serial.println("╚══════════════════════════════════╝");

  beepStartSession();
  ledStudying();
  pushStatus();
}

/* ═══════════════════════════════════════
   SESSION END
═══════════════════════════════════════ */
void endSession() {
  isActive = false;

  // Calculate results
  int durMins  = max((int)(totalSecs / 60), 1);
  int focusPct = (totalSecs > 0) ? (int)(focusSecs * 100UL / totalSecs) : 100;

  Serial.println("\n╔══════════════════════════════════╗");
  Serial.println("║   🔴 FOCUS SESSION ENDED          ║");
  Serial.printf( "║   Duration:     %-4d min          ║\n", durMins);
  Serial.printf( "║   Focus:        %-3d%%              ║\n", focusPct);
  Serial.printf( "║   Interruptions:%-3d               ║\n", interruptCount);
  Serial.println("╚══════════════════════════════════╝");

  beepEndSession();
  ledBothFlash(3, 150);
  ledOff();

  // Upload or queue
  uploadSession(sessionStartTs, durMins, focusPct, interruptCount);

  // Reset state
  sessionStartTs = 0;
  focusSecs      = 0;
  totalSecs      = 0;
  interruptCount = 0;
  absenceStreak  = 0;
  isPresent      = false;
  lastPresent    = false;

  pushStatus();
}

/* ═══════════════════════════════════════
   SETUP
═══════════════════════════════════════ */
void setup() {
  Serial.begin(115200);
  delay(800);

  Serial.println("\n\n╔════════════════════════════════════════╗");
  Serial.println("║  Study AI Companion Focus Timer v3.0   ║");
  Serial.println("╚════════════════════════════════════════╝");

  // Configure GPIO
  pinMode(PIN_BUTTON,    INPUT_PULLUP);
  pinMode(PIN_BUZZER,    OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED,   OUTPUT);
  pinMode(PIN_US_TRIG,   OUTPUT);
  pinMode(PIN_US_ECHO,   INPUT);
  ledOff();

  // Startup LED sweep
  digitalWrite(PIN_LED_GREEN, HIGH); delay(200);
  digitalWrite(PIN_LED_RED,   HIGH); delay(200);
  ledOff();
  beepStartup();

  // ── Firebase: init credentials FIRST (before WiFi so they are never missing) ──
  Serial.println("\n[Firebase] Initializing credentials...");
  fbCfg.api_key     = FIREBASE_KEY;
  fbCfg.database_url = FIREBASE_URL;
  Firebase.begin(&fbCfg, &auth);
  Firebase.reconnectWiFi(true);
  firebaseReady = true;
  Serial.println("[Firebase] Credentials set. ✅");

  // ── WiFi Connection ──
  Serial.printf("\n[WiFi] Connecting to '%s' ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 24) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] ✅ Connected! IP: ");
    Serial.println(WiFi.localIP());

    Serial.println("[NTP]  Syncing time...");
    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    delay(2000);  // allow NTP to resolve

    struct tm ti;
    if (getLocalTime(&ti)) {
      Serial.printf("[NTP]  ✅ Time synced: %04d-%02d-%02d %02d:%02d:%02d\n",
        ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday,
        ti.tm_hour, ti.tm_min, ti.tm_sec);
    } else {
      Serial.println("[NTP]  ⚠️ Time sync pending...");
    }

    syncOfflineQueue();
    Serial.println("\n✅ Device ready! Press button to start a session.");
  } else {
    Serial.println("[WiFi] ⚠️ Connection failed. Running in OFFLINE mode.");
    Serial.println("       Sessions will be saved locally and synced when connected.");
  }

  // Flash green 3× to signal ready
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_GREEN, HIGH); delay(120);
    digitalWrite(PIN_LED_GREEN, LOW);  delay(120);
  }
}

/* ═══════════════════════════════════════
   MAIN LOOP
═══════════════════════════════════════ */
void loop() {
  unsigned long now = millis();

  /* ── 1. BUTTON DETECTION (debounced) ── */
  static bool lastBtnState = HIGH;
  bool btnState = digitalRead(PIN_BUTTON);

  if (btnState == LOW && lastBtnState == HIGH && (now - lastBtnPress > DEBOUNCE)) {
    lastBtnPress = now;
    delay(50);  // extra debounce settle
    if (digitalRead(PIN_BUTTON) == LOW) {  // confirm still pressed
      if (!isActive) {
        startSession();
      } else {
        endSession();
      }
    }
  }
  lastBtnState = btnState;

  /* ── 2. SESSION TICK — runs every 1 second while active ── */
  if (isActive && (now - lastSecTick >= 1000)) {
    lastSecTick = now;
    totalSecs++;

    int dist = getDistance();
    isPresent = (dist <= distThreshCm);

    if (isPresent) {
      // ─ User is at desk ─
      focusSecs++;
      absenceStreak = 0;
      ledStudying();

      if (!lastPresent) {
        // Just returned to desk
        Serial.printf("[Desk] ▶ Returned to desk (dist=%dcm, focus=%.0f%%)\n",
          dist, (focusSecs * 100.0f / totalSecs));
      }

    } else {
      // ─ User is away from desk ─
      absenceStreak++;
      ledAbsent();

      if (lastPresent) {
        // Just left the desk → count as interruption
        interruptCount++;
        Serial.printf("[Desk] ⏸ Left desk! Interruption #%d (dist=%dcm)\n",
          interruptCount, dist);
        beepNudge();  // immediate nudge on first detection
      } else if (absenceStreak % 30 == 0) {
        // Repeat nudge every 30 seconds of continued absence
        Serial.printf("[Desk] ⚠ Still away (%d sec). Nudging...\n", absenceStreak);
        beepNudge();
      }
    }

    lastPresent = isPresent;

    // Push live status to Firebase every second during session
    pushStatus();

    // Log every 60 seconds
    if (totalSecs % 60 == 0) {
      int focusPct = (totalSecs > 0) ? (int)(focusSecs * 100UL / totalSecs) : 100;
      Serial.printf("[Timer] %lu min elapsed | Focus: %d%% | Interruptions: %d\n",
        totalSecs / 60, focusPct, interruptCount);
    }
  }

  /* ── 3. BACKGROUND TASKS every 5 seconds (when not in tight session tick) ── */
  if (now - lastStatusPush >= 5000) {
    lastStatusPush = now;

    // Push idle status when no session running
    if (!isActive) {
      pushStatus();
    }

    // Check for remote commands from web app
    handleCommands();

    // Try to sync any offline sessions
    if (!isActive) {
      syncOfflineQueue();
    }
  }

  /* ── 4. WIFI WATCHDOG — reconnect if dropped ── */
  if (now - lastWifiCheck >= 30000) {
    lastWifiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] 🔄 Connection lost. Reconnecting...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}
