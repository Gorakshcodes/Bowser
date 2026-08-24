/**
 * Educational AI helper for Bowser.
 * Priority:
 *  1) OpenAI-compatible API (AI_API_KEY + optional AI_API_BASE_URL / AI_MODEL)
 *  2) Local Ollama if running (free, no key)
 *  3) Built-in offline educational templates (always works)
 */

const AI_API_KEY = String(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const AI_API_BASE_URL = String(
  process.env.AI_API_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
).replace(/\/$/, "");
const AI_MODEL = String(process.env.AI_MODEL || "gpt-4o-mini").trim();
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || "llama3.2").trim();

async function runEducationalAi({ task, payload }) {
  const system = [
    "You are a careful education assistant for school teachers and kids.",
    "Be clear, age-appropriate, encouraging, and practical.",
    "Never invent personal data. Prefer simple language for kids.",
    "When asked for JSON, respond with valid JSON only."
  ].join(" ");

  const userPrompt = buildPrompt(task, payload);
  const preferJson = wantsJson(task);

  try {
    if (AI_API_KEY) {
      const text = await callOpenAiCompatible({ system, userPrompt, preferJson });
      return {
        ok: true,
        provider: "api",
        model: AI_MODEL,
        result: preferJson ? safeParseJson(text) : { text: String(text || "").trim() }
      };
    }
  } catch (error) {
    console.error("[AI] OpenAI-compatible call failed:", error.message || error);
  }

  try {
    const text = await callOllama({ system, userPrompt });
    if (text) {
      return {
        ok: true,
        provider: "ollama",
        model: OLLAMA_MODEL,
        result: preferJson ? safeParseJson(text) : { text: String(text || "").trim() }
      };
    }
  } catch (error) {
    // Ollama optional
  }

  return {
    ok: true,
    provider: "offline",
    model: "bowser-edu-templates",
    result: offlineGenerate(task, payload)
  };
}

function wantsJson(task) {
  return [
    "homework",
    "activity",
    "lesson-plan",
    "revision-notes",
    "student-insight"
  ].includes(task);
}

function buildPrompt(task, payload) {
  const subject = String(payload.subject || "General").trim();
  const topic = String(payload.topic || "Today's lesson").trim();
  const level = String(payload.level || "ages 7-12").trim();
  const notes = String(payload.notes || payload.taughtSummary || "").trim();
  const count = Math.min(Math.max(Number(payload.questionCount || 5), 3), 10);

  if (task === "homework") {
    return [
      `Create ${count} homework items for ${level} on subject "${subject}", topic "${topic}".`,
      notes ? `Teacher notes about what was taught: ${notes}` : "",
      "Return JSON: {\"title\":\"...\",\"instructions\":\"...\",\"questions\":[{\"prompt\":\"...\",\"hint\":\"...\"}],\"successCriteria\":\"...\"}"
    ].filter(Boolean).join("\n");
  }

  if (task === "activity") {
    return [
      `Design one hands-on learning activity for ${level}, subject "${subject}", topic "${topic}".`,
      notes ? `Context: ${notes}` : "",
      "Return JSON: {\"title\":\"...\",\"goal\":\"...\",\"steps\":[\"...\"],\"materials\":[\"...\"],\"teacherTips\":\"...\",\"kidFriendlyPrompt\":\"...\"}"
    ].filter(Boolean).join("\n");
  }

  if (task === "lesson-plan") {
    return [
      `Write a concise lesson plan for ${level}, subject "${subject}", topic "${topic}".`,
      notes ? `What has been taught so far / class notes: ${notes}` : "",
      "Return JSON: {\"objective\":\"...\",\"warmUp\":\"...\",\"teachSteps\":[\"...\"],\"practice\":\"...\",\"wrapUp\":\"...\",\"differentiation\":\"...\",\"durationMinutes\":45}"
    ].filter(Boolean).join("\n");
  }

  if (task === "revision-notes") {
    return [
      `Create kid-friendly revision notes for ${level}, subject "${subject}", topic "${topic}".`,
      notes ? `What was taught: ${notes}` : "",
      "Return JSON: {\"title\":\"...\",\"keyPoints\":[\"...\"],\"rememberTips\":[\"...\"],\"miniQuiz\":[{\"prompt\":\"...\",\"answer\":\"...\"}],\"encouragement\":\"...\"}"
    ].filter(Boolean).join("\n");
  }

  if (task === "student-insight") {
    return [
      "Analyze this student's learning signals and suggest next steps for the teacher.",
      `Student: ${payload.studentName || "Student"}`,
      `Subject focus: ${subject}`,
      `Scores/feedback history: ${JSON.stringify(payload.history || [])}`,
      `Recent answers: ${JSON.stringify(payload.recentAnswers || [])}`,
      "Return JSON: {\"strengths\":[\"...\"],\"gaps\":[\"...\"],\"learningStyleGuess\":\"...\",\"suggestedActivities\":[{\"title\":\"...\",\"why\":\"...\"}],\"messageForTeacher\":\"...\",\"messageForKid\":\"...\"}"
    ].join("\n");
  }

  return `Help a teacher with: ${task}. Context: ${JSON.stringify(payload)}`;
}

async function callOpenAiCompatible({ system, userPrompt, preferJson }) {
  const response = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.5,
      ...(preferJson ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI API ${response.status}: ${body.slice(0, 240)}`);
  }

  const data = await response.json();
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
}

async function callOllama({ system, userPrompt }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      return "";
    }
    const data = await response.json();
    return data.message && data.message.content ? data.message.content : "";
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_inner) {
        // fall through
      }
    }
    return { text: raw };
  }
}

function offlineGenerate(task, payload) {
  const subject = String(payload.subject || "General").trim();
  const topic = String(payload.topic || "Today's lesson").trim();
  const notes = String(payload.notes || payload.taughtSummary || "Key ideas from class").trim();
  const count = Math.min(Math.max(Number(payload.questionCount || 5), 3), 8);
  const studentName = String(payload.studentName || "your student").trim();

  if (task === "homework") {
    const questions = [];
    for (let i = 1; i <= count; i += 1) {
      questions.push({
        prompt: `${i}. In your own words, explain one idea about "${topic}" (${subject}).`,
        hint: "Use 2–4 short sentences and one example."
      });
    }
    questions[0] = {
      prompt: `1. What is the main idea of "${topic}"?`,
      hint: "Start with: The main idea is..."
    };
    if (questions[1]) {
      questions[1] = {
        prompt: `2. Give a real-life example of "${topic}".`,
        hint: "Think of home, school, or play."
      };
    }
    if (questions[2]) {
      questions[2] = {
        prompt: `3. What question do you still have about "${topic}"?`,
        hint: "Curious questions help learning grow."
      };
    }
    return {
      title: `${topic} practice`,
      instructions: `Complete these ${count} tasks about ${topic}. Show your thinking. You can write sentences or short steps.`,
      questions,
      successCriteria: "Clear answers, one example, and neat effort."
    };
  }

  if (task === "activity") {
    return {
      title: `${topic} explorer challenge`,
      goal: `Help the student practice "${topic}" through a short active task.`,
      steps: [
        `Read or recall what we learned about ${topic}.`,
        "Draw or list 3 key points on paper.",
        "Create one example of your own.",
        "Explain your example in 3 sentences.",
        "Share one thing that felt easy and one that felt hard."
      ],
      materials: ["Paper", "Pencil", "Optional: colored pens"],
      teacherTips: "Praise process. Ask 'why' once to stretch thinking.",
      kidFriendlyPrompt: `Your mission: become a ${topic} explorer! Draw, explain, and invent one example.`
    };
  }

  if (task === "lesson-plan") {
    return {
      objective: `Students will understand and apply the main ideas of ${topic} in ${subject}.`,
      warmUp: `2-minute recall: what do we already know about ${topic}?`,
      teachSteps: [
        `Introduce ${topic} with a simple story or picture.`,
        "Model 1 example together on the board.",
        "Students try a guided example in pairs.",
        "Quick check: thumbs up / side / down."
      ],
      practice: `Independent practice: 3 short questions on ${topic}.`,
      wrapUp: "Students write one sentence: Today I learned...",
      differentiation: "Support: sentence starters. Stretch: invent a harder example.",
      durationMinutes: 45,
      taughtSummaryNote: notes
    };
  }

  if (task === "revision-notes") {
    return {
      title: `Revise: ${topic}`,
      keyPoints: [
        `${topic} is part of ${subject}.`,
        "Remember the main idea in one sentence.",
        "Practice one example every day.",
        notes ? `From class: ${notes.slice(0, 180)}` : "Review class notes carefully."
      ],
      rememberTips: [
        "Read the key points out loud.",
        "Teach a stuffed toy or sibling for 1 minute.",
        "Sleep well — brains grow while you rest!"
      ],
      miniQuiz: [
        { prompt: `What is one key idea of ${topic}?`, answer: "Answers will vary; look for the main idea." },
        { prompt: `Give one example of ${topic}.`, answer: "Any correct real-life example." }
      ],
      encouragement: "Small practice every day makes you stronger. You've got this!"
    };
  }

  if (task === "student-insight") {
    const history = Array.isArray(payload.history) ? payload.history : [];
    const scores = history.map((item) => String(item.score || "")).filter(Boolean);
    const hasGaps = scores.some((score) => /low|needs|poor|2\/|3\/|4\/|fail/i.test(score));
    return {
      strengths: [
        `${studentName} is showing up and completing work.`,
        scores.length ? "There is enough work history to guide the next step." : "Ready for structured practice."
      ],
      gaps: hasGaps
        ? ["Some recent scores suggest shaky foundations on recent topics."]
        : ["Watch for confidence gaps when topics get abstract."],
      learningStyleGuess: "Likely benefits from short examples + visual steps + praise for effort.",
      suggestedActivities: [
        {
          title: "Example swap",
          why: "Builds transfer: student invents one new example after seeing a model."
        },
        {
          title: "Teach-back",
          why: "Explaining out loud reveals true understanding."
        }
      ],
      messageForTeacher: `Focus the next lesson on one clear skill in ${subject}. Keep tasks short, model first, then independent try. Celebrate effort and one improvement.`,
      messageForKid: `You are learning! Keep trying one small practice each day. Mistakes are clues, not stops.`
    };
  }

  return {
    text: `Educational draft for ${subject} / ${topic}: keep lessons short, model first, then practice, then reflect.`
  };
}

function getAiStatus() {
  return {
    apiConfigured: Boolean(AI_API_KEY),
    apiBaseUrl: AI_API_BASE_URL,
    model: AI_MODEL,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    offlineFallback: true
  };
}

module.exports = {
  runEducationalAi,
  getAiStatus
};
