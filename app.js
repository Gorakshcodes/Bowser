(function () {
  const MAX_HOMEWORK_FILE_SIZE = 8 * 1024 * 1024;
  const DASHBOARD_REFRESH_MS = 20000;
  const ALLOWED_HOMEWORK_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif"
  ]);
  const app = document.getElementById("app");
  let welcomeParticleFrame = 0;
  let welcomeParticleCleanup = null;
  const KID_THEME_STORAGE_KEY = "bowser_kid_theme";
  const KID_THEMES = {
    game: {
      id: "game",
      label: "Game",
      emoji: "⚔️",
      hero: "🤖",
      join: "DEPLOY",
      empty: "🛡️",
      free: "⚙️",
      mission: "📡",
      send: "📤",
      trophy: "🏅",
      trophyEmpty: "🔩",
      calendar: "🗺️",
      upcoming: "🎯",
      classes: "⚙️",
      stars: "⭐",
      todo: "🔧",
      bag: "🧰",
      progress: "📈",
      progressTitle: "Mission log",
      greetings: ["PILOT ONLINE", "MECH READY", "SYSTEMS GO"],
      tagline: "Mech Arena mode — bold, fast, mission-ready.",
      missionTitle: "Transmission",
      missionText: "Upload homework intel to command.",
      calendarTitle: "Ops calendar",
      listTitle: "Mission queue",
      sendTitle: "Uplink",
      trophyTitle: "Honor rack",
      symbols: ["⚔️", "🤖", "🛡️", "⚙️", "🚀", "📡", "🔧", "💥"]
    },
    play: {
      id: "play",
      label: "Play",
      emoji: "🎨",
      hero: "🌟",
      join: "Join class 🚀",
      empty: "🎈",
      free: "🌈",
      mission: "📸",
      send: "📤",
      trophy: "🏆",
      trophyEmpty: "✨",
      calendar: "📅",
      upcoming: "🗓️",
      classes: "📚",
      stars: "⭐",
      todo: "✏️",
      bag: "🎒",
      progress: "📊",
      progressTitle: "Class progress",
      greetings: ["Hey superstar", "Hi friend", "Hello champ"],
      tagline: "Bright, simple, and fun for learning.",
      missionTitle: "Homework mission",
      missionText: "Snap your work and send it to your teacher!",
      calendarTitle: "My calendar",
      listTitle: "Coming up",
      sendTitle: "Send homework",
      trophyTitle: "My stars",
      symbols: ["📚", "🎨", "🚀", "⭐", "🎈", "🌈", "✏️", "💡"]
    }
  };

  const state = {
    user: null,
    classes: [],
    submissions: [],
    assignments: [],
    assignmentSubmissions: [],
    students: [],
    managedUsers: [],
    zoomConfigured: false,
    googleMeetConfigured: false,
    teamsSupported: true,
    aiStatus: null,
    aiDraft: null,
    aiBusy: false,
    insightStudentId: "",
    message: null,
    authMode: "login",
    authRole: "teacher",
    registerRole: "student",
    meetingProvider: "none",
    zoomMode: "manual",
    dashboardTab: "meetings",
    progressPeriod: "all",
    calendarView: "week",
    calendarCursor: createDateKey(new Date()),
    selectedCalendarStudentId: "all",
    activeMeetingEditorId: null,
    selectedClassId: null,
    isEditingClass: false,
    scheduleMode: "once",
    seriesPattern: "weekdays",
    seriesTimes: ["16:00"],
    classListFilter: "upcoming",
    kidTheme: loadKidThemeId(),
    pending2fa: null
  };

  const discardedFormDrafts = new Set();

  initialize();

  app.addEventListener("submit", handleSubmit);
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleWindowFocus);
  window.setInterval(refreshActiveSessionSilently, DASHBOARD_REFRESH_MS);

  async function initialize() {
    try {
      await refreshDashboard();
    } catch (error) {
      if (error.status === 401) {
        renderApp();
        return;
      }

      renderApp({
        type: "error",
        text: error.message || "Could not load your dashboard. Please log in again."
      });
    }
  }

  function renderApp(message) {
    if (message) {
      state.message = message;
    }

    if (!state.user) {
      document.body.classList.add("is-welcome");
      document.body.classList.remove("is-kid");
      clearKidThemeClasses();
      app.innerHTML = renderLogin();
      startWelcomeParticles();
      return;
    }

    stopWelcomeParticles();
    document.body.classList.remove("is-welcome");
    const isKid = state.user.role === "student";
    document.body.classList.toggle("is-kid", isKid);
    if (isKid) {
      applyKidThemeClass(state.kidTheme);
    } else {
      clearKidThemeClasses();
    }

    // Every render rebuilds the dashboard markup, so half-typed forms have to be
    // carried across by hand. Without this a background refresh (or adding a
    // second class time) silently wipes what the teacher had already filled in.
    const draft = captureFormDrafts();
    app.innerHTML = state.user.role === "admin"
      ? renderAdminDashboard()
      : state.user.role === "teacher"
        ? renderTeacherDashboard()
        : renderStudentDashboard();
    restoreFormDrafts(draft);
  }

  function captureFormDrafts() {
    const drafts = { forms: {}, focus: null };
    const active = document.activeElement;

    app.querySelectorAll("form[data-form]").forEach((form) => {
      const key = getFormDraftKey(form);
      if (!key || discardedFormDrafts.has(key)) {
        return;
      }

      const fields = {};
      form.querySelectorAll("input[name], select[name], textarea[name]").forEach((field) => {
        if (field.type === "file" || field.type === "password" || field.type === "submit") {
          return;
        }

        const bucket = fields[field.name] || (fields[field.name] = []);
        bucket.push(field.type === "checkbox" || field.type === "radio" ? field.checked : field.value);
      });

      drafts.forms[key] = fields;

      if (active && form.contains(active) && active.name) {
        drafts.focus = {
          formKey: key,
          name: active.name,
          index: [...form.querySelectorAll(`[name="${CSS.escape(active.name)}"]`)].indexOf(active),
          selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
          selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
        };
      }
    });

    discardedFormDrafts.clear();
    return drafts;
  }

  function restoreFormDrafts(drafts) {
    if (!drafts) {
      return;
    }

    app.querySelectorAll("form[data-form]").forEach((form) => {
      const fields = drafts.forms[getFormDraftKey(form)];
      if (!fields) {
        return;
      }

      Object.keys(fields).forEach((name) => {
        const values = fields[name];
        const controls = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
        controls.forEach((control, index) => {
          if (index >= values.length) {
            return;
          }

          if (control.type === "checkbox" || control.type === "radio") {
            control.checked = Boolean(values[index]);
            return;
          }

          if (control.tagName === "SELECT" && ![...control.options].some((option) => option.value === values[index])) {
            return;
          }

          control.value = values[index];
        });
      });
    });

    const focus = drafts.focus;
    if (!focus) {
      return;
    }

    const form = [...app.querySelectorAll("form[data-form]")].find((entry) => getFormDraftKey(entry) === focus.formKey);
    const control = form
      ? [...form.querySelectorAll(`[name="${CSS.escape(focus.name)}"]`)][Math.max(focus.index, 0)]
      : null;

    if (!control) {
      return;
    }

    control.focus();
    if (focus.selectionStart !== null && typeof control.setSelectionRange === "function") {
      try {
        control.setSelectionRange(focus.selectionStart, focus.selectionEnd);
      } catch (_error) {
        // Inputs such as date/time reject setSelectionRange; focus alone is enough.
      }
    }
  }

  function getFormDraftKey(form) {
    const type = form.dataset.form || "";
    const scope = form.dataset.classId || form.dataset.assignmentId || form.dataset.submissionId || "";
    return scope ? `${type}:${scope}` : type;
  }

  // Marks a form so the next render starts from the freshly rendered markup
  // instead of a stale draft (after a successful save, or when switching a
  // form between "create" and "edit" duties).
  function discardFormDraft(key) {
    discardedFormDrafts.add(key);
  }

  // Series times live in state so the row count survives a render, but the
  // teacher edits the inputs directly — read them back before changing the list.
  function syncSeriesTimesFromDom() {
    const inputs = [...app.querySelectorAll('form[data-form="schedule-class"] input[name="seriesTimes"]')];
    if (!inputs.length) {
      return;
    }

    state.seriesTimes = inputs.map((input, index) => input.value || state.seriesTimes[index] || "16:00");
  }

  function renderWelcomeStickers() {
    const stickers = [
      { emoji: "📚", label: "Books", tone: "sun" },
      { emoji: "🎒", label: "School bag", tone: "pink" },
      { emoji: "🚲", label: "Cycle", tone: "mint" },
      { emoji: "💻", label: "Computer", tone: "sky" },
      { emoji: "🎮", label: "Game console", tone: "grape" },
      { emoji: "✈️", label: "Aeroplane", tone: "sky" },
      { emoji: "💡", label: "Bulb", tone: "sun" },
      { emoji: "🎨", label: "Art", tone: "pink" },
      { emoji: "🚀", label: "Rocket", tone: "grape" },
      { emoji: "🌈", label: "Rainbow", tone: "mint" },
      { emoji: "✏️", label: "Pencil", tone: "sun" },
      { emoji: "🧩", label: "Puzzle", tone: "pink" },
      { emoji: "🔬", label: "Science", tone: "sky" },
      { emoji: "🎵", label: "Music", tone: "grape" }
    ];

    return `
      <div class="welcome-stickers" aria-hidden="true">
        ${stickers.map((item, index) => `
          <span class="welcome-sticker welcome-sticker--${item.tone} welcome-sticker--${index + 1}" title="${escapeAttribute(item.label)}">${item.emoji}</span>
        `).join("")}
      </div>
    `;
  }

  function renderLogin() {
    const is2fa = state.authMode === "2fa";
    return `
      <section class="welcome-stage" aria-label="Welcome">
        <canvas class="welcome-particles" id="welcome-particles" aria-hidden="true"></canvas>
        <div class="welcome-nebula" aria-hidden="true"></div>
        <div class="welcome-grid" aria-hidden="true"></div>
        <div class="welcome-horizon" aria-hidden="true"></div>
        <div class="welcome-scanlines" aria-hidden="true"></div>
        ${renderWelcomeStickers()}

        <div class="welcome-card welcome-card--v2">
          <div class="welcome-card__glow" aria-hidden="true"></div>
          <div class="welcome-card__orbit" aria-hidden="true"></div>
          <div class="welcome-card__ring" aria-hidden="true"></div>

          <header class="welcome-card__hero">
            <div class="brand-mark" aria-hidden="true">B</div>
            <div class="welcome-card__titles">
              <span class="eyebrow welcome-eyebrow">Bowser · Secure portal</span>
              <h1>Learn. Launch. Level up.</h1>
              <p class="welcome-lede">A bright home for classes, schedules, and homework — protected with 2-step sign-in.</p>
            </div>
          </header>

          <ul class="welcome-features" aria-hidden="true">
            <li><span>📅</span> Schedules</li>
            <li><span>🚀</span> Join class</li>
            <li><span>📸</span> Homework</li>
            <li><span>🔒</span> 2FA login</li>
          </ul>

          <div class="welcome-card__divider" aria-hidden="true">
            <span></span>
          </div>

          <div class="welcome-card__auth">
            ${is2fa ? "" : `
              <div class="auth-switch">
                <button class="btn ${state.authMode === "login" ? "primary" : "secondary"}" type="button" data-action="set-auth-mode" data-mode="login">Login</button>
                <button class="btn ${state.authMode === "register" ? "primary" : "secondary"}" type="button" data-action="set-auth-mode" data-mode="register">Sign up</button>
              </div>
            `}
            <h2 class="panel-title">
              ${is2fa
                ? "Verify it’s you"
                : state.authMode === "register"
                  ? "Create account"
                  : "Welcome back"}
            </h2>
            <p class="panel-subtitle">
              ${is2fa
                ? "Enter the 6-digit code to finish signing in."
                : state.authMode === "register"
                  ? "New accounts need admin approval before login."
                  : "Email + password, then a one-time code."}
            </p>
            ${is2fa
              ? renderTwoFactorForm()
              : state.authMode === "register"
                ? renderRegisterForm()
                : renderLoginForm()}
            ${renderMessage()}
          </div>
        </div>
      </section>
    `;
  }

  function stopWelcomeParticles() {
    if (welcomeParticleFrame) {
      window.cancelAnimationFrame(welcomeParticleFrame);
      welcomeParticleFrame = 0;
    }
    if (typeof welcomeParticleCleanup === "function") {
      welcomeParticleCleanup();
      welcomeParticleCleanup = null;
    }
  }

  function startWelcomeParticles() {
    stopWelcomeParticles();

    const canvas = document.getElementById("welcome-particles");
    if (!canvas || !canvas.getContext) {
      return;
    }

    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    let running = true;

    function particleCount() {
      const area = width * height;
      return Math.max(48, Math.min(140, Math.floor(area / 14000)));
    }

    function createParticle() {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 0.6 + Math.random() * 1.8,
        a: 0.25 + Math.random() * 0.55,
        hue: Math.random() < 0.55 ? 210 + Math.random() * 40 : 270 + Math.random() * 35
      };
    }

    function resize() {
      const stage = canvas.parentElement;
      const bounds = stage ? stage.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = reduceMotion ? Math.min(36, particleCount()) : particleCount();
      particles = Array.from({ length: target }, createParticle);
    }

    function step() {
      if (!running) {
        return;
      }

      ctx.clearRect(0, 0, width, height);

      // Soft space dust veil
      ctx.fillStyle = "rgba(120, 160, 255, 0.015)";
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];

        // Brownian kick: random force each frame, damped velocity
        if (!reduceMotion) {
          p.vx += (Math.random() - 0.5) * 0.12;
          p.vy += (Math.random() - 0.5) * 0.12;
          p.vx *= 0.96;
          p.vy *= 0.96;
          // Soft speed cap
          const speed = Math.hypot(p.vx, p.vy);
          if (speed > 1.4) {
            p.vx = (p.vx / speed) * 1.4;
            p.vy = (p.vy / speed) * 1.4;
          }
          p.x += p.vx;
          p.y += p.vy;
        }

        // Wrap edges for continuous field
        if (p.x < -4) p.x = width + 4;
        if (p.x > width + 4) p.x = -4;
        if (p.y < -4) p.y = height + 4;
        if (p.y > height + 4) p.y = -4;

        // Faint links between nearby particles
        for (let j = i + 1; j < particles.length; j += 1) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 88) {
            const alpha = (1 - dist / 88) * 0.12;
            ctx.strokeStyle = `rgba(160, 190, 255, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }

        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2);
        gradient.addColorStop(0, `hsla(${p.hue}, 90%, 78%, ${p.a})`);
        gradient.addColorStop(1, `hsla(${p.hue}, 90%, 70%, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `hsla(${p.hue}, 95%, 88%, ${Math.min(1, p.a + 0.2)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      welcomeParticleFrame = window.requestAnimationFrame(step);
    }

    resize();
    if (reduceMotion) {
      // One static frame for reduced-motion users
      step();
      window.cancelAnimationFrame(welcomeParticleFrame);
      welcomeParticleFrame = 0;
    } else {
      welcomeParticleFrame = window.requestAnimationFrame(step);
    }

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    welcomeParticleCleanup = () => {
      running = false;
      window.removeEventListener("resize", onResize);
    };
  }

  function renderLoginForm() {
    return `
      <form class="form-grid" data-form="login" autocomplete="on">
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" name="email" type="email" placeholder="you@example.com" required autocomplete="username">
        </div>
        <div class="field">
          <label for="login-password">Password</label>
          <input id="login-password" name="password" type="password" placeholder="Your password" required autocomplete="current-password">
        </div>
        <button class="btn primary" type="submit">Continue</button>
        <p class="field-hint">Next step: 6-digit verification code (2FA).</p>
      </form>
    `;
  }

  function renderTwoFactorForm() {
    const pending = state.pending2fa || {};
    const hasCode = Boolean(pending.devCode);
    const viaSms = pending.delivery === "sms";
    const phoneHint = pending.maskedPhone
      ? `We texted a code to <strong>${escapeHtml(pending.maskedPhone)}</strong>.`
      : "We texted a code to your mobile number.";
    const codeBox = hasCode
      ? `
        <div class="welcome-otp-panel" role="status">
          <span class="welcome-otp-panel__label">Your login code</span>
          <strong class="welcome-otp-panel__code">${escapeHtml(pending.devCode)}</strong>
          <span class="welcome-otp-panel__hint">SMS is not configured yet — use this on-screen code (also in the server terminal).</span>
          <button class="btn secondary" type="button" data-action="copy-otp" data-code="${escapeAttribute(pending.devCode)}">Copy code</button>
        </div>
      `
      : `
        <div class="field-hint welcome-otp-hint">
          ${viaSms ? phoneHint : "Check your phone for a 6-digit SMS code."}
          If it does not arrive, click Resend.
        </div>
      `;
    return `
      <form class="form-grid" data-form="verify-2fa" autocomplete="one-time-code">
        ${codeBox}
        <div class="field">
          <label for="otp-code">Enter 6-digit code</label>
          <input id="otp-code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="123456" required autocomplete="one-time-code" value="${escapeAttribute(hasCode ? pending.devCode : "")}">
        </div>
        <div class="form-actions">
          <button class="btn primary" type="submit">Verify & enter</button>
          <button class="btn secondary" type="button" data-action="resend-2fa">Resend SMS</button>
          <button class="btn ghost" type="button" data-action="cancel-2fa">Back</button>
        </div>
      </form>
    `;
  }

  function renderRegisterForm() {
    const isTeacher = state.registerRole === "teacher";
    return `
      <form class="form-grid" data-form="register" autocomplete="on">
        <div class="field">
          <label for="register-role">I am a</label>
          <select id="register-role" name="role" data-register-role>
            <option value="teacher"${isTeacher ? " selected" : ""}>Teacher</option>
            <option value="student"${!isTeacher ? " selected" : ""}>Kid / Student</option>
          </select>
        </div>
        <div class="field">
          <label for="register-name">${isTeacher ? "Name" : "Kid's name"}</label>
          <input id="register-name" name="name" type="text" maxlength="80" placeholder="${isTeacher ? "Your name" : "Student name"}" required>
        </div>
        <div class="field" data-register-subject-field ${isTeacher ? "" : "hidden"}>
          <label for="register-subject">Subject</label>
          <input id="register-subject" name="subject" type="text" maxlength="80" placeholder="e.g. Maths">
        </div>
        <div class="field">
          <label for="register-email">Email</label>
          <input id="register-email" name="email" type="email" maxlength="254" placeholder="email@example.com" required autocomplete="email">
        </div>
        <div class="field">
          <label for="register-phone">Mobile number (SMS codes)</label>
          <input id="register-phone" name="phone" type="tel" maxlength="20" placeholder="e.g. +919876543210" required autocomplete="tel">
          <div class="field-hint">Used to text your 6-digit login code. Include country code.</div>
        </div>
        <div class="field">
          <label for="register-password">Password</label>
          <input id="register-password" name="password" type="password" minlength="8" maxlength="128" placeholder="At least 8 characters" required autocomplete="new-password">
          <div class="field-hint">Use at least 8 characters.</div>
        </div>
        <button class="btn primary" type="submit">Create account</button>
      </form>
    `;
  }

  function renderTeacherDashboard() {
    const teacherClasses = [...state.classes].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    const upcomingTeacherClasses = teacherClasses.filter(isCurrentOrUpcomingClass);
    // Newest first when looking backwards — the last class taught is the one a
    // teacher usually wants.
    const pastTeacherClasses = teacherClasses
      .filter((classItem) => !isCurrentOrUpcomingClass(classItem))
      .reverse();
    const listedClasses = getListedTeacherClasses(teacherClasses, upcomingTeacherClasses, pastTeacherClasses);
    const teacherSubmissions = [...state.submissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    const reviewedCount = teacherSubmissions.filter((submission) => submission.score).length;
    const calendarClasses = getFilteredCalendarClasses(teacherClasses);
    const visibleCalendarClasses = getCalendarWindowClasses(calendarClasses);
    const selectedKid = getSelectedCalendarStudent();
    const selectedClass = teacherClasses.find((classItem) => classItem.id === state.selectedClassId) || null;
    const editingClass = state.isEditingClass ? selectedClass : null;
    const formMeetingMode = editingClass
      ? getEditableMeetingOption(editingClass)
      : getDefaultMeetingOption();
    const formManualLink = editingClass && isManualMeetingOption(formMeetingMode)
      ? (editingClass.meetingLink || editingClass.zoomLink || "")
      : "";
    const formStudentId = editingClass ? getPrimaryStudentId(editingClass) : "";
    const formButtonLabel = editingClass
      ? "Save changes"
      : state.scheduleMode === "series"
        ? "Schedule series"
        : "Schedule class";
    const formTitle = editingClass ? "Edit class" : "Schedule class";
    const formIntro = editingClass
      ? "Update this class only. Series patterns apply when creating new classes."
      : "Pick a kid, time, and optional link — or schedule a whole month in one go.";

    return `
      <section class="surface">
        <div class="dashboard-header">
          <div>
            <span class="eyebrow">${escapeHtml(state.user.subject || "Teacher")}</span>
            <h2 class="panel-title">Hi, ${escapeHtml(state.user.name)}</h2>
            <p class="panel-subtitle">${getClassProgress(teacherClasses).conducted.length}/${teacherClasses.length} classes done · ${state.students.length} kids · ${reviewedCount} homework reviewed</p>
          </div>
          <div class="dashboard-actions">
            <button class="btn ghost" type="button" data-action="logout">Logout</button>
          </div>
        </div>
        ${renderDashboardTabs()}
        ${state.dashboardTab === "meetings" ? `
          <section class="card calendar-card">
            <div class="calendar-header">
              <div>
                <h3>Calendar</h3>
                <p class="panel-subtitle">${selectedKid ? `Showing ${escapeHtml(selectedKid.name)}` : "All kids"} · ${visibleCalendarClasses.length} in view</p>
              </div>
            </div>
            ${renderCalendarControls({
              title: state.calendarView === "month" ? formatMonthLabel(getCalendarCursorDate()) : formatWeekRange(getCalendarCursorDate()),
              showKidFilter: true
            })}
            ${renderCalendarGrid(calendarClasses)}
          </section>

          <div class="dashboard-columns">
            ${selectedClass && !state.isEditingClass
              ? renderTeacherClassDetailsPanel(selectedClass)
              : renderTeacherClassFormPanel({
                  editingClass,
                  formMeetingMode,
                  formManualLink,
                  formStudentId,
                  formButtonLabel,
                  formTitle,
                  formIntro
                })}

            <section class="card">
              <div class="section-heading">
                <div>
                  <h3>Classes</h3>
                  <p class="panel-subtitle">${escapeHtml(listedClasses.subtitle)}</p>
                </div>
              </div>
              <div class="segmented" role="group" aria-label="Which classes to show">
                <button class="segmented__btn ${state.classListFilter === "upcoming" ? "is-active" : ""}" type="button" data-action="set-class-filter" data-filter="upcoming">Upcoming (${upcomingTeacherClasses.length})</button>
                <button class="segmented__btn ${state.classListFilter === "past" ? "is-active" : ""}" type="button" data-action="set-class-filter" data-filter="past">Past (${pastTeacherClasses.length})</button>
                <button class="segmented__btn ${state.classListFilter === "all" ? "is-active" : ""}" type="button" data-action="set-class-filter" data-filter="all">All (${teacherClasses.length})</button>
              </div>
              <div class="section-stack">
                ${listedClasses.items.length
                  ? listedClasses.items.slice(0, 20).map(renderTeacherClassCard).join("")
                  : renderEmptyState(listedClasses.emptyTitle, listedClasses.emptyHint)}
              </div>
              ${listedClasses.items.length > 20 ? `<p class="field-hint">Showing the first 20 of ${listedClasses.items.length}. Use the calendar to reach the rest.</p>` : ""}
            </section>
          </div>
        ` : state.dashboardTab === "coach" ? `
          ${renderTeacherCoachPanel()}
        ` : state.dashboardTab === "progress" ? `
          ${renderClassProgressPanel()}
        ` : `
          ${renderTeacherHomeworkWorkspace(teacherSubmissions, reviewedCount)}
        `}
        ${renderMessage()}
      </section>
    `;
  }

  function renderTeacherHomeworkWorkspace(teacherSubmissions, reviewedCount) {
    const assignments = state.assignments || [];
    const assignmentSubs = state.assignmentSubmissions || [];
    const openAssign = assignments.length;
    const waitingAssign = assignmentSubs.filter((entry) => !entry.score).length;
    return `
      <div class="dashboard-columns" style="grid-template-columns: 1fr 1fr;">
        <section class="card">
          <div class="section-heading">
            <div>
              <h3>Assign activity</h3>
              <p class="panel-subtitle">Write a homework note/activity for one or more kids</p>
            </div>
          </div>
          <form class="form-grid" data-form="create-assignment">
            <div class="field">
              <label for="assign-student">Kid</label>
              <select id="assign-student" name="studentIds" ${getSchedulableStudents().length ? "required" : "disabled"}>
                <option value="">${getSchedulableStudents().length ? "Select kid" : "No active kids yet"}</option>
                ${getSchedulableStudents().map((student) => `<option value="${escapeAttribute(student.id)}">${escapeHtml(student.name)}</option>`).join("")}
              </select>
              ${renderPendingKidsHint()}
            </div>
            <div class="field">
              <label for="assign-title">Title</label>
              <input id="assign-title" name="title" type="text" maxlength="160" placeholder="e.g. Fractions practice" required value="${escapeAttribute(state.aiDraft && state.aiDraft.title || "")}">
            </div>
            <div class="form-grid two">
              <div class="field">
                <label for="assign-type">Type</label>
                <select id="assign-type" name="activityType">
                  <option value="practice">Practice</option>
                  <option value="quiz">Quiz / questions</option>
                  <option value="project">Project / activity</option>
                  <option value="revision">Revision notes</option>
                </select>
              </div>
              <div class="field">
                <label for="assign-due">Due (optional)</label>
                <input id="assign-due" name="dueAt" type="datetime-local">
              </div>
            </div>
            <div class="field">
              <label for="assign-instructions">Instructions / activity note</label>
              <textarea id="assign-instructions" name="instructions" maxlength="2000" placeholder="What should the student do?" required>${escapeHtml(state.aiDraft && (state.aiDraft.instructions || state.aiDraft.kidFriendlyPrompt || "") || "")}</textarea>
            </div>
            <div class="field">
              <label for="assign-questions">Questions (one per line, optional)</label>
              <textarea id="assign-questions" name="questionsText" maxlength="4000" placeholder="1. ...\n2. ...">${escapeHtml(formatAiQuestionsText(state.aiDraft))}</textarea>
            </div>
            <div class="field">
              <label for="assign-revision">Revision notes for kid (optional)</label>
              <textarea id="assign-revision" name="revisionNotes" maxlength="2000" placeholder="Key points to remember...">${escapeHtml(formatAiRevisionText(state.aiDraft))}</textarea>
            </div>
            <div class="form-actions">
              <button class="btn primary" type="submit">Send to student</button>
              <button class="btn secondary" type="button" data-action="ai-fill-homework">AI: draft homework</button>
            </div>
          </form>
        </section>

        <section class="card">
          <div class="section-heading">
            <div>
              <h3>Assigned (${openAssign})</h3>
              <p class="panel-subtitle">${waitingAssign} activity answers waiting for review</p>
            </div>
          </div>
          <div class="section-stack">
            ${assignments.length
              ? assignments.map(renderTeacherAssignmentCard).join("")
              : renderEmptyState("No activities yet", "Create a homework note or generate one with AI.")}
          </div>
        </section>
      </div>

      <section class="card" style="margin-top:16px;">
        <div class="section-heading">
          <div>
            <h3>Activity answers</h3>
            <p class="panel-subtitle">Text solutions under each homework activity</p>
          </div>
        </div>
        <div class="section-stack">
          ${assignmentSubs.length
            ? assignmentSubs.map(renderTeacherAssignmentSubmissionCard).join("")
            : renderEmptyState("No activity answers yet", "When students solve homework, they appear here.")}
        </div>
      </section>

      <section class="card" style="margin-top:16px;">
        <div class="section-heading">
          <div>
            <h3>Photo homework</h3>
            <p class="panel-subtitle">${teacherSubmissions.length - reviewedCount} waiting · ${reviewedCount} reviewed</p>
          </div>
        </div>
        <div class="section-stack">
          ${teacherSubmissions.length ? teacherSubmissions.map(renderTeacherSubmissionCard).join("") : renderEmptyState("No photo uploads yet", "Class photo homework still works as before.")}
        </div>
      </section>
    `;
  }

  function renderTeacherCoachPanel() {
    const insightStudentId = state.insightStudentId || (state.students[0] && state.students[0].id) || "";
    const draft = state.aiDraft || null;
    return `
      <div class="dashboard-columns" style="grid-template-columns: 1fr 1fr;">
        <section class="card">
          <div class="section-heading">
            <div>
              <h3>AI teaching coach</h3>
              <p class="panel-subtitle">Lesson plans, revision notes, activities, and kid insights. Works offline with templates; add AI_API_KEY for live models.</p>
            </div>
          </div>
          <form class="form-grid" data-form="ai-coach">
            <div class="field">
              <label for="ai-task">What do you need?</label>
              <select id="ai-task" name="task">
                <option value="lesson-plan">Lesson plan</option>
                <option value="homework">Homework questions</option>
                <option value="activity">Hands-on activity</option>
                <option value="revision-notes">Revision notes for kids</option>
                <option value="student-insight">Gauge kid learning + suggestions</option>
              </select>
            </div>
            <div class="form-grid two">
              <div class="field">
                <label for="ai-topic">Topic</label>
                <input id="ai-topic" name="topic" type="text" placeholder="e.g. Fractions" required>
              </div>
              <div class="field">
                <label for="ai-subject">Subject</label>
                <input id="ai-subject" name="subject" type="text" value="${escapeAttribute(state.user.subject || "")}" placeholder="Maths">
              </div>
            </div>
            <div class="field">
              <label for="ai-notes">What was taught / class notes</label>
              <textarea id="ai-notes" name="notes" placeholder="Bullet what you covered today..."></textarea>
            </div>
            <div class="field">
              <label for="ai-student">Student (for insight only)</label>
              <select id="ai-student" name="studentId">
                <option value="">Select student</option>
                ${state.students.map((student) => `
                  <option value="${escapeAttribute(student.id)}"${insightStudentId === student.id ? " selected" : ""}>${escapeHtml(student.name)}</option>
                `).join("")}
              </select>
            </div>
            <div class="form-actions">
              <button class="btn primary" type="submit" ${state.aiBusy ? "disabled" : ""}>${state.aiBusy ? "Thinking..." : "Generate with AI"}</button>
            </div>
            <p class="field-hint">Provider: ${escapeHtml(state.aiStatus && state.aiStatus.apiConfigured ? "API key ready" : "offline templates (or local Ollama if running)")}</p>
          </form>
        </section>

        <section class="card">
          <div class="section-heading">
            <div>
              <h3>Coach output</h3>
              <p class="panel-subtitle">Copy into an assignment or use as planning notes</p>
            </div>
          </div>
          ${draft ? renderAiDraftCard(draft) : renderEmptyState("No AI output yet", "Generate a lesson plan, homework set, activity, or student insight.")}
        </section>
      </div>
    `;
  }

  function renderAiDraftCard(draft) {
    const pretty = escapeHtml(JSON.stringify(draft, null, 2));
    return `
      <article class="card card--soft">
        <pre class="ai-draft-pre">${pretty}</pre>
        <div class="form-actions">
          <button class="btn secondary" type="button" data-action="ai-use-as-homework">Use as homework draft</button>
          <button class="btn ghost" type="button" data-action="ai-clear-draft">Clear</button>
        </div>
      </article>
    `;
  }

  function renderTeacherAssignmentCard(assignment) {
    const subs = (state.assignmentSubmissions || []).filter((entry) => entry.assignmentId === assignment.id);
    return `
      <article class="card card--soft">
        <div class="card__top">
          <div>
            <h3>${escapeHtml(assignment.title)}</h3>
            <p class="panel-subtitle">${escapeHtml(assignment.activityType || "practice")} · ${escapeHtml(formatStudentNames(assignment.studentNames))}</p>
          </div>
          <span class="status-pill">${subs.length} answer${subs.length === 1 ? "" : "s"}</span>
        </div>
        <p class="class-details">${escapeHtml(assignment.instructions || "")}</p>
        ${Array.isArray(assignment.questions) && assignment.questions.length ? `
          <ol class="assign-q-list">
            ${assignment.questions.map((question) => `<li>${escapeHtml(question.prompt)}</li>`).join("")}
          </ol>
        ` : ""}
        ${assignment.dueAt ? `<p class="panel-subtitle">Due ${escapeHtml(formatDate(assignment.dueAt))}</p>` : ""}
      </article>
    `;
  }

  function renderTeacherAssignmentSubmissionCard(submission) {
    const assignment = (state.assignments || []).find((entry) => entry.id === submission.assignmentId);
    return `
      <article class="submission-card">
        <div class="submission-top">
          <div>
            <h3>${escapeHtml(submission.studentName)}</h3>
            <p>${assignment ? escapeHtml(assignment.title) : "Activity"}</p>
          </div>
          <span class="status-pill ${submission.score ? "" : "pending"}">${submission.score ? escapeHtml(submission.score) : "Needs review"}</span>
        </div>
        ${submission.textResponse ? `<p class="class-details">${escapeHtml(submission.textResponse)}</p>` : ""}
        ${Array.isArray(submission.answers) && submission.answers.length ? `
          <div class="section-stack">
            ${submission.answers.map((answer, index) => `
              <div class="card card--soft">
                <strong>Q${index + 1}</strong>
                <p>${escapeHtml(answer.text || "")}</p>
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${submission.imageUrl ? `<img class="homework-preview" src="${escapeAttribute(submission.imageUrl)}" alt="Homework image">` : ""}
        <form class="form-grid" data-form="grade-assignment" data-submission-id="${escapeAttribute(submission.id)}">
          <div class="form-grid two">
            <div class="field">
              <label>Score</label>
              <input name="score" type="text" value="${escapeAttribute(submission.score || "")}" placeholder="e.g. 8/10">
            </div>
            <div class="field">
              <label>Feedback</label>
              <input name="feedback" type="text" value="${escapeAttribute(submission.feedback || "")}" placeholder="Encouraging note">
            </div>
          </div>
          <button class="btn primary" type="submit">Save feedback</button>
        </form>
      </article>
    `;
  }

  function renderStudentDashboard() {
    const theme = getKidTheme();
    const classes = [...state.classes].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    const upcomingClasses = classes.filter(isCurrentOrUpcomingClass);
    const pastClasses = classes.filter((classItem) => !isCurrentOrUpcomingClass(classItem)).reverse();
    const submissions = [...state.submissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    const calendarClasses = getFilteredCalendarClasses(classes);
    const nextClass = upcomingClasses[0] || null;
    const assignmentSubs = state.assignmentSubmissions || [];
    const assignments = state.assignments || [];
    const stars = submissions.filter((submission) => submission.score).length
      + assignmentSubs.filter((submission) => submission.score).length;
    const todoHomework = assignments.filter((assignment) =>
      !assignmentSubs.some((submission) => submission.assignmentId === assignment.id)
    ).length
      + classes.filter((classItem) => !submissions.some((s) => s.classId === classItem.id)).length;
    const greeting = theme.greetings[Math.abs(String(state.user.name || "a").charCodeAt(0)) % theme.greetings.length];

    return `
      <section class="surface kid-shell kid-shell--${escapeAttribute(theme.id)}">
        <div class="kid-shell__glow" aria-hidden="true"></div>
        <div class="kid-shell__pattern" aria-hidden="true"></div>
        <div class="kid-theme-symbols" aria-hidden="true">
          ${theme.symbols.map((symbol, index) => `
            <span class="kid-theme-symbol kid-theme-symbol--${index + 1}">${symbol}</span>
          `).join("")}
        </div>

        <div class="dashboard-header kid-header">
          <div>
            <span class="eyebrow kid-eyebrow">${escapeHtml(greeting)} ${theme.emoji}</span>
            <h2 class="panel-title kid-title">${escapeHtml(state.user.name)}</h2>
            <p class="panel-subtitle kid-sub">${escapeHtml(theme.tagline)}</p>
          </div>
          <div class="dashboard-actions kid-badges">
            <span class="kid-badge-stat kid-badge-stat--blue"><span>${theme.classes}</span><strong>${getClassProgress(classes).conducted.length}/${classes.length}</strong><em>done</em></span>
            <span class="kid-badge-stat kid-badge-stat--gold"><span>${theme.stars}</span><strong>${stars}</strong><em>stars</em></span>
            <span class="kid-badge-stat kid-badge-stat--pink"><span>${theme.todo}</span><strong>${todoHomework}</strong><em>to-do</em></span>
            <button class="btn ghost kid-logout" type="button" data-action="logout">Bye 👋</button>
          </div>
        </div>

        ${renderKidThemePicker(theme)}
        ${renderDashboardTabs({ kid: true, theme })}

        ${state.dashboardTab === "meetings" ? `
          ${nextClass ? `
            <section class="card kid-hero-card">
              <div class="kid-hero">
                <div class="kid-hero__icon" aria-hidden="true">${theme.hero}</div>
                <div class="kid-hero__copy">
                  <span class="kid-label">Up next — let’s go!</span>
                  <h3>${escapeHtml(getClassTitle(nextClass))}</h3>
                  <p>🗓️ ${escapeHtml(formatDate(nextClass.dateTime))}</p>
                  <p class="kid-meta">👩‍🏫 ${escapeHtml(nextClass.teacherName || "Your teacher")}</p>
                </div>
                <div class="kid-hero-actions">
                  ${renderExternalAction(
                    getClassMeetingLink(nextClass),
                    "primary kid-join",
                    theme.join,
                    "Link soon ⏳"
                  )}
                </div>
              </div>
            </section>
          ` : `
            <section class="card kid-empty-card">
              <div class="kid-empty">
                <span class="kid-empty__emoji" aria-hidden="true">${theme.empty}</span>
                <h3>No class on the map yet</h3>
                <p>When your teacher adds one, it pops up here with a big Join button!</p>
              </div>
            </section>
          `}

          <section class="card calendar-card kid-calendar">
            <div class="calendar-header">
              <div>
                <h3 class="kid-section-title">${theme.calendar} ${escapeHtml(theme.calendarTitle)}</h3>
                <p class="panel-subtitle kid-sub">Find class days at a glance</p>
              </div>
            </div>
            ${renderCalendarControls({
              title: state.calendarView === "month" ? formatMonthLabel(getCalendarCursorDate()) : formatWeekRange(getCalendarCursorDate()),
              showKidFilter: false
            })}
            ${renderCalendarGrid(calendarClasses)}
          </section>

          <section class="card kid-card kid-card--list">
            <h3 class="kid-section-title">${theme.upcoming} ${escapeHtml(theme.listTitle)}</h3>
            <div class="section-stack kid-class-list">
              ${upcomingClasses.length
                ? upcomingClasses.map(renderStudentClassCard).join("")
                : `
                  <div class="kid-empty kid-empty--soft">
                    <span class="kid-empty__emoji" aria-hidden="true">${theme.free}</span>
                    <h3>Free play time!</h3>
                    <p>Nothing scheduled — read, draw, or rest.</p>
                  </div>
                `}
            </div>
          </section>

          ${pastClasses.length ? `
            <section class="card kid-card kid-card--list">
              <h3 class="kid-section-title">✅ Classes you finished</h3>
              <p class="panel-subtitle kid-sub">Your last ${pastClasses.length === 1 ? "class" : `${Math.min(pastClasses.length, 6)} classes`}</p>
              <div class="section-stack kid-class-list">
                ${pastClasses.slice(0, 6).map(renderStudentPastClassCard).join("")}
              </div>
            </section>
          ` : ""}
        ` : state.dashboardTab === "progress" ? `
          ${renderClassProgressPanel({ kid: true, theme })}
        ` : `
          <div class="kid-mission">
            <div class="kid-mission__icon" aria-hidden="true">${theme.mission}</div>
            <div>
              <strong>${escapeHtml(theme.missionTitle)}</strong>
              <p>Do teacher activities with writing, solving, or a photo.</p>
            </div>
          </div>

          <section class="card kid-card kid-card--send" style="margin-bottom:16px;">
            <h3 class="kid-section-title">📝 Activities for me</h3>
            <p class="panel-subtitle kid-sub">Read the note, solve, and submit</p>
            <div class="section-stack">
              ${assignments.length
                ? assignments.map(renderStudentAssignmentCard).join("")
                : `
                  <div class="kid-empty kid-empty--soft">
                    <span class="kid-empty__emoji" aria-hidden="true">${theme.bag}</span>
                    <h3>No activities yet</h3>
                    <p>When your teacher assigns homework, it shows here.</p>
                  </div>
                `}
            </div>
          </section>

          <div class="dashboard-columns kid-hw-columns">
            <section class="card kid-card kid-card--send">
              <h3 class="kid-section-title">${theme.send} Class photos</h3>
              <p class="panel-subtitle kid-sub">Optional photo homework for classes</p>
              <div class="section-stack">
                ${classes.length
                  ? classes.map(renderStudentHomeworkCard).join("")
                  : `
                    <div class="kid-empty kid-empty--soft">
                      <span class="kid-empty__emoji" aria-hidden="true">📷</span>
                      <h3>No class photos needed</h3>
                      <p>Photo upload appears when classes exist.</p>
                    </div>
                  `}
              </div>
            </section>

            <section class="card kid-card kid-card--stars">
              <h3 class="kid-section-title">${theme.trophy} ${escapeHtml(theme.trophyTitle)}</h3>
              <p class="panel-subtitle kid-sub">Scores & teacher cheers</p>
              <div class="section-stack">
                ${[...assignmentSubs.map(renderStudentAssignmentResultCard), ...submissions.map(renderStudentSubmissionCard)].length
                  ? `${assignmentSubs.map(renderStudentAssignmentResultCard).join("")}${submissions.map(renderStudentSubmissionCard).join("")}`
                  : `
                    <div class="kid-empty kid-empty--soft">
                      <span class="kid-empty__emoji" aria-hidden="true">${theme.trophyEmpty}</span>
                      <h3>Shelf is empty</h3>
                      <p>Submit activities to earn feedback!</p>
                    </div>
                  `}
              </div>
            </section>
          </div>
        `}
        ${renderMessage()}
      </section>
    `;
  }

  function renderStudentAssignmentCard(assignment) {
    const existing = (state.assignmentSubmissions || []).find((entry) => entry.assignmentId === assignment.id);
    const questions = Array.isArray(assignment.questions) ? assignment.questions : [];
    return `
      <article class="card card--soft kid-hw-card">
        <div class="card__top">
          <div>
            <h3>${escapeHtml(assignment.title)}</h3>
            <p class="panel-subtitle kid-sub">${escapeHtml(assignment.teacherName || "Teacher")} · ${escapeHtml(assignment.activityType || "practice")}</p>
          </div>
          <span class="status-pill ${existing ? "" : "pending"}">${existing ? "✅ Sent" : "📝 To do"}</span>
        </div>
        <p class="class-details">${escapeHtml(assignment.instructions || "")}</p>
        ${assignment.revisionNotes ? `
          <div class="feedback-note">
            <strong>📚 Revise</strong>
            <p>${escapeHtml(assignment.revisionNotes)}</p>
          </div>
        ` : ""}
        <form class="form-grid" data-form="submit-assignment" data-assignment-id="${escapeAttribute(assignment.id)}">
          ${questions.map((question, index) => `
            <div class="field">
              <label for="ans-${escapeAttribute(assignment.id)}-${index}">${escapeHtml(question.prompt)}</label>
              <textarea id="ans-${escapeAttribute(assignment.id)}-${index}" name="answer-${escapeAttribute(question.id)}" maxlength="1000" placeholder="${escapeAttribute(question.hint || "Write your answer")}">${escapeHtml(existing && Array.isArray(existing.answers) ? ((existing.answers.find((a) => a.questionId === question.id) || {}).text || "") : "")}</textarea>
            </div>
          `).join("")}
          <div class="field">
            <label for="text-${escapeAttribute(assignment.id)}">Your work / notes</label>
            <textarea id="text-${escapeAttribute(assignment.id)}" name="textResponse" maxlength="2000" placeholder="Explain what you did...">${escapeHtml(existing ? existing.textResponse || "" : "")}</textarea>
          </div>
          <div class="field">
            <label for="photo-${escapeAttribute(assignment.id)}">Photo (optional)</label>
            <input id="photo-${escapeAttribute(assignment.id)}" name="homework" type="file" accept="image/*" capture="environment">
          </div>
          <button class="btn primary kid-join" type="submit">${existing ? "Update work" : "Submit activity"}</button>
        </form>
      </article>
    `;
  }

  function renderStudentAssignmentResultCard(submission) {
    const assignment = (state.assignments || []).find((entry) => entry.id === submission.assignmentId);
    return `
      <article class="submission-card kid-result-card">
        <div class="submission-top">
          <div>
            <h3>${assignment ? escapeHtml(assignment.title) : "Activity"}</h3>
            <p class="kid-sub">Sent ${escapeHtml(formatDate(submission.submittedAt))}</p>
          </div>
          <span class="status-pill ${submission.score ? "" : "pending"}">${submission.score ? `⭐ ${escapeHtml(submission.score)}` : "⏳ Waiting"}</span>
        </div>
        ${submission.feedback ? `
          <div class="feedback-note">
            <strong>Teacher note</strong>
            <p>${escapeHtml(submission.feedback)}</p>
          </div>
        ` : ""}
      </article>
    `;
  }

  function renderKidThemePicker(activeTheme) {
    return `
      <div class="kid-theme-picker" role="group" aria-label="Choose theme">
        <div class="kid-theme-picker__label">
          <strong>Theme</strong>
          <span>Game (Mech) or Play (colorful)</span>
        </div>
        <div class="kid-theme-picker__row">
          ${Object.values(KID_THEMES).map((theme) => `
            <button
              class="kid-theme-chip kid-theme-chip--${escapeAttribute(theme.id)}${theme.id === activeTheme.id ? " is-active" : ""}"
              type="button"
              data-action="set-kid-theme"
              data-theme="${escapeAttribute(theme.id)}"
              aria-pressed="${theme.id === activeTheme.id ? "true" : "false"}"
              title="${escapeAttribute(theme.label)}"
            >
              <span class="kid-theme-chip__emoji" aria-hidden="true">${theme.emoji}</span>
              <span class="kid-theme-chip__name">${escapeHtml(theme.label)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderAdminDashboard() {
    const pendingUsers = state.managedUsers.filter((user) => user.activationStatus === "pending");
    const activeUsers = state.managedUsers.filter((user) => user.activationStatus === "active");
    const inactiveUsers = state.managedUsers.filter((user) => user.activationStatus === "inactive");

    return `
      <section class="surface">
        <div class="dashboard-header">
          <div>
            <span class="eyebrow">Admin Portal</span>
            <h2 class="panel-title">${escapeHtml(state.user.name)}</h2>
            <p class="panel-subtitle">Review new teacher and student accounts, then activate or deactivate access from one place.</p>
          </div>
          <div class="dashboard-actions">
            <span class="mini-stat">${pendingUsers.length} pending</span>
            <span class="mini-stat">${activeUsers.length} active</span>
            <span class="mini-stat">${inactiveUsers.length} inactive</span>
            <button class="btn ghost" type="button" data-action="logout">Logout</button>
          </div>
        </div>

        <div class="summary-strip">
          <article class="summary-card">
            <span>Pending Approval</span>
            <strong>${pendingUsers.length}</strong>
            <small>Waiting for admin activation</small>
          </article>
          <article class="summary-card">
            <span>Active Accounts</span>
            <strong>${activeUsers.length}</strong>
            <small>Can log in now</small>
          </article>
          <article class="summary-card">
            <span>Inactive Accounts</span>
            <strong>${inactiveUsers.length}</strong>
            <small>Access paused</small>
          </article>
        </div>

        <div class="dashboard-columns admin-columns">
          <section class="card">
            <h3>Pending Accounts</h3>
            <p>New teacher and student accounts stay here until you activate them.</p>
            <div class="section-stack">
              ${pendingUsers.length ? pendingUsers.map(renderAdminUserCard).join("") : renderEmptyState("No pending accounts", "New signups will appear here for approval.")}
            </div>
          </section>

          <section class="card">
            <h3>Active and Inactive Accounts</h3>
            <p>Deactivate access when needed, or reactivate an account later.</p>
            <div class="section-stack">
              ${[...activeUsers, ...inactiveUsers].length ? [...activeUsers, ...inactiveUsers].map(renderAdminUserCard).join("") : renderEmptyState("No managed accounts yet", "Teacher and student accounts will appear here after they sign up.")}
            </div>
          </section>
        </div>
        ${renderMessage()}
      </section>
    `;
  }

  function renderTeacherClassFormPanel({ editingClass, formMeetingMode, formManualLink, formStudentId, formButtonLabel, formTitle, formIntro }) {
    const manualLinkCopy = getManualLinkCopy(getMeetingOptionProvider(formMeetingMode));
    const schedulableStudents = getSchedulableStudents();
    const isSeries = !editingClass && state.scheduleMode === "series";
    const monthBounds = getDefaultSeriesMonthBounds();
    const weekdayOptions = [
      { value: "1", label: "Mon" },
      { value: "2", label: "Tue" },
      { value: "3", label: "Wed" },
      { value: "4", label: "Thu" },
      { value: "5", label: "Fri" },
      { value: "6", label: "Sat" },
      { value: "0", label: "Sun" }
    ];
    const defaultWeekdays = new Set(["1", "2", "3", "4", "5"]);

    return `
      <section class="card">
        <div class="section-heading">
          <div>
            <h3>${formTitle}</h3>
            <p class="panel-subtitle">${formIntro}</p>
          </div>
          ${editingClass ? '<button class="btn ghost" type="button" data-action="cancel-class-edit">Back</button>' : ""}
        </div>
        <form class="form-grid" data-form="schedule-class">
          <div class="field">
            <label for="studentIds">Kid</label>
            <select id="studentIds" name="studentIds" ${schedulableStudents.length ? "required" : "disabled"}>
              <option value="">${schedulableStudents.length ? "Select kid" : "No active kids yet"}</option>
              ${schedulableStudents.map((student) => `
                <option value="${escapeAttribute(student.id)}"${formStudentId === student.id ? " selected" : ""}>${escapeHtml(student.name)}</option>
              `).join("")}
            </select>
            ${schedulableStudents.length ? "" : '<p class="calendar-empty">Create and activate student accounts first.</p>'}
            ${renderPendingKidsHint()}
          </div>

          ${editingClass ? "" : `
            <div class="field">
              <label>When</label>
              <div class="segmented" role="group" aria-label="Schedule type">
                <button class="segmented__btn ${state.scheduleMode === "once" ? "is-active" : ""}" type="button" data-action="set-schedule-mode" data-mode="once">One class</button>
                <button class="segmented__btn ${state.scheduleMode === "series" ? "is-active" : ""}" type="button" data-action="set-schedule-mode" data-mode="series">Month series</button>
              </div>
            </div>
          `}

          ${isSeries ? `
            <div class="form-grid two">
              <div class="field">
                <label for="seriesStartDate">From</label>
                <input id="seriesStartDate" name="seriesStartDate" type="date" value="${escapeAttribute(monthBounds.start)}" required>
              </div>
              <div class="field">
                <label for="seriesEndDate">To</label>
                <input id="seriesEndDate" name="seriesEndDate" type="date" value="${escapeAttribute(monthBounds.end)}" required>
              </div>
            </div>
            <div class="field">
              <label for="seriesPattern">Pattern</label>
              <select id="seriesPattern" name="seriesPattern" data-series-pattern>
                <option value="weekdays"${state.seriesPattern === "weekdays" ? " selected" : ""}>Selected weekdays</option>
                <option value="alternate"${state.seriesPattern === "alternate" ? " selected" : ""}>Alternate days</option>
                <option value="daily"${state.seriesPattern === "daily" ? " selected" : ""}>Every day</option>
              </select>
              <div class="field-hint">Alternate days = every other day from the start date. Weekdays lets you pick Mon–Sun.</div>
            </div>
            <div class="field" data-weekday-field ${state.seriesPattern === "weekdays" ? "" : "hidden"}>
              <label>Days</label>
              <div class="weekday-grid">
                ${weekdayOptions.map((day) => `
                  <label class="check-chip check-chip--compact">
                    <input type="checkbox" name="seriesWeekdays" value="${day.value}"${defaultWeekdays.has(day.value) ? " checked" : ""}>
                    <span>${day.label}</span>
                  </label>
                `).join("")}
              </div>
              <div class="weekday-actions">
                <button class="btn ghost" type="button" data-action="set-weekdays" data-preset="weekdays">Mon–Fri</button>
                <button class="btn ghost" type="button" data-action="set-weekdays" data-preset="all">Every day</button>
                <button class="btn ghost" type="button" data-action="set-weekdays" data-preset="none">Clear</button>
              </div>
            </div>
            <div class="field">
              <label>Times each day</label>
              <div class="times-list" data-series-times>
                ${state.seriesTimes.map((time, index) => `
                  <div class="time-row">
                    <input name="seriesTimes" type="time" value="${escapeAttribute(time)}" required>
                    ${state.seriesTimes.length > 1
                      ? `<button class="btn ghost btn-icon" type="button" data-action="remove-series-time" data-index="${index}" aria-label="Remove time">×</button>`
                      : ""}
                  </div>
                `).join("")}
              </div>
              ${state.seriesTimes.length < 6
                ? '<button class="btn secondary" type="button" data-action="add-series-time">+ Add another time</button>'
                : ""}
              <div class="field-hint">Example: 10:00 and 16:00 for twice a day, or three times for three slots.</div>
            </div>
            <div class="field">
              <label for="durationMinutes">Duration</label>
              <select id="durationMinutes" name="durationMinutes">
                <option value="30">30 minutes</option>
                <option value="45" selected>45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </div>
          ` : `
            <div class="form-grid two">
              <div class="field">
                <label for="dateTime">Date & time</label>
                <input id="dateTime" name="dateTime" type="datetime-local" value="${escapeAttribute(editingClass ? formatDateTimeLocalInput(editingClass.dateTime) : "")}" required>
              </div>
              <div class="field">
                <label for="durationMinutes">Duration</label>
                <select id="durationMinutes" name="durationMinutes">
                  <option value="30"${editingClass && Number(editingClass.durationMinutes) === 30 ? " selected" : ""}>30 minutes</option>
                  <option value="45"${!editingClass || Number(editingClass.durationMinutes) === 45 ? " selected" : ""}>45 minutes</option>
                  <option value="60"${editingClass && Number(editingClass.durationMinutes) === 60 ? " selected" : ""}>60 minutes</option>
                  <option value="90"${editingClass && Number(editingClass.durationMinutes) === 90 ? " selected" : ""}>90 minutes</option>
                </select>
              </div>
            </div>
          `}

          <div class="field">
            <label for="scheduleMeetingMode">Class link</label>
            <select id="scheduleMeetingMode" name="meetingMode">
              ${getMeetingOptions().map((option) => `
                <option value="${escapeAttribute(option.value)}"${formMeetingMode === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>
              `).join("")}
            </select>
            <div class="field-hint">${escapeHtml(isSeries ? "One shared link is used for the whole series." : getMeetingModeHint())}</div>
          </div>
          <div class="field" data-manual-zoom-field ${isManualMeetingOption(formMeetingMode) ? "" : "hidden"}>
            <label for="manualMeetingLink" data-manual-link-label>${escapeHtml(manualLinkCopy.label)}</label>
            <input id="manualMeetingLink" name="manualMeetingLink" type="text" value="${escapeAttribute(formManualLink)}" placeholder="${escapeAttribute(manualLinkCopy.placeholder)}" data-manual-link-input>
            <div class="field-hint" data-manual-link-hint>${escapeHtml(manualLinkCopy.hint)}</div>
          </div>
          <details class="optional-block">
            <summary>Optional details</summary>
            <div class="form-grid optional-block__body">
              <div class="field">
                <label for="topic">Topic</label>
                <input id="topic" name="topic" type="text" maxlength="200" value="${escapeAttribute(editingClass ? (editingClass.topic || "") : "")}" placeholder="Optional title">
              </div>
              <div class="field">
                <label for="details">Notes</label>
                <textarea id="details" name="details" maxlength="2000" placeholder="Optional notes">${escapeHtml(editingClass ? (editingClass.details || "") : "")}</textarea>
              </div>
              <div class="field">
                <label for="driveLink">Drive link</label>
                <input id="driveLink" name="driveLink" type="url" value="${escapeAttribute(editingClass ? (editingClass.driveLink || "") : "")}" placeholder="https://drive.google.com/...">
              </div>
            </div>
          </details>
          <div class="form-actions">
            <button class="btn primary" type="submit">${formButtonLabel}</button>
            ${editingClass ? `<span class="field-hint">Editing: ${escapeHtml(getClassTitle(editingClass))}</span>` : ""}
          </div>
        </form>
      </section>
    `;
  }

  function renderTeacherClassDetailsPanel(classItem) {
    const meetingProvider = getClassMeetingProvider(classItem);
    const meetingLink = getClassMeetingLink(classItem);
    const driveLink = safeExternalUrl(classItem.driveLink);
    const seriesCount = classItem.seriesId
      ? state.classes.filter((entry) => entry.seriesId === classItem.seriesId).length
      : 1;

    return `
      <section class="card class-panel">
        <div class="section-heading">
          <div>
            <h3>${escapeHtml(getClassTitle(classItem))}</h3>
            <p class="panel-subtitle">${escapeHtml(formatDate(classItem.dateTime))}</p>
          </div>
          <div class="panel-actions">
            <button class="btn primary" type="button" data-action="start-class-edit">Edit</button>
            <button class="btn ghost" type="button" data-action="clear-class-selection">New</button>
          </div>
        </div>
        <div class="class-detail-block">
          ${renderKidBadges(classItem)}
          ${renderClassDetails(classItem.details)}
        </div>
        <div class="detail-list">
          <span><strong>Duration</strong> ${escapeHtml(String(classItem.durationMinutes || 45))} min</span>
          <span><strong>Link</strong> ${escapeHtml(getMeetingProviderLabel(meetingProvider))}</span>
          ${classItem.driveLink ? `<span><strong>Drive</strong> ready</span>` : ""}
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary", "Join", getMeetingUnavailableLabel(meetingProvider))}
          ${driveLink ? renderExternalAction(driveLink, "secondary", "Drive", "Drive unavailable") : ""}
          ${meetingLink ? `<button class="btn ghost" type="button" data-action="copy-link" data-link="${escapeAttribute(meetingLink)}">Copy link</button>` : ""}
        </div>
        <div class="class-actions class-actions--danger">
          <button class="btn danger" type="button" data-action="cancel-class" data-class-id="${escapeAttribute(classItem.id)}" data-scope="single">Cancel this class</button>
          ${seriesCount > 1
            ? `<button class="btn danger ghost-danger" type="button" data-action="cancel-class" data-class-id="${escapeAttribute(classItem.id)}" data-scope="series">Cancel whole series (${seriesCount})</button>`
            : ""}
        </div>
      </section>
    `;
  }

  function getListedTeacherClasses(allClasses, upcomingClasses, pastClasses) {
    if (state.classListFilter === "past") {
      return {
        items: pastClasses,
        subtitle: "Classes already finished, newest first",
        emptyTitle: "No past classes yet",
        emptyHint: "Finished classes move here automatically."
      };
    }

    if (state.classListFilter === "all") {
      return {
        items: [...allClasses].reverse(),
        subtitle: "Every class on the calendar, newest first",
        emptyTitle: "No classes yet",
        emptyHint: "Schedule a class or a monthly series to fill this list."
      };
    }

    return {
      items: upcomingClasses,
      subtitle: "Next classes at a glance",
      emptyTitle: "No upcoming classes",
      emptyHint: "Schedule a class or a monthly series to fill this list."
    };
  }

  function renderTeacherClassCard(classItem) {
    const meetingProvider = getClassMeetingProvider(classItem);
    const meetingLink = getClassMeetingLink(classItem);

    return `
      <article class="card card--compact${state.selectedClassId === classItem.id ? " is-selected" : ""}">
        <div class="card__top">
          <h3>${escapeHtml(getClassTitle(classItem))}</h3>
          <span class="status-pill">${escapeHtml(formatDate(classItem.dateTime))}</span>
        </div>
        ${renderKidBadges(classItem)}
        <div class="card__meta">
          <span>${escapeHtml(String(classItem.durationMinutes || 45))} min · ${escapeHtml(getMeetingProviderLabel(meetingProvider))}</span>
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary", "Join", getMeetingUnavailableLabel(meetingProvider))}
          <button class="btn ghost" type="button" data-action="edit-class" data-class-id="${escapeAttribute(classItem.id)}">Open</button>
        </div>
      </article>
    `;
  }

  function renderStudentPastClassCard(classItem) {
    const submission = state.submissions.find((entry) => entry.classId === classItem.id);
    return `
      <article class="card card--compact kid-past-card">
        <div class="card__top">
          <h3>${escapeHtml(getClassTitle(classItem))}</h3>
          <span class="status-pill">${escapeHtml(formatDate(classItem.dateTime))}</span>
        </div>
        <div class="card__meta">
          <span>👩‍🏫 ${escapeHtml(classItem.teacherName || "Your teacher")}${submission && submission.score ? ` · ⭐ ${escapeHtml(submission.score)}` : ""}</span>
        </div>
      </article>
    `;
  }

  function renderStudentClassCard(classItem) {
    const theme = getKidTheme();
    const existingSubmission = state.submissions.find((submission) => submission.classId === classItem.id);
    const meetingProvider = getClassMeetingProvider(classItem);
    const meetingLink = getClassMeetingLink(classItem);
    const driveLink = safeExternalUrl(classItem.driveLink);
    const icon = getKidClassIcon(classItem);
    return `
      <article class="card kid-class-card">
        <div class="card__top">
          <div class="kid-class-title">
            <span class="kid-class-icon" aria-hidden="true">${icon}</span>
            <div>
              <h3>${escapeHtml(getClassTitle(classItem))}</h3>
              <p class="panel-subtitle kid-sub">🗓️ ${escapeHtml(formatDate(classItem.dateTime))}</p>
            </div>
          </div>
          <span class="status-pill ${existingSubmission ? "" : "pending"}">${existingSubmission ? "✅ Done" : "🎯 Open"}</span>
        </div>
        <div class="card__meta">
          <span>👩‍🏫 ${escapeHtml(classItem.teacherName || "Teacher")}</span>
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary kid-join", theme.join, getMeetingUnavailableLabel(meetingProvider))}
          ${driveLink ? renderExternalAction(driveLink, "secondary kid-secondary", "Docs 📄", "No docs") : ""}
        </div>
      </article>
    `;
  }

  function renderStudentHomeworkCard(classItem) {
    const existingSubmission = state.submissions.find((submission) => submission.classId === classItem.id);
    const driveLink = safeExternalUrl(classItem.driveLink);
    const icon = getKidClassIcon(classItem);

    return `
      <article class="card card--soft kid-card kid-hw-card">
        <div class="card__top">
          <div class="kid-class-title">
            <span class="kid-class-icon" aria-hidden="true">${icon}</span>
            <div>
              <h3>${escapeHtml(getClassTitle(classItem))}</h3>
              <p class="panel-subtitle kid-sub">🗓️ ${escapeHtml(formatDate(classItem.dateTime))}</p>
            </div>
          </div>
          <span class="status-pill ${existingSubmission ? "" : "pending"}">${existingSubmission ? "✅ Sent" : "📝 To do"}</span>
        </div>
        <div class="card__meta">
          <span>👩‍🏫 ${escapeHtml(classItem.teacherName || "Teacher")}</span>
          ${driveLink ? `<span>📄 Materials ready</span>` : ""}
        </div>
        ${existingSubmission && existingSubmission.feedback ? `
          <div class="feedback-note">
            <strong>💬 Teacher says</strong>
            <p>${escapeHtml(existingSubmission.feedback)}</p>
          </div>
        ` : ""}
        <form class="form-grid" data-form="upload-homework" data-class-id="${classItem.id}">
          <div class="field">
            <label for="homework-${classItem.id}">${existingSubmission ? "📷 New photo" : "📷 Pick a photo"}</label>
            <input id="homework-${classItem.id}" name="homework" type="file" accept="image/*" capture="environment" required>
          </div>
          <button class="btn primary kid-join" type="submit">${existingSubmission ? "Update ✨" : "Send 📤"}</button>
        </form>
      </article>
    `;
  }

  function renderTeacherSubmissionCard(submission) {
    const linkedClass = state.classes.find((classItem) => classItem.id === submission.classId);
    const statusClass = submission.score ? "status-pill" : "status-pill pending";
    const statusText = submission.score ? `Rank: ${escapeHtml(submission.score)}` : "Awaiting rank";

    return `
      <article class="submission-card">
        <div class="submission-top">
          <div>
            <h3>${escapeHtml(submission.studentName)}</h3>
            <p>${linkedClass ? escapeHtml(getClassTitle(linkedClass)) : "Class details unavailable"}</p>
          </div>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <div class="submission-meta">
          <span><strong>Subject:</strong> ${escapeHtml(submission.subject)}</span>
          <span><strong>Submitted:</strong> ${formatDate(submission.submittedAt)}</span>
        </div>
        <img class="homework-preview" src="${escapeAttribute(submission.imageUrl)}" alt="Homework submission from ${escapeAttribute(submission.studentName)}">
        <form class="form-grid" data-form="grade-homework" data-submission-id="${submission.id}">
          <div class="form-grid two">
            <div class="field">
              <label for="score-${submission.id}">Rank / Score</label>
              <input id="score-${submission.id}" name="score" type="text" value="${escapeAttribute(submission.score || "")}" placeholder="Example: 9/10" required>
            </div>
            <div class="field">
              <label for="feedback-${submission.id}">Comment for Student</label>
              <textarea id="feedback-${submission.id}" name="feedback" placeholder="Example: Strong work, revise step 2">${escapeHtml(submission.feedback || "")}</textarea>
            </div>
          </div>
          <button class="btn primary" type="submit">Save Ranking</button>
        </form>
      </article>
    `;
  }

  function renderAdminUserCard(user) {
    const statusLabel = getActivationStatusLabel(user.activationStatus);
    const statusClass = user.activationStatus === "active"
      ? "status-pill approved"
      : user.activationStatus === "inactive"
        ? "status-pill pending"
        : "status-pill waiting";
    const activationAction = user.activationStatus === "active"
      ? {
          label: "Deactivate",
          active: "false",
          style: "secondary"
        }
      : {
          label: "Activate",
          active: "true",
          style: "primary"
        };

    return `
      <article class="card admin-user-card">
        <div class="card__top">
          <div>
            <h3>${escapeHtml(user.name)}</h3>
            <p>${escapeHtml(formatAdminRoleLabel(user.role))}</p>
          </div>
          <span class="${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="card__meta">
          <span><strong>Email:</strong> ${escapeHtml(user.email)}</span>
          ${user.subject ? `<span><strong>Subject:</strong> ${escapeHtml(user.subject)}</span>` : ""}
          ${user.createdAt ? `<span><strong>Joined:</strong> ${escapeHtml(formatDate(user.createdAt))}</span>` : ""}
        </div>
        <div class="class-actions">
          <button class="btn ${activationAction.style}" type="button" data-action="toggle-user-active" data-user-id="${escapeAttribute(user.id)}" data-next-active="${activationAction.active}">
            ${activationAction.label}
          </button>
        </div>
      </article>
    `;
  }

  function renderStudentSubmissionCard(submission) {
    const linkedClass = state.classes.find((classItem) => classItem.id === submission.classId);
    const statusClass = submission.score ? "status-pill" : "status-pill pending";
    const statusText = submission.score ? `⭐ ${escapeHtml(submission.score)}` : "⏳ Waiting";

    return `
      <article class="submission-card kid-result-card">
        <div class="submission-top">
          <div>
            <h3>${linkedClass ? escapeHtml(getClassTitle(linkedClass)) : "Your homework"}</h3>
            <p class="kid-sub">${escapeHtml(submission.subject || "Class")} · 👩‍🏫 ${linkedClass ? escapeHtml(linkedClass.teacherName) : "Teacher"}</p>
          </div>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <img class="homework-preview" src="${escapeAttribute(submission.imageUrl)}" alt="Homework uploaded by student">
        <div class="submission-meta">
          <span>📤 Sent ${formatDate(submission.submittedAt)}</span>
        </div>
        <div class="feedback-note">
          <strong>Teacher comment</strong>
          <p>${escapeHtml(submission.feedback || "No comment yet")}</p>
        </div>
      </article>
    `;
  }

  function renderEmptyState(title, body) {
    return `
      <article class="empty-state">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </article>
    `;
  }

  function renderMessage() {
    if (!state.message) {
      return "";
    }

    return `<div class="message ${state.message.type}">${escapeHtml(state.message.text)}</div>`;
  }

  function renderDashboardTabs(options = {}) {
    const kid = Boolean(options.kid);
    const theme = options.theme || getKidTheme();
    const isTeacher = state.user && state.user.role === "teacher";
    return `
      <div class="tab-bar${kid ? " tab-bar--kid" : ""}" role="tablist" aria-label="Dashboard sections">
        <button class="tab-pill ${state.dashboardTab === "meetings" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "meetings"}" data-action="set-dashboard-tab" data-tab="meetings">${kid ? `${theme.hero} Classes` : "Classes"}</button>
        <button class="tab-pill ${state.dashboardTab === "progress" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "progress"}" data-action="set-dashboard-tab" data-tab="progress">${kid ? `${theme.progress} Progress` : "Progress"}</button>
        <button class="tab-pill ${state.dashboardTab === "homework" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "homework"}" data-action="set-dashboard-tab" data-tab="homework">${kid ? `${theme.mission} Homework` : "Homework"}</button>
        ${isTeacher
          ? `<button class="tab-pill ${state.dashboardTab === "coach" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "coach"}" data-action="set-dashboard-tab" data-tab="coach">AI Coach</button>`
          : ""}
      </div>
    `;
  }

  function renderClassProgressPanel(options = {}) {
    const kid = Boolean(options.kid);
    const theme = options.theme || getKidTheme();
    const isTeacher = state.user && state.user.role === "teacher";
    const selectedKid = getSelectedCalendarStudent();
    const scopedClasses = getProgressScopedClasses(state.classes);
    const stats = getClassProgress(scopedClasses);
    const conducted = [...stats.conducted].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    const upcoming = [...stats.upcoming].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    const uniqueTopics = getUniqueTopics(conducted);
    const kidRows = isTeacher && state.selectedCalendarStudentId === "all"
      ? getKidProgressRows(getProgressPeriodClasses(state.classes))
      : [];
    const periodLabel = state.progressPeriod === "month" ? "this month" : "all time";
    const audienceLabel = selectedKid
      ? selectedKid.name
      : (isTeacher ? "all kids" : (state.user && state.user.name) || "this student");
    const fillPercent = stats.percent;

    return `
      <section class="card${kid ? " kid-card kid-progress-card" : ""}">
        <div class="section-heading progress-heading">
          <div>
            <h3 class="${kid ? "kid-section-title" : ""}">${kid ? `${theme.progress} ${escapeHtml(theme.progressTitle)}` : "Class progress"}</h3>
            <p class="panel-subtitle${kid ? " kid-sub" : ""}">${escapeHtml(audienceLabel)} · ${escapeHtml(periodLabel)}. A class counts as done after its scheduled time ends.</p>
          </div>
          <div class="progress-toolbar">
            <div class="view-toggle" role="group" aria-label="Progress period">
              <button class="btn ${state.progressPeriod === "all" ? "primary" : "secondary"}" type="button" data-action="progress-period" data-period="all">All time</button>
              <button class="btn ${state.progressPeriod === "month" ? "primary" : "secondary"}" type="button" data-action="progress-period" data-period="month">This month</button>
            </div>
            ${isTeacher ? `
              <label class="calendar-select">
                <span>Kid</span>
                <select name="calendarStudentId">
                  <option value="all"${state.selectedCalendarStudentId === "all" ? " selected" : ""}>All kids</option>
                  ${getCalendarStudentOptions().map((student) => `
                    <option value="${escapeAttribute(student.id)}"${state.selectedCalendarStudentId === student.id ? " selected" : ""}>
                      ${escapeHtml(student.name)}
                    </option>
                  `).join("")}
                </select>
              </label>
            ` : ""}
          </div>
        </div>

        <div class="summary-strip progress-summary">
          <article class="summary-card">
            <span>Scheduled</span>
            <strong>${stats.scheduled}</strong>
            <small>Classes on the calendar</small>
          </article>
          <article class="summary-card">
            <span>Conducted</span>
            <strong>${stats.conducted.length}</strong>
            <small>Finished classes</small>
          </article>
          <article class="summary-card">
            <span>Upcoming</span>
            <strong>${stats.upcoming.length}</strong>
            <small>Still to take</small>
          </article>
          <article class="summary-card">
            <span>Topics covered</span>
            <strong>${uniqueTopics.length}</strong>
            <small>${fillPercent}% complete</small>
          </article>
        </div>

        <div class="progress-meter" role="img" aria-label="${fillPercent} percent of scheduled classes completed">
          <div class="progress-meter__top">
            <strong>${stats.conducted.length} of ${stats.scheduled} done</strong>
            <span>${fillPercent}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${fillPercent}%"></div>
          </div>
        </div>

        ${!stats.scheduled ? renderEmptyState(
          kid ? "No classes to track yet" : "No classes scheduled",
          kid ? "When your teacher books a class, progress and topics will show up here for you and your parent." : "Schedule a class or month series to start tracking progress."
        ) : `
          <div class="dashboard-columns progress-columns">
            <section>
              <div class="section-heading">
                <div>
                  <h3>${kid ? "Topics we covered" : "Topics covered"}</h3>
                  <p class="panel-subtitle${kid ? " kid-sub" : ""}">${uniqueTopics.length} topic${uniqueTopics.length === 1 ? "" : "s"} from finished classes</p>
                </div>
              </div>
              ${uniqueTopics.length ? `
                <div class="progress-topic-chips">
                  ${uniqueTopics.map((topic) => `<span class="progress-chip">${escapeHtml(topic.label)}</span>`).join("")}
                </div>
              ` : ""}
              <div class="section-stack progress-topic-list">
                ${conducted.length
                  ? conducted.map((classItem) => renderProgressClassRow(classItem, { kid, done: true })).join("")
                  : renderEmptyState("None finished yet", "Finished classes and their topics will collect here.")}
              </div>
            </section>
            <section>
              <div class="section-heading">
                <div>
                  <h3>${kid ? "Coming up next" : "Upcoming topics"}</h3>
                  <p class="panel-subtitle${kid ? " kid-sub" : ""}">${upcoming.length} class${upcoming.length === 1 ? "" : "es"} still scheduled</p>
                </div>
              </div>
              <div class="section-stack progress-topic-list">
                ${upcoming.length
                  ? upcoming.slice(0, 12).map((classItem) => renderProgressClassRow(classItem, { kid, done: false })).join("")
                  : renderEmptyState("All caught up", "No remaining classes in this view.")}
              </div>
            </section>
          </div>
        `}
      </section>

      ${kidRows.length ? `
        <section class="card" style="margin-top:16px;">
          <div class="section-heading">
            <div>
              <h3>Progress by kid</h3>
              <p class="panel-subtitle">Tap a row to focus on that student</p>
            </div>
          </div>
          <div class="progress-table-wrap">
            <table class="progress-table">
              <thead>
                <tr>
                  <th>Kid</th>
                  <th>Scheduled</th>
                  <th>Done</th>
                  <th>Left</th>
                  <th>Progress</th>
                  <th>Last topic</th>
                </tr>
              </thead>
              <tbody>
                ${kidRows.map((row) => `
                  <tr data-action="filter-progress-kid" data-student-id="${escapeAttribute(row.student.id)}" tabindex="0">
                    <td><strong>${escapeHtml(row.student.name)}</strong></td>
                    <td>${row.stats.scheduled}</td>
                    <td>${row.stats.conducted.length}</td>
                    <td>${row.stats.upcoming.length}</td>
                    <td>
                      <div class="progress-mini">
                        <span class="progress-track progress-track--mini"><span class="progress-fill" style="width: ${row.stats.percent}%"></span></span>
                        <em>${row.stats.percent}%</em>
                      </div>
                    </td>
                    <td>${escapeHtml(row.lastTopic)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      ` : ""}
    `;
  }

  function renderProgressClassRow(classItem, options = {}) {
    const kid = Boolean(options.kid);
    const done = Boolean(options.done);
    const icon = kid ? getKidClassIcon(classItem) : (done ? "✓" : "•");
    const kidNames = formatStudentNames(classItem.studentNames);
    return `
      <article class="progress-topic${done ? " is-done" : ""}">
        <span class="progress-topic__icon" aria-hidden="true">${icon}</span>
        <div>
          <strong>${escapeHtml(getClassTitle(classItem))}</strong>
          <p>${escapeHtml(classItem.subject || "Class")} · ${escapeHtml(formatDate(classItem.dateTime))}${state.user.role === "teacher" ? ` · ${escapeHtml(kidNames)}` : ""}</p>
        </div>
        <span class="status-pill ${done ? "" : "pending"}">${done ? "Done" : "Scheduled"}</span>
      </article>
    `;
  }

  function loadKidThemeId() {
    try {
      const saved = String(window.localStorage.getItem(KID_THEME_STORAGE_KEY) || "").trim();
      if (KID_THEMES[saved]) {
        return saved;
      }
    } catch (_error) {
      // ignore storage failures
    }
    return "play";
  }

  function getKidTheme() {
    return KID_THEMES[state.kidTheme] || KID_THEMES.play;
  }

  function setKidTheme(themeId) {
    const next = KID_THEMES[themeId] ? themeId : "play";
    state.kidTheme = next;
    try {
      window.localStorage.setItem(KID_THEME_STORAGE_KEY, next);
    } catch (_error) {
      // ignore storage failures
    }
    applyKidThemeClass(next);
    renderApp({ type: "success", text: `${KID_THEMES[next].emoji} Theme set to ${KID_THEMES[next].label}!` });
  }

  function applyKidThemeClass(themeId) {
    clearKidThemeClasses();
    const id = KID_THEMES[themeId] ? themeId : "play";
    document.body.classList.add(`kid-theme-${id}`);
  }

  function clearKidThemeClasses() {
    Object.keys(KID_THEMES).forEach((id) => {
      document.body.classList.remove(`kid-theme-${id}`);
    });
  }

  function getKidClassIcon(classItem) {
    const seed = String(classItem.subject || classItem.topic || classItem.id || "class").toLowerCase();
    if (seed.includes("math") || seed.includes("maths") || seed.includes("number")) return "🔢";
    if (seed.includes("english") || seed.includes("read") || seed.includes("write")) return "📖";
    if (seed.includes("science") || seed.includes("bio") || seed.includes("chem")) return "🔬";
    if (seed.includes("art") || seed.includes("draw") || seed.includes("paint")) return "🎨";
    if (seed.includes("music") || seed.includes("song")) return "🎵";
    if (seed.includes("code") || seed.includes("computer") || seed.includes("tech")) return "💻";
    if (seed.includes("sport") || seed.includes("pe") || seed.includes("fit")) return "⚽";
    const icons = ["📘", "📗", "📙", "💡", "🧩", "🌟", "✏️", "🎒"];
    let total = 0;
    for (const character of seed) {
      total += character.charCodeAt(0);
    }
    return icons[total % icons.length];
  }

  function renderCalendarControls({ title, showKidFilter }) {
    const studentOptions = getCalendarStudentOptions();

    return `
      <div class="calendar-toolbar">
        <div class="calendar-nav">
          <button class="btn secondary" type="button" data-action="calendar-prev">Previous</button>
          <button class="btn ghost" type="button" data-action="calendar-today">Today</button>
          <button class="btn secondary" type="button" data-action="calendar-next">Next</button>
        </div>
        <div class="calendar-label">${escapeHtml(title)}</div>
        <div class="calendar-filters">
          <div class="view-toggle">
            <button class="btn ${state.calendarView === "week" ? "primary" : "secondary"}" type="button" data-action="calendar-view" data-view="week">Week</button>
            <button class="btn ${state.calendarView === "month" ? "primary" : "secondary"}" type="button" data-action="calendar-view" data-view="month">Month</button>
          </div>
          ${showKidFilter ? `
            <label class="calendar-select">
              <span>Kid</span>
              <select name="calendarStudentId">
                <option value="all"${state.selectedCalendarStudentId === "all" ? " selected" : ""}>All kids</option>
                ${studentOptions.map((student) => `
                  <option value="${escapeAttribute(student.id)}"${state.selectedCalendarStudentId === student.id ? " selected" : ""}>
                    ${escapeHtml(student.name)}
                  </option>
                `).join("")}
              </select>
            </label>
          ` : ""}
        </div>
      </div>
    `;
  }

  function renderCalendarGrid(classes) {
    return state.calendarView === "month"
      ? renderMonthCalendar(classes)
      : renderWeekCalendar(classes);
  }

  function renderWeekCalendar(classes) {
    const start = getStartOfWeek(getCalendarCursorDate());
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });

    return `
      <div class="calendar-grid week">
        ${days.map((day) => {
          const dayClasses = getClassesForDate(classes, day);
          return `
            <section class="calendar-day${isSameDay(day, new Date()) ? " is-today" : ""}">
              <header>
                <span>${escapeHtml(formatWeekday(day))}</span>
                <strong>${escapeHtml(formatDayNumber(day))}</strong>
              </header>
              <div class="calendar-day__events">
                ${dayClasses.length
                  ? dayClasses.map((classItem) => renderCalendarEvent(classItem, { compact: false })).join("")
                  : '<p class="calendar-empty">No classes booked.</p>'}
              </div>
            </section>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderMonthCalendar(classes) {
    const cursor = getCalendarCursorDate();
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12);
    const gridStart = getStartOfWeek(monthStart);
    const gridEnd = getEndOfWeek(monthEnd);
    const days = [];

    for (const day = new Date(gridStart); day <= gridEnd; day.setDate(day.getDate() + 1)) {
      days.push(new Date(day));
    }

    return `
      <div class="calendar-weekdays">
        ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => `<span>${label}</span>`).join("")}
      </div>
      <div class="calendar-grid month">
        ${days.map((day) => {
          const dayClasses = getClassesForDate(classes, day);
          const isOutsideMonth = day.getMonth() !== cursor.getMonth();
          return `
            <section class="calendar-cell${isSameDay(day, new Date()) ? " is-today" : ""}${isOutsideMonth ? " is-outside" : ""}">
              <header>${escapeHtml(String(day.getDate()))}</header>
              <div class="calendar-cell__events">
                ${dayClasses.length
                  ? dayClasses.map((classItem) => renderCalendarEvent(classItem, { compact: true })).join("")
                  : '<span class="calendar-empty compact">No class</span>'}
              </div>
            </section>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderCalendarEvent(classItem, { compact }) {
    const classDate = new Date(classItem.dateTime);
    const timeLabel = formatTime(classDate);
    const kidNames = formatStudentNames(classItem.studentNames);
    const meetingProvider = getClassMeetingProvider(classItem);
    const accentStyle = getBookingAccentStyle(classItem);
    const selectionClass = state.selectedClassId === classItem.id ? " is-selected" : "";
    const actionAttributes = state.user.role === "teacher"
      ? `data-action="edit-class" data-class-id="${escapeAttribute(classItem.id)}"`
      : "";

    return `
      <article class="calendar-event${compact ? " compact" : ""}${selectionClass}" ${actionAttributes} style="${escapeAttribute(accentStyle)}">
        <span class="calendar-event__time">${escapeHtml(timeLabel)}</span>
        <strong>${escapeHtml(getClassTitle(classItem))}</strong>
        <span>${escapeHtml(getCalendarEventMeta(classItem, meetingProvider))}</span>
        ${state.user.role === "teacher" ? `<span>${escapeHtml(kidNames)}</span>` : ""}
      </article>
    `;
  }

  function renderExternalAction(url, variant, label, fallbackLabel) {
    if (!url) {
      return `<span class="link-btn ${variant} is-disabled" aria-disabled="true">${escapeHtml(fallbackLabel)}</span>`;
    }

    return `<a class="link-btn ${variant}" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
  }

  async function handleSubmit(event) {
    const form = event.target;
    const formType = form.dataset.form;
    if (!formType) {
      return;
    }

    event.preventDefault();

    if (formType === "login") {
      await loginUser(new FormData(form));
      return;
    }

    if (formType === "verify-2fa") {
      await verifyTwoFactor(new FormData(form));
      return;
    }

    if (formType === "register") {
      await registerUser(new FormData(form));
      return;
    }

    if (formType === "schedule-class") {
      await saveClass(new FormData(form));
      return;
    }

    if (formType === "upload-homework") {
      await uploadHomework(form);
      return;
    }

    if (formType === "grade-homework") {
      await gradeHomework(form, new FormData(form));
      return;
    }

    if (formType === "create-assignment") {
      await createAssignment(new FormData(form));
      return;
    }

    if (formType === "submit-assignment") {
      await submitAssignment(form);
      return;
    }

    if (formType === "grade-assignment") {
      await gradeAssignmentSubmission(form, new FormData(form));
      return;
    }

    if (formType === "ai-coach") {
      await runAiCoach(new FormData(form));
      return;
    }
  }

  function handleClick(event) {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }

    if (actionButton.dataset.action === "calendar-prev") {
      shiftCalendar(-1);
      return;
    }

    if (actionButton.dataset.action === "calendar-next") {
      shiftCalendar(1);
      return;
    }

    if (actionButton.dataset.action === "calendar-today") {
      state.calendarCursor = createDateKey(new Date());
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "calendar-view") {
      state.calendarView = actionButton.dataset.view === "month" ? "month" : "week";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "set-auth-mode") {
      state.authMode = actionButton.dataset.mode === "register" ? "register" : "login";
      state.pending2fa = null;
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "cancel-2fa") {
      state.authMode = "login";
      state.pending2fa = null;
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "resend-2fa") {
      void resendTwoFactor();
      return;
    }

    if (actionButton.dataset.action === "copy-otp") {
      const code = actionButton.dataset.code || "";
      if (code && navigator.clipboard && navigator.clipboard.writeText) {
        void navigator.clipboard.writeText(code).then(() => {
          actionButton.textContent = "Copied!";
          window.setTimeout(() => {
            actionButton.textContent = "Copy code";
          }, 1200);
        });
      }
      return;
    }

    if (actionButton.dataset.action === "set-dashboard-tab") {
      const tab = actionButton.dataset.tab;
      state.dashboardTab = isDashboardTab(tab) ? tab : "meetings";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "set-weekdays") {
      const preset = actionButton.dataset.preset;
      const wanted = preset === "all"
        ? new Set(["0", "1", "2", "3", "4", "5", "6"])
        : preset === "none"
          ? new Set()
          : new Set(["1", "2", "3", "4", "5"]);
      app.querySelectorAll('input[name="seriesWeekdays"]').forEach((input) => {
        input.checked = wanted.has(input.value);
      });
      return;
    }

    if (actionButton.dataset.action === "set-class-filter") {
      const filter = actionButton.dataset.filter;
      state.classListFilter = ["upcoming", "past", "all"].includes(filter) ? filter : "upcoming";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "progress-period") {
      state.progressPeriod = actionButton.dataset.period === "month" ? "month" : "all";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "filter-progress-kid") {
      state.selectedCalendarStudentId = actionButton.dataset.studentId || "all";
      state.dashboardTab = "progress";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "ai-fill-homework") {
      void runAiCoach(null, "homework");
      return;
    }

    if (actionButton.dataset.action === "ai-use-as-homework") {
      state.dashboardTab = "homework";
      renderApp({ type: "success", text: "AI draft loaded into the homework form." });
      return;
    }

    if (actionButton.dataset.action === "ai-clear-draft") {
      state.aiDraft = null;
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "set-kid-theme") {
      setKidTheme(actionButton.dataset.theme);
      return;
    }

    if (actionButton.dataset.action === "edit-class") {
      state.selectedClassId = actionButton.dataset.classId || null;
      state.isEditingClass = false;
      state.dashboardTab = "meetings";
      discardFormDraft("schedule-class");
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "cancel-class-edit") {
      state.isEditingClass = false;
      discardFormDraft("schedule-class");
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "start-class-edit") {
      state.isEditingClass = true;
      discardFormDraft("schedule-class");
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "clear-class-selection") {
      state.selectedClassId = null;
      state.isEditingClass = false;
      discardFormDraft("schedule-class");
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "cancel-class") {
      void cancelClass(actionButton.dataset.classId, actionButton.dataset.scope);
      return;
    }

    if (actionButton.dataset.action === "copy-link") {
      copyMeetingLink(actionButton);
      return;
    }

    if (actionButton.dataset.action === "set-schedule-mode") {
      state.scheduleMode = actionButton.dataset.mode === "series" ? "series" : "once";
      state.selectedClassId = null;
      state.isEditingClass = false;
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "add-series-time") {
      syncSeriesTimesFromDom();
      if (state.seriesTimes.length < 6) {
        const last = state.seriesTimes[state.seriesTimes.length - 1] || "16:00";
        const [hours, minutes] = last.split(":").map(Number);
        const nextMinutes = ((hours * 60) + minutes + 60) % (24 * 60);
        const next = `${String(Math.floor(nextMinutes / 60)).padStart(2, "0")}:${String(nextMinutes % 60).padStart(2, "0")}`;
        state.seriesTimes = [...state.seriesTimes, next];
        renderApp();
      }
      return;
    }

    if (actionButton.dataset.action === "remove-series-time") {
      syncSeriesTimesFromDom();
      const index = Number(actionButton.dataset.index);
      if (Number.isInteger(index) && state.seriesTimes.length > 1) {
        state.seriesTimes = state.seriesTimes.filter((_time, timeIndex) => timeIndex !== index);
        renderApp();
      }
      return;
    }

    if (actionButton.dataset.action === "toggle-user-active") {
      void updateUserActivation(actionButton.dataset.userId, actionButton.dataset.nextActive === "true");
      return;
    }

    if (actionButton.dataset.action === "logout") {
      void logoutUser();
    }
  }

  async function logoutUser() {
    try {
      await api("/api/logout", { method: "POST" });
    } catch (_error) {
      // The local session is cleared either way; the cookie expires on its own.
    }

    resetSessionState();
    renderApp({ type: "success", text: "You have been logged out." });
  }

  function resetSessionState() {
    state.user = null;
    state.classes = [];
    state.submissions = [];
    state.assignments = [];
    state.assignmentSubmissions = [];
    state.students = [];
    state.managedUsers = [];
    state.zoomConfigured = false;
    state.teamsSupported = true;
    state.authMode = "login";
    state.authRole = "teacher";
    state.registerRole = "student";
    state.meetingProvider = "none";
    state.zoomMode = "manual";
    state.dashboardTab = "meetings";
    state.progressPeriod = "all";
    state.selectedCalendarStudentId = "all";
    state.calendarView = "week";
    state.calendarCursor = createDateKey(new Date());
    state.selectedClassId = null;
    state.isEditingClass = false;
    state.scheduleMode = "once";
    state.seriesPattern = "weekdays";
    state.seriesTimes = ["16:00"];
    state.classListFilter = "upcoming";
    state.pending2fa = null;
    state.authMode = "login";
    clearKidThemeClasses();
  }

  function handleChange(event) {
    if (event.target.name === "meetingMode") {
      refreshMeetingModeFields(event.target.form);
      return;
    }

    if (event.target.name === "role" && event.target.matches("[data-register-role]")) {
      state.registerRole = event.target.value === "teacher" ? "teacher" : "student";
      const subjectField = event.target.form && event.target.form.querySelector("[data-register-subject-field]");
      if (subjectField) {
        subjectField.hidden = state.registerRole !== "teacher";
      }
      const nameLabel = event.target.form && event.target.form.querySelector('label[for="register-name"]');
      const nameInput = event.target.form && event.target.form.querySelector("#register-name");
      if (nameLabel) {
        nameLabel.textContent = state.registerRole === "teacher" ? "Name" : "Kid's name";
      }
      if (nameInput) {
        nameInput.placeholder = state.registerRole === "teacher" ? "Your name" : "Student name";
      }
      return;
    }

    if (event.target.name === "seriesPattern") {
      state.seriesPattern = ["weekdays", "alternate", "daily"].includes(event.target.value)
        ? event.target.value
        : "weekdays";
      const weekdayField = event.target.form && event.target.form.querySelector("[data-weekday-field]");
      if (weekdayField) {
        weekdayField.hidden = state.seriesPattern !== "weekdays";
      }
      return;
    }

    if (event.target.name === "calendarStudentId") {
      state.selectedCalendarStudentId = event.target.value || "all";
      renderApp();
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      void refreshActiveSessionSilently();
    }
  }

  function handleWindowFocus() {
    void refreshActiveSessionSilently();
  }

  function refreshMeetingModeFields(form) {
    if (!form) {
      return;
    }

    const modeSelect = form.querySelector('select[name="meetingMode"]');
    const meetingOption = modeSelect ? String(modeSelect.value || "") : "none";
    const isManual = isManualMeetingOption(meetingOption);
    const manualField = form.querySelector("[data-manual-zoom-field], [data-update-manual-zoom-field]");
    const autoHint = form.querySelector("[data-update-auto-hint]");
    const manualInput = form.querySelector('input[name="manualMeetingLink"]');
    const manualLabel = form.querySelector("[data-manual-link-label]");
    const manualHint = form.querySelector("[data-manual-link-hint]");
    const manualLinkCopy = getManualLinkCopy(getMeetingOptionProvider(meetingOption));

    if (manualField) {
      manualField.hidden = !isManual;
    }

    if (autoHint) {
      autoHint.hidden = !isAutoMeetingOption(meetingOption);
    }

    if (manualLabel) {
      manualLabel.textContent = manualLinkCopy.label;
    }

    if (manualHint) {
      manualHint.textContent = manualLinkCopy.hint;
    }

    if (manualInput) {
      manualInput.placeholder = manualLinkCopy.placeholder;
      if (!isManual) {
        manualInput.value = meetingOption === "none" ? "" : manualInput.value;
      }
    }
  }

  async function loginUser(formData) {
    try {
      const payload = await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(formData.get("email") || "").trim(),
          password: String(formData.get("password") || "").trim()
        })
      });

      if (payload.requires2fa) {
        state.authMode = "2fa";
        state.pending2fa = {
          challengeId: payload.challengeId,
          devCode: payload.devCode || "",
          delivery: payload.delivery || "local",
          maskedPhone: payload.maskedPhone || ""
        };
        renderApp({
          type: "success",
          text: payload.message || "Enter your verification code."
        });
        return;
      }

      applyDashboardPayload(payload.dashboard);
      state.pending2fa = null;
      state.authMode = "login";
      renderApp({ type: "success", text: `Welcome back, ${payload.user.name}.` });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function verifyTwoFactor(formData) {
    try {
      const payload = await api("/api/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: state.pending2fa ? state.pending2fa.challengeId : "",
          code: String(formData.get("code") || "").trim().replace(/\s+/g, "")
        })
      });

      state.pending2fa = null;
      state.authMode = "login";
      applyDashboardPayload(payload.dashboard);
      renderApp({
        type: "success",
        text: payload.message || `Welcome back, ${payload.user.name}.`
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function resendTwoFactor() {
    if (!state.pending2fa || !state.pending2fa.challengeId) {
      state.authMode = "login";
      renderApp({ type: "error", text: "Session expired. Please sign in again." });
      return;
    }

    try {
      const payload = await api("/api/login/resend-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: state.pending2fa.challengeId
        })
      });

      state.authMode = "2fa";
      state.pending2fa = {
        challengeId: payload.challengeId,
        devCode: payload.devCode || "",
        delivery: payload.delivery || "local",
        maskedPhone: payload.maskedPhone || ""
      };
      renderApp({
        type: "success",
        text: payload.message || "A new verification code is ready."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function registerUser(formData) {
    try {
      const role = String(formData.get("role") || state.registerRole || "student").trim().toLowerCase();
      const payload = await api("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role === "teacher" ? "teacher" : "student",
          name: String(formData.get("name") || "").trim(),
          subject: String(formData.get("subject") || "").trim(),
          email: String(formData.get("email") || "").trim(),
          phone: String(formData.get("phone") || "").trim(),
          password: String(formData.get("password") || "").trim()
        })
      });

      state.authMode = "login";
      renderApp({
        type: "success",
        text: payload.message || "Account created successfully. Please wait for admin activation before logging in."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function updateUserActivation(userId, isActive) {
    try {
      const response = await api(`/api/admin/users/${encodeURIComponent(userId)}/activation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive })
      });

      await refreshDashboard({
        type: "success",
        text: response.message || "Account access updated."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function saveClass(formData) {
    if (state.selectedClassId && state.isEditingClass) {
      await updateClass(formData);
      return;
    }

    await createClass(formData);
  }

  async function createClass(formData) {
    try {
      const manualMeetingLink = String(formData.get("manualMeetingLink") || "").trim();
      const { meetingProvider, meetingMode } = parseMeetingOption(formData.get("meetingMode"));
      const scheduleMode = state.scheduleMode === "series" ? "series" : "once";
      const payload = {
        scheduleMode,
        timeZone: getBrowserTimeZone(),
        topic: String(formData.get("topic") || "").trim(),
        details: String(formData.get("details") || "").trim(),
        durationMinutes: Number(formData.get("durationMinutes") || 45),
        driveLink: String(formData.get("driveLink") || "").trim(),
        studentIds: formData.getAll("studentIds").map((value) => String(value || "").trim()).filter(Boolean),
        meetingProvider,
        meetingMode,
        useAutoZoom: meetingMode === "auto",
        manualMeetingLink
      };

      if (scheduleMode === "series") {
        payload.seriesStartDate = String(formData.get("seriesStartDate") || "").trim();
        payload.seriesEndDate = String(formData.get("seriesEndDate") || "").trim();
        payload.seriesPattern = String(formData.get("seriesPattern") || state.seriesPattern || "weekdays").trim();
        payload.seriesWeekdays = formData.getAll("seriesWeekdays").map((value) => Number(value)).filter((day) => Number.isInteger(day));
        payload.seriesTimes = formData.getAll("seriesTimes").map((value) => String(value || "").trim()).filter(Boolean);
        state.seriesTimes = payload.seriesTimes.length ? payload.seriesTimes : state.seriesTimes;
        state.seriesPattern = payload.seriesPattern;
      } else {
        payload.dateTime = String(formData.get("dateTime") || "").trim();
      }

      const response = await api("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      state.selectedClassId = response.classItem ? response.classItem.id : null;
      state.isEditingClass = false;
      discardFormDraft("schedule-class");
      // Jump the calendar to the first new class so it is visible straight away
      // instead of leaving the teacher on a week with nothing in it.
      if (response.classItem) {
        focusCalendarOn(response.classItem.dateTime);
      }
      const successText = response.count > 1
        ? (response.message || `Scheduled ${response.count} classes.`)
        : buildClassSaveMessage(response.classItem, response.message || "Class scheduled successfully.");
      await refreshDashboard({
        type: "success",
        text: successText
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function cancelClass(classId, scope) {
    if (!classId) {
      return;
    }

    const classItem = state.classes.find((entry) => entry.id === classId);
    const wholeSeries = scope === "series";
    const seriesCount = classItem && classItem.seriesId
      ? state.classes.filter((entry) => entry.seriesId === classItem.seriesId).length
      : 1;
    const label = classItem ? getClassTitle(classItem) : "this class";
    const question = wholeSeries
      ? `Cancel all ${seriesCount} classes in the "${label}" series? Any homework photos sent for them are removed too.`
      : `Cancel "${label}"? Any homework photos sent for it are removed too.`;

    if (!window.confirm(question)) {
      return;
    }

    try {
      const response = await api(`/api/classes/${encodeURIComponent(classId)}?scope=${wholeSeries ? "series" : "single"}`, {
        method: "DELETE"
      });

      state.selectedClassId = null;
      state.isEditingClass = false;
      discardFormDraft("schedule-class");
      await refreshDashboard({
        type: "success",
        text: response.message || "Class cancelled."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function updateClass(formData) {
    try {
      const manualMeetingLink = String(formData.get("manualMeetingLink") || "").trim();
      const { meetingProvider, meetingMode } = parseMeetingOption(formData.get("meetingMode"));
      const payload = {
        timeZone: getBrowserTimeZone(),
        topic: String(formData.get("topic") || "").trim(),
        details: String(formData.get("details") || "").trim(),
        dateTime: String(formData.get("dateTime") || "").trim(),
        durationMinutes: Number(formData.get("durationMinutes") || 45),
        driveLink: String(formData.get("driveLink") || "").trim(),
        studentIds: formData.getAll("studentIds").map((value) => String(value || "").trim()).filter(Boolean),
        meetingProvider,
        meetingMode,
        useAutoZoom: meetingMode === "auto",
        manualMeetingLink
      };

      const response = await api(`/api/classes/${encodeURIComponent(state.selectedClassId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      state.selectedClassId = response.classItem ? response.classItem.id : null;
      state.isEditingClass = false;
      discardFormDraft("schedule-class");
      if (response.classItem) {
        focusCalendarOn(response.classItem.dateTime);
      }
      await refreshDashboard({
        type: "success",
        text: buildClassSaveMessage(response.classItem, response.message || "Class updated successfully.")
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function uploadHomework(form) {
    const fileInput = form.querySelector('input[name="homework"]');
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;
    if (!file) {
      renderApp({ type: "error", text: "Please choose a homework image to upload." });
      return;
    }

    if (!ALLOWED_HOMEWORK_TYPES.has(file.type)) {
      renderApp({ type: "error", text: "Please upload a JPG, PNG, WEBP, HEIC, or HEIF image." });
      return;
    }

    if (file.size > MAX_HOMEWORK_FILE_SIZE) {
      renderApp({ type: "error", text: "Homework images must be 8 MB or smaller." });
      return;
    }

    const body = new FormData();
    body.append("classId", form.dataset.classId);
    body.append("homework", file);

    try {
      const response = await api("/api/submissions", {
        method: "POST",
        body
      });

      await refreshDashboard({
        type: "success",
        text: response.message || "Homework uploaded successfully."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function copyMeetingLink(button) {
    const link = button.dataset.link || "";
    if (!link) {
      return;
    }

    const originalLabel = button.textContent;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }

      button.textContent = "Copied!";
      button.classList.add("is-copied");
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove("is-copied");
      }, 1400);
    } catch (_error) {
      window.prompt("Copy this class link:", link);
    }
  }

  async function gradeHomework(form, formData) {
    try {
      const response = await api(`/api/submissions/${encodeURIComponent(form.dataset.submissionId)}/grade`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: String(formData.get("score") || "").trim(),
          feedback: String(formData.get("feedback") || "").trim()
        })
      });

      await refreshDashboard({
        type: "success",
        text: response.message || "Homework ranking saved."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function createAssignment(formData) {
    try {
      const questionsText = String(formData.get("questionsText") || "");
      const questions = questionsText
        .split(/\n+/)
        .map((line) => line.replace(/^\s*\d+[\).\-\:]\s*/, "").trim())
        .filter(Boolean)
        .map((prompt, index) => ({ id: `q-${index + 1}`, prompt }));

      const response = await api("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(formData.get("title") || "").trim(),
          instructions: String(formData.get("instructions") || "").trim(),
          activityType: String(formData.get("activityType") || "practice").trim(),
          dueAt: String(formData.get("dueAt") || "").trim(),
          revisionNotes: String(formData.get("revisionNotes") || "").trim(),
          studentIds: [String(formData.get("studentIds") || "").trim()].filter(Boolean),
          questions,
          source: state.aiDraft ? "ai" : "manual"
        })
      });

      state.aiDraft = null;
      discardFormDraft("create-assignment");
      await refreshDashboard({
        type: "success",
        text: response.message || "Homework activity sent."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function submitAssignment(form) {
    const assignmentId = form.dataset.assignmentId;
    const formData = new FormData(form);
    const textResponse = String(formData.get("textResponse") || "").trim();
    const answers = [];
    for (const [key, value] of formData.entries()) {
      if (String(key).startsWith("answer-")) {
        answers.push({
          questionId: String(key).slice("answer-".length),
          text: String(value || "").trim()
        });
      }
    }

    const body = new FormData();
    body.append("textResponse", textResponse);
    body.append("answers", JSON.stringify(answers));
    const fileInput = form.querySelector('input[name="homework"]');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      body.append("homework", fileInput.files[0]);
    }

    try {
      const response = await api(`/api/assignments/${encodeURIComponent(assignmentId)}/submit`, {
        method: "POST",
        body
      });
      await refreshDashboard({
        type: "success",
        text: response.message || "Activity submitted."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function gradeAssignmentSubmission(form, formData) {
    try {
      const response = await api(`/api/assignment-submissions/${encodeURIComponent(form.dataset.submissionId)}/grade`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: String(formData.get("score") || "").trim(),
          feedback: String(formData.get("feedback") || "").trim()
        })
      });
      await refreshDashboard({
        type: "success",
        text: response.message || "Feedback saved."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function runAiCoach(formData, forcedTask) {
    const task = forcedTask || String((formData && formData.get("task")) || "lesson-plan");
    const payload = {
      task,
      topic: formData ? String(formData.get("topic") || "").trim() : (state.aiDraft && state.aiDraft.title) || "Today's topic",
      subject: formData ? String(formData.get("subject") || state.user.subject || "").trim() : (state.user.subject || "General"),
      notes: formData ? String(formData.get("notes") || "").trim() : "",
      studentId: formData ? String(formData.get("studentId") || "").trim() : state.insightStudentId || "",
      questionCount: 5
    };

    if (!forcedTask && !payload.topic) {
      renderApp({ type: "error", text: "Add a topic for the AI coach." });
      return;
    }

    if (task === "student-insight" && !payload.studentId) {
      renderApp({ type: "error", text: "Choose a student for learning insight." });
      return;
    }

    state.aiBusy = true;
    renderApp({ type: "success", text: "AI coach is working..." });
    try {
      const response = await api("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      state.aiDraft = response.result || null;
      state.aiStatus = response.aiStatus || state.aiStatus;
      if (payload.studentId) {
        state.insightStudentId = payload.studentId;
      }
      state.aiBusy = false;
      if (forcedTask === "homework") {
        state.dashboardTab = "homework";
      } else {
        state.dashboardTab = "coach";
      }
      renderApp({ type: "success", text: response.message || "AI draft ready." });
    } catch (error) {
      state.aiBusy = false;
      renderApp({ type: "error", text: error.message });
    }
  }

  function formatAiQuestionsText(draft) {
    if (!draft) {
      return "";
    }
    if (Array.isArray(draft.questions)) {
      return draft.questions.map((question, index) => `${index + 1}. ${question.prompt || question}`).join("\n");
    }
    if (Array.isArray(draft.miniQuiz)) {
      return draft.miniQuiz.map((question, index) => `${index + 1}. ${question.prompt || question}`).join("\n");
    }
    if (Array.isArray(draft.steps)) {
      return draft.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
    }
    return "";
  }

  function formatAiRevisionText(draft) {
    if (!draft) {
      return "";
    }
    if (Array.isArray(draft.keyPoints)) {
      return draft.keyPoints.join("\n");
    }
    if (draft.teacherTips) {
      return String(draft.teacherTips);
    }
    if (draft.messageForKid) {
      return String(draft.messageForKid);
    }
    return "";
  }

  async function refreshDashboard(message) {
    const payload = await api("/api/dashboard");
    applyDashboardPayload(payload);
    renderApp(message);
  }

  async function refreshActiveSessionSilently() {
    if (!state.user || document.visibilityState === "hidden") {
      return;
    }

    try {
      const payload = await api("/api/dashboard");
      const classesChanged = JSON.stringify(state.classes) !== JSON.stringify(payload.classes || []);
      const submissionsChanged = JSON.stringify(state.submissions) !== JSON.stringify(payload.submissions || []);
      const assignmentsChanged = JSON.stringify(state.assignments) !== JSON.stringify(payload.assignments || []);
      const assignmentSubsChanged = JSON.stringify(state.assignmentSubmissions) !== JSON.stringify(payload.assignmentSubmissions || []);
      const studentsChanged = JSON.stringify(state.students) !== JSON.stringify(payload.students || []);
      const managedUsersChanged = JSON.stringify(state.managedUsers) !== JSON.stringify(payload.managedUsers || []);

      applyDashboardPayload(payload);

      if (classesChanged || submissionsChanged || assignmentsChanged || assignmentSubsChanged || studentsChanged || managedUsersChanged) {
        renderApp();
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        resetSessionState();
        renderApp({
          type: "error",
          text: error.message || "Your session has ended. Please log in again."
        });
        return;
      }

      // Ignore other background refresh failures and let the next explicit action surface errors.
    }
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const error = new Error((payload && payload.error) || "Something went wrong.");
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  function applyDashboardPayload(payload) {
    const previousUserId = state.user ? state.user.id : "";
    const previousZoomMode = state.zoomMode;
    state.user = payload.user;
    state.classes = payload.classes || [];
    state.submissions = payload.submissions || [];
    state.assignments = payload.assignments || [];
    state.assignmentSubmissions = payload.assignmentSubmissions || [];
    state.students = payload.students || [];
    state.managedUsers = payload.managedUsers || [];
    state.zoomConfigured = Boolean(payload.zoomConfigured);
    state.googleMeetConfigured = Boolean(payload.googleMeetConfigured);
    state.teamsSupported = payload.teamsSupported !== false;
    state.aiStatus = payload.aiStatus || state.aiStatus;

    if (!state.zoomConfigured) {
      state.zoomMode = "manual";
    } else if (state.user.role === "teacher" && previousUserId === state.user.id && previousZoomMode === "manual") {
      state.zoomMode = "manual";
    } else {
      state.zoomMode = "auto";
    }

    state.dashboardTab = isDashboardTab(state.dashboardTab) ? state.dashboardTab : "meetings";
    state.progressPeriod = state.progressPeriod === "month" ? "month" : "all";
    state.authRole = ["student", "teacher", "admin"].includes(state.user.role) ? state.user.role : "teacher";

    if (state.user.role === "teacher") {
      state.meetingProvider = ["none", "zoom", "meet", "teams"].includes(state.meetingProvider) ? state.meetingProvider : "none";
      if (state.selectedClassId && !state.classes.some((classItem) => classItem.id === state.selectedClassId)) {
        state.selectedClassId = null;
        state.isEditingClass = false;
      }
      const validStudentIds = new Set(state.students.map((student) => student.id));
      if (state.selectedCalendarStudentId !== "all" && !validStudentIds.has(state.selectedCalendarStudentId)) {
        state.selectedCalendarStudentId = "all";
      }
    } else if (state.user.role === "student") {
      state.selectedClassId = null;
      state.isEditingClass = false;
      state.selectedCalendarStudentId = state.user.id;
    } else {
      state.selectedClassId = null;
      state.isEditingClass = false;
      state.selectedCalendarStudentId = "all";
    }
  }

  function formatDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Date unavailable";
    }

    return parsed.toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  function formatDateTimeLocalInput(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }

    const localTime = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60 * 1000));
    return localTime.toISOString().slice(0, 16);
  }

  function formatTime(value) {
    return new Date(value).toLocaleString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function formatMonthLabel(date) {
    return date.toLocaleString([], {
      month: "long",
      year: "numeric"
    });
  }

  function formatWeekRange(date) {
    const start = getStartOfWeek(date);
    const end = getEndOfWeek(date);
    const sameMonth = start.getMonth() === end.getMonth();
    const sameYear = start.getFullYear() === end.getFullYear();

    if (sameMonth && sameYear) {
      return `${start.toLocaleString([], { month: "short" })} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
    }

    return `${start.toLocaleString([], { month: "short", day: "numeric" })} - ${end.toLocaleString([], { month: "short", day: "numeric", year: "numeric" })}`;
  }

  function formatWeekday(date) {
    return date.toLocaleString([], { weekday: "short" });
  }

  function formatDayNumber(date) {
    return date.toLocaleString([], { day: "numeric", month: "short" });
  }

  function getMeetingOptions() {
    return [
      { value: "zoom-auto", label: "Create Zoom class link automatically", needs: "zoom" },
      { value: "meet-auto", label: "Create Google Meet link automatically", needs: "meet" },
      { value: "zoom-manual", label: "Paste existing Zoom link" },
      { value: "meet-manual", label: "Paste existing Google Meet link" },
      { value: "teams-manual", label: "Paste existing Teams link" },
      { value: "none", label: "Add later" }
    ].filter((option) => {
      if (option.needs === "zoom") {
        return state.zoomConfigured;
      }

      if (option.needs === "meet") {
        return state.googleMeetConfigured;
      }

      return true;
    });
  }

  function isAutoMeetingOption(value) {
    return String(value || "").endsWith("-auto");
  }

  function getDefaultMeetingOption() {
    if (state.zoomConfigured) {
      return "zoom-auto";
    }

    return state.googleMeetConfigured ? "meet-auto" : "zoom-manual";
  }

  function getMeetingModeHint() {
    const autoProviders = [
      state.zoomConfigured ? "Zoom" : "",
      state.googleMeetConfigured ? "Google Meet" : ""
    ].filter(Boolean);

    if (!autoProviders.length) {
      return "Automatic link creation is not active right now, so paste a link from Zoom, Google Meet, or Teams, or leave it for later.";
    }

    return `Choose auto-create to let the app create the ${autoProviders.join(" or ")} link, or paste a link from Zoom, Google Meet, or Teams.`;
  }

  function getMeetingOptionProvider(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "none") {
      return "none";
    }

    const provider = normalized.split("-")[0];
    return ["zoom", "meet", "teams"].includes(provider) ? provider : "zoom";
  }

  function isManualMeetingOption(value) {
    return String(value || "").endsWith("-manual");
  }

  function parseMeetingOption(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "none") {
      return { meetingProvider: "none", meetingMode: "none" };
    }

    const meetingProvider = getMeetingOptionProvider(normalized);
    if (isAutoMeetingOption(normalized) && isAutoMeetingAvailable(meetingProvider)) {
      return { meetingProvider, meetingMode: "auto" };
    }

    return { meetingProvider, meetingMode: "manual" };
  }

  function isAutoMeetingAvailable(provider) {
    if (provider === "zoom") {
      return state.zoomConfigured;
    }

    return provider === "meet" ? state.googleMeetConfigured : false;
  }

  function getManualLinkCopy(provider) {
    if (provider === "meet") {
      return {
        label: "Google Meet Link",
        placeholder: "Optional: paste Google Meet link",
        hint: "Paste the Google Meet link, or just the abc-defg-hij meeting code. Students will use the Join Class button to open it."
      };
    }

    if (provider === "teams") {
      return {
        label: "Teams Link",
        placeholder: "Optional: paste Teams link",
        hint: "Paste the Teams join link if the meeting is already created. Students will use the Join Class button to open it."
      };
    }

    return {
      label: "Zoom Class Link",
      placeholder: "Optional: paste Zoom link",
      hint: "Paste the Zoom link if the class is already created. Students will use the Join Class button to open it."
    };
  }

  function getAuthRoleLabel() {
    return "account";
  }

  function getAuthEmailPlaceholder() {
    return "you@example.com";
  }

  function formatAdminRoleLabel(role) {
    if (role === "teacher") {
      return "Teacher";
    }

    if (role === "student") {
      return "Student";
    }

    return "User";
  }

  function getActivationStatusLabel(status) {
    if (status === "active") {
      return "Active";
    }

    if (status === "inactive") {
      return "Deactivated";
    }

    return "Pending Approval";
  }

  function getClassTitle(classItem) {
    const topic = String(classItem.topic || "").trim();
    if (topic) {
      return topic;
    }

    return `${classItem.subject || "Class"} session`;
  }

  function getPrimaryStudentId(classItem) {
    if (Array.isArray(classItem.studentIds) && classItem.studentIds.length) {
      return classItem.studentIds[0];
    }

    return "";
  }

  function getDefaultSeriesMonthBounds() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      start: createDateKey(start),
      end: createDateKey(end)
    };
  }

  function buildClassSaveMessage(classItem, fallbackMessage) {
    if (!classItem) {
      return fallbackMessage;
    }

    const classTitle = getClassTitle(classItem);
    const kidNames = formatStudentNames(classItem.studentNames);
    return `${fallbackMessage} ${classTitle} for ${kidNames} on ${formatDate(classItem.dateTime)}.`;
  }

  function renderClassDetails(value) {
    const details = String(value || "").trim().replace(/\s+/g, " ");
    if (!details) {
      return "";
    }

    const compactDetails = details.length > 140
      ? `${details.slice(0, 137).trimEnd()}...`
      : details;

    return `<p class="class-details">${escapeHtml(compactDetails)}</p>`;
  }

  function renderKidBadges(classItem) {
    if (!Array.isArray(classItem.studentNames) || !classItem.studentNames.length) {
      return "";
    }

    return `
      <div class="kid-badges">
        ${classItem.studentNames.map((studentName, index) => {
          const studentId = Array.isArray(classItem.studentIds) ? classItem.studentIds[index] : studentName;
          const palette = getStudentPalette(studentId || studentName);
          return `<span class="kid-badge" style="${escapeAttribute(getPaletteStyle(palette))}">${escapeHtml(studentName)}</span>`;
        }).join("")}
      </div>
    `;
  }

  function getBookingAccentStyle(classItem) {
    const palette = getStudentPalette(
      Array.isArray(classItem.studentIds) && classItem.studentIds.length
        ? classItem.studentIds[0]
        : (Array.isArray(classItem.studentNames) && classItem.studentNames.length ? classItem.studentNames[0] : classItem.subject)
    );
    return getPaletteStyle(palette);
  }

  function getPaletteStyle(palette) {
    return `--accent-spot:${palette.base};--accent-soft:${palette.soft};--accent-border:${palette.border};--accent-text:${palette.text};`;
  }

  function getStudentPalette(seed) {
    const palettes = [
      { base: "#ff8a65", soft: "#fff0ea", border: "#ffbcab", text: "#9a3412" },
      { base: "#4fc3f7", soft: "#edf9ff", border: "#b6e8ff", text: "#075985" },
      { base: "#81c784", soft: "#eefaf1", border: "#bde6c3", text: "#166534" },
      { base: "#ffd54f", soft: "#fff8dd", border: "#f8e08e", text: "#92400e" },
      { base: "#ba68c8", soft: "#faf1fc", border: "#e6c5ec", text: "#7e22ce" },
      { base: "#f06292", soft: "#fff0f6", border: "#f7bfd0", text: "#be185d" }
    ];
    const text = String(seed || "bowser");
    let total = 0;
    for (const character of text) {
      total += character.charCodeAt(0);
    }

    return palettes[total % palettes.length];
  }

  function getEditableMeetingOption(classItem) {
    const provider = getClassMeetingProvider(classItem);
    if (provider === "none") {
      return "none";
    }

    if (wasAutoCreated(classItem) && isAutoMeetingAvailable(provider)) {
      return `${provider}-auto`;
    }

    return `${provider}-manual`;
  }

  function wasAutoCreated(classItem) {
    return Boolean(classItem.autoMeetingId || classItem.zoomMeetingId);
  }

  function isDashboardTab(tab) {
    return ["meetings", "homework", "coach", "progress"].includes(tab);
  }

  function getClassEndTime(classItem) {
    const startTime = new Date(classItem.dateTime).getTime();
    if (Number.isNaN(startTime)) {
      return NaN;
    }

    const durationMinutes = Number(classItem.durationMinutes || 45);
    return startTime + (Math.max(durationMinutes, 15) * 60 * 1000);
  }

  function isConductedClass(classItem) {
    const endTime = getClassEndTime(classItem);
    return Number.isFinite(endTime) && endTime < Date.now();
  }

  function isClassInCurrentMonth(classItem) {
    const classDate = new Date(classItem.dateTime);
    if (Number.isNaN(classDate.getTime())) {
      return false;
    }

    const now = new Date();
    return classDate.getFullYear() === now.getFullYear() && classDate.getMonth() === now.getMonth();
  }

  function getProgressPeriodClasses(classes) {
    const list = Array.isArray(classes) ? classes : [];
    if (state.progressPeriod === "month") {
      return list.filter(isClassInCurrentMonth);
    }
    return list;
  }

  function getProgressScopedClasses(classes) {
    return getFilteredCalendarClasses(getProgressPeriodClasses(classes));
  }

  function getClassProgress(classes) {
    const list = Array.isArray(classes) ? classes.filter((classItem) => Number.isFinite(new Date(classItem.dateTime).getTime())) : [];
    const conducted = list.filter(isConductedClass);
    const upcoming = list.filter((classItem) => !isConductedClass(classItem));
    const scheduled = list.length;
    const percent = scheduled ? Math.round((conducted.length / scheduled) * 100) : 0;
    return { scheduled, conducted, upcoming, percent };
  }

  function getUniqueTopics(classes) {
    const seen = new Set();
    const topics = [];
    (classes || []).forEach((classItem) => {
      const label = getClassTitle(classItem);
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        topics.push({ label, classItem });
      }
    });
    return topics;
  }

  function getKidProgressRows(classes) {
    return (state.students || []).map((student) => {
      const kidClasses = (classes || []).filter((classItem) =>
        Array.isArray(classItem.studentIds) && classItem.studentIds.includes(student.id)
      );
      const stats = getClassProgress(kidClasses);
      const lastDone = [...stats.conducted].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0] || null;
      return {
        student,
        stats,
        lastTopic: lastDone ? getClassTitle(lastDone) : "—"
      };
    });
  }

  function isCurrentOrUpcomingClass(classItem) {
    const startTime = new Date(classItem.dateTime).getTime();
    if (Number.isNaN(startTime)) {
      return false;
    }

    if (isSameDay(new Date(classItem.dateTime), new Date())) {
      return true;
    }

    const durationMinutes = Number(classItem.durationMinutes || 45);
    const endTime = startTime + (Math.max(durationMinutes, 15) * 60 * 1000);
    return endTime >= Date.now();
  }

  function getMeetingProviderLabel(provider) {
    if (provider === "teams") {
      return "Teams";
    }

    if (provider === "meet") {
      return "Google Meet";
    }

    if (provider === "none") {
      return "No Class Link";
    }

    return "Zoom";
  }

  function getClassMeetingProvider(classItem) {
    if (classItem.meetingProvider === "teams") {
      return "teams";
    }

    if (classItem.meetingProvider === "meet") {
      return "meet";
    }

    if (classItem.meetingProvider === "none" || !(classItem.meetingLink || classItem.zoomLink)) {
      return "none";
    }

    return "zoom";
  }

  function getClassMeetingLink(classItem) {
    return safeExternalUrl(classItem.meetingLink || classItem.zoomLink || "");
  }

  function getReadableMeetingLink(classItem) {
    return classItem.meetingLink || classItem.zoomLink || "No class link saved yet";
  }

  function getMeetingStatus(classItem, provider) {
    if (provider === "none") {
      return { tone: "pending", label: "Class link pending" };
    }

    const link = classItem.meetingLink || classItem.zoomLink || "";
    if (!link) {
      return { tone: "pending", label: `${getMeetingProviderLabel(provider)} link pending` };
    }

    if (wasAutoCreated(classItem)) {
      return { tone: "ready auto", label: `${getMeetingProviderLabel(provider)} class link ready` };
    }

    return { tone: "ready", label: `${getMeetingProviderLabel(provider)} class ready` };
  }

  function getMeetingActionLabel(provider, role) {
    if (provider === "none") {
      return "Link Pending";
    }

    return "Join Class";
  }

  function getMeetingUnavailableLabel(provider) {
    return provider === "none" ? "Class link pending" : "Class link unavailable";
  }

  function getCalendarEventMeta(classItem, meetingProvider) {
    const base = `${classItem.subject || "Class"} with ${classItem.teacherName || state.user.name}`;
    return meetingProvider === "none" ? `${base} without a class link yet` : `${base} on ${getMeetingProviderLabel(meetingProvider)}`;
  }

  function safeExternalUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "";
      }

      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function createDateKey(date) {
    const localDate = new Date(date);
    return [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0")
    ].join("-");
  }

  function getCalendarCursorDate() {
    return parseDateKey(state.calendarCursor);
  }

  // The server stores absolute instants, but the teacher types a wall clock.
  // Sending the browser zone keeps 4pm meaning 4pm wherever the app is hosted.
  function getBrowserTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_error) {
      return "";
    }
  }

  function focusCalendarOn(dateTime) {
    const target = new Date(dateTime);
    if (!Number.isNaN(target.getTime())) {
      state.calendarCursor = createDateKey(target);
    }
  }

  function parseDateKey(value) {
    const [year, month, day] = String(value || "").split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1, 12);
  }

  function getStartOfWeek(date) {
    const start = new Date(date);
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset);
    start.setHours(12, 0, 0, 0);
    return start;
  }

  function getEndOfWeek(date) {
    const end = getStartOfWeek(date);
    end.setDate(end.getDate() + 6);
    return end;
  }

  function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate();
  }

  function shiftCalendar(direction) {
    const next = getCalendarCursorDate();
    if (state.calendarView === "month") {
      next.setMonth(next.getMonth() + direction, 1);
    } else {
      next.setDate(next.getDate() + (direction * 7));
    }

    state.calendarCursor = createDateKey(next);
    renderApp();
  }

  function getClassesForDate(classes, date) {
    return classes
      .filter((classItem) => isSameDay(new Date(classItem.dateTime), date))
      .sort((left, right) => new Date(left.dateTime) - new Date(right.dateTime));
  }

  function getCalendarStudentOptions() {
    return state.students || [];
  }

  // Only active kids can be attached to a class or an activity — the API rejects
  // the rest, so they must never appear as a pickable option.
  function getSchedulableStudents() {
    return (state.students || []).filter((student) => student.isActive);
  }

  function getPendingStudents() {
    return (state.students || []).filter((student) => !student.isActive);
  }

  function renderPendingKidsHint() {
    const pending = getPendingStudents();
    if (!pending.length) {
      return "";
    }

    const names = pending.map((student) => student.name).join(", ");
    return `<div class="field-hint">Waiting for admin activation: ${escapeHtml(names)}. Activate them before scheduling.</div>`;
  }

  function getSelectedCalendarStudent() {
    if (state.selectedCalendarStudentId === "all") {
      return null;
    }

    return getCalendarStudentOptions().find((student) => student.id === state.selectedCalendarStudentId) || null;
  }

  function getFilteredCalendarClasses(classes) {
    if (state.user.role !== "teacher" || state.selectedCalendarStudentId === "all") {
      return classes;
    }

    return classes.filter((classItem) =>
      Array.isArray(classItem.studentIds) && classItem.studentIds.includes(state.selectedCalendarStudentId)
    );
  }

  function getCalendarWindowClasses(classes) {
    const cursor = getCalendarCursorDate();
    const start = state.calendarView === "month"
      ? getStartOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12))
      : getStartOfWeek(cursor);
    const end = state.calendarView === "month"
      ? getEndOfWeek(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12))
      : getEndOfWeek(cursor);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    return classes.filter((classItem) => {
      const classDate = new Date(classItem.dateTime);
      return classDate >= start && classDate <= end;
    });
  }

  function formatStudentNames(studentNames) {
    if (!Array.isArray(studentNames) || !studentNames.length) {
      return "All assigned kids";
    }

    return studentNames.join(", ");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
