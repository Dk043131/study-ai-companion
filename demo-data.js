/* ═══════════════════════════════════════════
   LIVE DATA STUBS — No demo data.
   All data comes exclusively from Firebase RTDB.
   These are empty defaults shown when the user
   has no sessions yet (new account).
   ═══════════════════════════════════════════ */

// Empty defaults for brand-new users with zero sessions
const DEMO_SESSIONS   = [];   // No fake sessions
const DEMO_DAILY      = { labels: [], focusMins: [], target: [] };
const DEMO_FOCUS_TREND = { labels: [], pct: [] };
const DEMO_INTERRUPTS  = { labels: [], counts: [] };
const DEMO_SPARKLINES  = { weekTime: [], focusTrend: [], bestSession: [], sessions: [] };
const DEMO_INSIGHTS    = [];
const DEMO_RECOMMENDATIONS = [];
const DEMO_DEVICE = { online: false, presence: false, sessionActive: false };
