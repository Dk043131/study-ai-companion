/* ═══════════════════════════════════════════
   GEMINI 2.5 FLASH — AI Mentor Integration
   ═══════════════════════════════════════════ */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getGeminiKey() {
  // Priority: APP_CONFIG (config.js) → state → localStorage
  if (typeof APP_CONFIG !== "undefined" && APP_CONFIG.geminiApiKey)
    return APP_CONFIG.geminiApiKey;
  if (typeof state !== "undefined" && state.geminiKey)
    return state.geminiKey;
  return localStorage.getItem("gemini_api_key") || "";
}

function buildSessionContext(sessions) {
  return sessions.slice(0, 10).map((s, i) =>
    `Session ${i+1}: Date=${s.date}, Duration=${s.durationStr}, Focus=${s.focusPct}%, Interruptions=${s.interruptions}, Quality=${s.quality}`
  ).join("\n");
}

async function callGemini(prompt, systemInstruction = "") {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemInstruction || MENTOR_SYSTEM_PROMPT }]
    },
    contents: [
      { role: "user", parts: [{ text: prompt }] }
    ],
    generationConfig: {
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: 512,
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || "Gemini API error");
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiChat(messages, systemInstruction = "") {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error("NO_API_KEY");

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemInstruction || MENTOR_SYSTEM_PROMPT }]
    },
    contents: messages,
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 800,
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || "Gemini API error");
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

const MENTOR_SYSTEM_PROMPT = `You are a warm, insightful, and encouraging personal study mentor. You have access to the user's real study session data.

Your personality:
- Speak like a knowledgeable friend, not a robot
- Be specific — reference actual numbers from their data
- Be encouraging but honest — celebrate wins, gently flag struggles
- Give ONE clear, actionable suggestion per insight
- Keep insights to 2-4 sentences max
- Use "you" language, not "the user"
- Tone: warm mentor, not corporate coach

Never use generic advice. Always ground your response in the specific data provided.`;

async function generateStudyInsight(sessions) {
  const context = buildSessionContext(sessions);
  const prompt = `Here are the user's recent study sessions:\n\n${context}\n\nProvide one specific, personalized, encouraging insight about their study pattern. Focus on something actionable they can improve or a win to celebrate. Keep it to 2-4 sentences.`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    if (err.message === "NO_API_KEY") {
      return DEMO_INSIGHTS[0].text;
    }
    throw err;
  }
}

// Chat conversation history (in Gemini format)
let chatHistory = [];

async function sendChatToGemini(userMessage, sessions) {
  const context = buildSessionContext(sessions);
  const systemWithContext = MENTOR_SYSTEM_PROMPT + `\n\nUser's recent study data:\n${context}`;

  chatHistory.push({
    role: "user",
    parts: [{ text: userMessage }]
  });

  try {
    const reply = await callGeminiChat(chatHistory, systemWithContext);
    chatHistory.push({
      role: "model",
      parts: [{ text: reply }]
    });
    return reply;
  } catch (err) {
    chatHistory.pop(); // Remove the failed user message
    if (err.message === "NO_API_KEY") {
      return getDemoReply(userMessage);
    }
    throw err;
  }
}

function getDemoReply(userMessage) {
  const msg = userMessage.toLowerCase();
  if (msg.includes("focus") || msg.includes("when")) {
    return "Based on your data, you're most focused between 9–11 AM. Your morning sessions average 88% focus — significantly higher than afternoon sessions which hover around 66%. I'd strongly recommend blocking your hardest subjects in that morning window consistently.";
  }
  if (msg.includes("streak") || msg.includes("improve")) {
    return "Your 7-day streak is impressive! To keep building on it, I'd suggest setting a minimum session goal — even 30 minutes counts on tough days. Your data shows that days where you skip entirely break momentum more than short sessions do.";
  }
  if (msg.includes("break") || msg.includes("rest")) {
    return "Your focus drops noticeably after 25 minutes in today's session. The Pomodoro approach works well for your pattern — try 25 minutes deep work, then a 5-minute break. After 4 cycles, take a longer 20-minute break. Your best session (92% focus yesterday) had a natural rhythm close to this.";
  }
  if (msg.includes("plan") || msg.includes("schedule") || msg.includes("tomorrow")) {
    return "For tomorrow, I'd suggest: Start at 9 AM (your peak hour) with your hardest subject for 2 sessions of 25 minutes each. Take a 20-minute break, then tackle medium-priority work. Finish by noon if possible — your afternoon scores suggest diminishing returns after 1 PM. This pattern mirrors your best days this week.";
  }
  if (msg.includes("pattern") || msg.includes("habit")) {
    return "Your study pattern shows clear strength in the mornings — you average 84% focus before noon vs 65% after. Your best sessions are 90–130 minutes long. Interestingly, your zero-interruption sessions are 2x more likely to happen before 11 AM. That tells me your environment or mental state shifts significantly in the afternoon.";
  }
  return "That's a great question! Based on your recent 10 sessions, you're averaging 79% focus with about 2.9 interruptions per session. Your trajectory is positive — this week you're 5% higher than last week. What specific aspect of your studying would you like to dig deeper into?";
}

function resetChat() {
  chatHistory = [];
}
