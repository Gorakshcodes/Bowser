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
  const state = {
    user: null,
    classes: [],
    submissions: [],
    students: [],
    managedUsers: [],
    zoomConfigured: false,
    googleMeetConfigured: false,
    teamsSupported: true,
    message: null,
    authMode: "login",
    authRole: "teacher",
    registerRole: "student",
    meetingProvider: "none",
    zoomMode: "manual",
    dashboardTab: "meetings",
    calendarView: "week",
    calendarCursor: createDateKey(new Date()),
    selectedCalendarStudentId: "all",
    activeMeetingEditorId: null,
    selectedClassId: null,
    isEditingClass: false,
    scheduleMode: "once",
    seriesPattern: "weekdays",
    seriesTimes: ["16:00"]
  };

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
      app.innerHTML = renderLogin();
      return;
    }

    app.innerHTML = state.user.role === "admin"
      ? renderAdminDashboard()
      : state.user.role === "teacher"
        ? renderTeacherDashboard()
        : renderStudentDashboard();
  }

  function renderLogin() {
    return `
      <section class="welcome-shell">
        <div class="welcome-copy">
          <div class="brand-mark" aria-hidden="true">B</div>
          <span class="eyebrow">Bowser</span>
          <h1>Learning Portal</h1>
          <p class="panel-subtitle">Classes, schedules, and homework in one calm place.</p>
          <div class="role-switch" aria-label="Choose account type">
            <button class="role-card ${state.authRole === "teacher" ? "is-active" : ""}" type="button" data-action="set-auth-role" data-role="teacher">
              <strong>Teacher</strong>
              <span>Schedule & review</span>
            </button>
            <button class="role-card ${state.authRole === "student" ? "is-active" : ""}" type="button" data-action="set-auth-role" data-role="student">
              <strong>Kid</strong>
              <span>Join & homework</span>
            </button>
            <button class="role-card ${state.authRole === "admin" ? "is-active" : ""}" type="button" data-action="set-auth-role" data-role="admin">
              <strong>Admin</strong>
              <span>Accounts</span>
            </button>
          </div>
        </div>

        <div class="surface auth-panel">
          <div class="auth-switch">
            <button class="btn ${state.authMode === "login" ? "primary" : "secondary"}" type="button" data-action="set-auth-mode" data-mode="login">Login</button>
            ${state.authRole === "admin"
              ? ""
              : `<button class="btn ${state.authMode === "register" ? "primary" : "secondary"}" type="button" data-action="set-auth-mode" data-mode="register">Sign up</button>`}
          </div>
          <h2 class="panel-title">${state.authMode === "register" ? `Create ${getAuthRoleLabel()} account` : `${getAuthRoleLabel()} login`}</h2>
          <p class="panel-subtitle">
            ${state.authMode === "register"
              ? "New accounts need admin approval before login."
              : "Use your email and password to continue."}
          </p>
          ${state.authMode === "register" && state.authRole !== "admin" ? renderRegisterForm() : renderLoginForm()}
          ${renderMessage()}
        </div>
      </section>
    `;
  }

  function renderLoginForm() {
    return `
      <form class="form-grid" data-form="login" autocomplete="on">
        <input name="role" type="hidden" value="${escapeAttribute(state.authRole)}">
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" name="email" type="email" placeholder="${getAuthEmailPlaceholder()}" required autocomplete="username">
        </div>
        <div class="field">
          <label for="login-password">Password</label>
          <input id="login-password" name="password" type="password" placeholder="Your password" required autocomplete="current-password">
        </div>
        <button class="btn primary" type="submit">Sign in</button>
      </form>
    `;
  }

  function renderRegisterForm() {
    return `
      <form class="form-grid" data-form="register" autocomplete="on">
        <input name="role" type="hidden" value="${escapeAttribute(state.authRole)}">
        <div class="field">
          <label for="register-name">${state.authRole === "student" ? "Kid's name" : "Teacher name"}</label>
          <input id="register-name" name="name" type="text" maxlength="80" placeholder="${state.authRole === "student" ? "e.g. Diya" : "Your name"}" required>
        </div>
        <div class="field" ${state.authRole === "teacher" ? "" : "hidden"}>
          <label for="register-subject">Subject</label>
          <input id="register-subject" name="subject" type="text" maxlength="80" placeholder="e.g. Maths">
        </div>
        <div class="field">
          <label for="register-email">Email</label>
          <input id="register-email" name="email" type="email" maxlength="254" placeholder="email@example.com" required autocomplete="email">
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
            <p class="panel-subtitle">${teacherClasses.length} classes · ${state.students.length} kids · ${reviewedCount} homework reviewed</p>
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
                  <h3>Upcoming</h3>
                  <p class="panel-subtitle">Next classes at a glance</p>
                </div>
              </div>
              <div class="section-stack">
                ${upcomingTeacherClasses.length ? upcomingTeacherClasses.slice(0, 8).map(renderTeacherClassCard).join("") : renderEmptyState("No upcoming classes", "Schedule a class or a monthly series to fill this list.")}
              </div>
            </section>
          </div>
        ` : `
          <section class="card">
            <div class="section-heading">
              <div>
                <h3>Homework</h3>
                <p class="panel-subtitle">${teacherSubmissions.length - reviewedCount} waiting · ${reviewedCount} reviewed</p>
              </div>
            </div>
            <div class="section-stack">
              ${teacherSubmissions.length ? teacherSubmissions.map(renderTeacherSubmissionCard).join("") : renderEmptyState("No homework yet", "Student uploads will show up here.")}
            </div>
          </section>
        `}
        ${renderMessage()}
      </section>
    `;
  }

  function renderStudentDashboard() {
    const classes = [...state.classes].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    const upcomingClasses = classes.filter(isCurrentOrUpcomingClass);
    const submissions = [...state.submissions].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    const calendarClasses = getFilteredCalendarClasses(classes);
    const nextClass = upcomingClasses[0] || null;
    const stars = submissions.filter((submission) => submission.score).length;

    return `
      <section class="surface kid-shell">
        <div class="dashboard-header kid-header">
          <div>
            <span class="eyebrow kid-eyebrow">Hi there 👋</span>
            <h2 class="panel-title">${escapeHtml(state.user.name)}</h2>
            <p class="panel-subtitle">Your classes and homework live here.</p>
          </div>
          <div class="dashboard-actions">
            <span class="kid-chip">📚 ${classes.length} classes</span>
            <span class="kid-chip">⭐ ${stars} stars</span>
            <button class="btn ghost" type="button" data-action="logout">Logout</button>
          </div>
        </div>
        ${renderDashboardTabs({ kid: true })}
        ${state.dashboardTab === "meetings" ? `
          ${nextClass ? `
            <section class="card kid-hero-card">
              <div class="kid-hero">
                <div>
                  <span class="kid-label">Next class</span>
                  <h3>${escapeHtml(getClassTitle(nextClass))}</h3>
                  <p>${escapeHtml(formatDate(nextClass.dateTime))} · with ${escapeHtml(nextClass.teacherName || "your teacher")}</p>
                </div>
                <div class="kid-hero-actions">
                  ${renderExternalAction(
                    getClassMeetingLink(nextClass),
                    "primary kid-join",
                    "Join class 🚀",
                    "Link coming soon"
                  )}
                </div>
              </div>
            </section>
          ` : renderEmptyState("No classes yet", "When your teacher schedules a class, it will show up here.")}

          <section class="card calendar-card kid-calendar">
            <div class="calendar-header">
              <div>
                <h3>My calendar</h3>
                <p class="panel-subtitle">See what’s coming this week or month</p>
              </div>
            </div>
            ${renderCalendarControls({
              title: state.calendarView === "month" ? formatMonthLabel(getCalendarCursorDate()) : formatWeekRange(getCalendarCursorDate()),
              showKidFilter: false
            })}
            ${renderCalendarGrid(calendarClasses)}
          </section>

          <section class="card">
            <h3>Coming up</h3>
            <div class="section-stack kid-class-list">
              ${upcomingClasses.length ? upcomingClasses.map(renderStudentClassCard).join("") : renderEmptyState("Nothing scheduled", "Enjoy the free time — or check back soon!")}
            </div>
          </section>
        ` : `
          <div class="dashboard-columns">
            <section class="card kid-card">
              <h3>Send homework 📸</h3>
              <p class="panel-subtitle">Snap a photo or pick one from your gallery.</p>
              <div class="section-stack">
                ${classes.length ? classes.map(renderStudentHomeworkCard).join("") : renderEmptyState("No classes yet", "Homework unlocks after a class is scheduled.")}
              </div>
            </section>

            <section class="card kid-card">
              <h3>My results 🌟</h3>
              <p class="panel-subtitle">Scores and teacher notes</p>
              <div class="section-stack">
                ${submissions.length ? submissions.map(renderStudentSubmissionCard).join("") : renderEmptyState("No uploads yet", "Send a homework photo to see feedback here.")}
              </div>
            </section>
          </div>
        `}
        ${renderMessage()}
      </section>
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
            <select id="studentIds" name="studentIds" ${state.students.length ? "required" : "disabled"}>
              <option value="">${state.students.length ? "Select kid" : "No kids yet"}</option>
              ${state.students.map((student) => `
                <option value="${escapeAttribute(student.id)}"${formStudentId === student.id ? " selected" : ""}>${escapeHtml(student.name)}</option>
              `).join("")}
            </select>
            ${state.students.length ? "" : '<p class="calendar-empty">Create and activate student accounts first.</p>'}
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
      </section>
    `;
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

  function renderStudentClassCard(classItem) {
    const existingSubmission = state.submissions.find((submission) => submission.classId === classItem.id);
    const meetingProvider = getClassMeetingProvider(classItem);
    const meetingLink = getClassMeetingLink(classItem);
    const driveLink = safeExternalUrl(classItem.driveLink);
    return `
      <article class="card kid-class-card">
        <div class="card__top">
          <div>
            <h3>${escapeHtml(getClassTitle(classItem))}</h3>
            <p class="panel-subtitle">${escapeHtml(formatDate(classItem.dateTime))}</p>
          </div>
          <span class="status-pill ${existingSubmission ? "" : "pending"}">${existingSubmission ? "HW done ✓" : "HW open"}</span>
        </div>
        <div class="card__meta">
          <span>Teacher: ${escapeHtml(classItem.teacherName || "Teacher")}</span>
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary kid-join", "Join class 🚀", getMeetingUnavailableLabel(meetingProvider))}
          ${driveLink ? renderExternalAction(driveLink, "secondary", "Materials", "No materials") : ""}
        </div>
      </article>
    `;
  }

  function renderStudentHomeworkCard(classItem) {
    const existingSubmission = state.submissions.find((submission) => submission.classId === classItem.id);
    const driveLink = safeExternalUrl(classItem.driveLink);

    return `
      <article class="card card--soft kid-card">
        <div class="card__top">
          <div>
            <h3>${escapeHtml(getClassTitle(classItem))}</h3>
            <p class="panel-subtitle">${escapeHtml(formatDate(classItem.dateTime))}</p>
          </div>
          <span class="status-pill ${existingSubmission ? "" : "pending"}">${existingSubmission ? "Sent ✓" : "To do"}</span>
        </div>
        <div class="card__meta">
          <span>Teacher: ${escapeHtml(classItem.teacherName || "Teacher")}</span>
          ${driveLink ? `<span>Materials ready</span>` : ""}
        </div>
        ${existingSubmission && existingSubmission.feedback ? `
          <div class="feedback-note">
            <strong>Teacher comment</strong>
            <p>${escapeHtml(existingSubmission.feedback)}</p>
          </div>
        ` : ""}
        <form class="form-grid" data-form="upload-homework" data-class-id="${classItem.id}">
          <div class="field">
            <label for="homework-${classItem.id}">${existingSubmission ? "Send a new photo" : "Pick a homework photo"}</label>
            <input id="homework-${classItem.id}" name="homework" type="file" accept="image/*" capture="environment" required>
          </div>
          <button class="btn primary kid-join" type="submit">${existingSubmission ? "Update ✨" : "Send homework 📤"}</button>
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
    const statusText = submission.score ? `Ranked ${escapeHtml(submission.score)}` : "Waiting for teacher";

    return `
      <article class="submission-card">
        <div class="submission-top">
          <div>
            <h3>${linkedClass ? escapeHtml(getClassTitle(linkedClass)) : "Submitted homework"}</h3>
            <p>${escapeHtml(submission.subject)} with ${linkedClass ? escapeHtml(linkedClass.teacherName) : "your teacher"}</p>
          </div>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <img class="homework-preview" src="${escapeAttribute(submission.imageUrl)}" alt="Homework uploaded by student">
        <div class="submission-meta">
          <span><strong>Uploaded:</strong> ${formatDate(submission.submittedAt)}</span>
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
    return `
      <div class="tab-bar${kid ? " tab-bar--kid" : ""}" role="tablist" aria-label="Dashboard sections">
        <button class="tab-pill ${state.dashboardTab === "meetings" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "meetings"}" data-action="set-dashboard-tab" data-tab="meetings">${kid ? "My classes" : "Classes"}</button>
        <button class="tab-pill ${state.dashboardTab === "homework" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "homework"}" data-action="set-dashboard-tab" data-tab="homework">Homework</button>
      </div>
    `;
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
      state.authMode = actionButton.dataset.mode === "register" && state.authRole !== "admin" ? "register" : "login";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "set-auth-role") {
      state.authRole = ["student", "teacher", "admin"].includes(actionButton.dataset.role) ? actionButton.dataset.role : "teacher";
      state.registerRole = state.authRole;
      if (state.authRole === "admin") {
        state.authMode = "login";
      }
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "set-dashboard-tab") {
      state.dashboardTab = actionButton.dataset.tab === "homework" ? "homework" : "meetings";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "edit-class") {
      state.selectedClassId = actionButton.dataset.classId || null;
      state.isEditingClass = false;
      state.dashboardTab = "meetings";
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "cancel-class-edit") {
      state.isEditingClass = false;
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "start-class-edit") {
      state.isEditingClass = true;
      renderApp();
      return;
    }

    if (actionButton.dataset.action === "clear-class-selection") {
      state.selectedClassId = null;
      state.isEditingClass = false;
      renderApp();
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
    state.selectedCalendarStudentId = "all";
    state.calendarView = "week";
    state.calendarCursor = createDateKey(new Date());
    state.selectedClassId = null;
    state.isEditingClass = false;
    state.scheduleMode = "once";
    state.seriesPattern = "weekdays";
    state.seriesTimes = ["16:00"];
  }

  function handleChange(event) {
    if (event.target.name === "meetingMode") {
      refreshMeetingModeFields(event.target.form);
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
          role: String(formData.get("role") || state.authRole || "").trim(),
          email: String(formData.get("email") || "").trim(),
          password: String(formData.get("password") || "").trim()
        })
      });

      applyDashboardPayload(payload.dashboard);
      renderApp({ type: "success", text: `Welcome back, ${payload.user.name}.` });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function registerUser(formData) {
    try {
      const payload = await api("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: String(formData.get("role") || "student").trim(),
          name: String(formData.get("name") || "").trim(),
          subject: String(formData.get("subject") || "").trim(),
          email: String(formData.get("email") || "").trim(),
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

  async function updateClass(formData) {
    try {
      const manualMeetingLink = String(formData.get("manualMeetingLink") || "").trim();
      const { meetingProvider, meetingMode } = parseMeetingOption(formData.get("meetingMode"));
      const payload = {
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
      const studentsChanged = JSON.stringify(state.students) !== JSON.stringify(payload.students || []);
      const managedUsersChanged = JSON.stringify(state.managedUsers) !== JSON.stringify(payload.managedUsers || []);

      applyDashboardPayload(payload);

      if (classesChanged || submissionsChanged || studentsChanged || managedUsersChanged) {
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
    state.students = payload.students || [];
    state.managedUsers = payload.managedUsers || [];
    state.zoomConfigured = Boolean(payload.zoomConfigured);
    state.googleMeetConfigured = Boolean(payload.googleMeetConfigured);
    state.teamsSupported = payload.teamsSupported !== false;

    if (!state.zoomConfigured) {
      state.zoomMode = "manual";
    } else if (state.user.role === "teacher" && previousUserId === state.user.id && previousZoomMode === "manual") {
      state.zoomMode = "manual";
    } else {
      state.zoomMode = "auto";
    }

    state.dashboardTab = ["meetings", "homework"].includes(state.dashboardTab) ? state.dashboardTab : "meetings";
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
    if (state.authRole === "student") {
      return "kid";
    }

    if (state.authRole === "admin") {
      return "admin";
    }

    return "teacher";
  }

  function getAuthEmailPlaceholder() {
    if (state.authRole === "student") {
      return "student@example.com";
    }

    if (state.authRole === "admin") {
      return "admin@example.com";
    }

    return "teacher@example.com";
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
