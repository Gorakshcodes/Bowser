(function () {
  const SESSION_KEY = "bowser-learning-session";
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
    isEditingClass: false
  };

  initialize();

  app.addEventListener("submit", handleSubmit);
  app.addEventListener("click", handleClick);
  app.addEventListener("change", handleChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", handleWindowFocus);
  window.setInterval(refreshActiveSessionSilently, DASHBOARD_REFRESH_MS);

  async function initialize() {
    const session = readSession();
    if (!session || !session.userId) {
      renderApp();
      return;
    }

    try {
      await refreshDashboard(session.userId);
    } catch (_error) {
      clearSession();
      renderApp({
        type: "error",
        text: "Your session expired. Please log in again."
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
        <div class="welcome-copy welcome-copy--centered">
          <div class="welcome-mark" aria-hidden="true">
            <div class="welcome-mark__halo"></div>
            <div class="welcome-mark__core">
              <span class="welcome-mark__mind"></span>
              <span class="welcome-mark__dragon">
                <span class="welcome-mark__dragon-wing welcome-mark__dragon-wing--left"></span>
                <span class="welcome-mark__dragon-wing welcome-mark__dragon-wing--right"></span>
                <span class="welcome-mark__dragon-head"></span>
                <span class="welcome-mark__dragon-eye"></span>
              </span>
              <span class="welcome-mark__letter">B</span>
            </div>
          </div>
          <span class="eyebrow">Bowser</span>
          <h1>Learning Workspace</h1>
          <p class="panel-subtitle">Sign in to manage classes, schedules, and homework.</p>
          <div class="role-switch" aria-label="Choose account type">
            <button class="role-card ${state.authRole === "teacher" ? "is-active" : ""}" type="button" data-action="set-auth-role" data-role="teacher">
              <strong>Teacher</strong>
              <span>Classes, schedules, feedback</span>
            </button>
            <button class="role-card ${state.authRole === "student" ? "is-active" : ""}" type="button" data-action="set-auth-role" data-role="student">
              <strong>Student</strong>
              <span>Classes, joins, homework</span>
            </button>
            <button class="role-card ${state.authRole === "admin" ? "is-active" : ""}" type="button" data-action="set-auth-role" data-role="admin">
              <strong>Admin</strong>
              <span>Approve and manage accounts</span>
            </button>
          </div>
        </div>

        <div class="surface auth-panel">
          <div class="auth-switch">
            <button class="btn ${state.authMode === "login" ? "primary" : "secondary"}" type="button" data-action="set-auth-mode" data-mode="login">Login</button>
            ${state.authRole === "admin"
              ? ""
              : `<button class="btn ${state.authMode === "register" ? "primary" : "secondary"}" type="button" data-action="set-auth-mode" data-mode="register">Create Account</button>`}
          </div>
          <h2 class="panel-title">${state.authMode === "register" ? `Create ${getAuthRoleLabel()} account` : `Login as ${getAuthRoleLabel()}`}</h2>
          <p class="panel-subtitle">
            ${state.authMode === "register"
              ? `Set up a ${state.authRole} account to enter the learning app.`
              : state.authRole === "admin"
                ? "Use the admin email and password to approve teacher and student accounts."
                : `Use your ${state.authRole} email and password to continue.`}
          </p>
          ${state.authMode === "register" && state.authRole !== "admin" ? renderRegisterForm() : renderLoginForm()}
          ${renderMessage()}
        </div>
      </section>
    `;
  }

  function renderLoginForm() {
    return `
      <form class="form-grid" data-form="login">
        <input name="role" type="hidden" value="${escapeAttribute(state.authRole)}">
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" name="email" type="email" placeholder="${getAuthEmailPlaceholder()}" required>
        </div>
        <div class="field">
          <label for="login-password">Password</label>
          <input id="login-password" name="password" type="password" placeholder="Enter your password" required>
        </div>
        <button class="btn primary" type="submit">Enter Portal</button>
      </form>
    `;
  }

  function renderRegisterForm() {
    return `
      <form class="form-grid" data-form="register">
        <input name="role" type="hidden" value="${escapeAttribute(state.authRole)}">
        <div class="field">
          <label for="register-name">${state.authRole === "student" ? "Student Name" : "Teacher Name"}</label>
          <input id="register-name" name="name" type="text" placeholder="${state.authRole === "student" ? "Enter student name" : "Enter teacher name"}" required>
        </div>
        <div class="field" ${state.authRole === "teacher" ? "" : "hidden"}>
          <label for="register-subject">Subject</label>
          <input id="register-subject" name="subject" type="text" placeholder="Example: Maths">
        </div>
        <div class="field">
          <label for="register-email">Email</label>
          <input id="register-email" name="email" type="email" placeholder="Enter your email" required>
        </div>
        <div class="field">
          <label for="register-password">Password</label>
          <input id="register-password" name="password" type="password" placeholder="Create a password" required>
        </div>
        <button class="btn primary" type="submit">Create Account</button>
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
      ? getEditableMeetingMode(editingClass)
      : (state.zoomConfigured ? "auto" : "manual");
    const formManualLink = editingClass && formMeetingMode === "manual"
      ? (editingClass.meetingLink || editingClass.zoomLink || "")
      : "";
    const formStudentId = editingClass ? getPrimaryStudentId(editingClass) : "";
    const formButtonLabel = editingClass ? "Save Changes" : "Save Class";
    const formTitle = editingClass ? "Edit Class" : "Schedule Class";
    const formIntro = editingClass
      ? "Update the class details here. Date, time, kid, and class link can all be changed from this form."
      : "Date, time, and student name are required. Zoom link, topic, notes, and Drive link are optional.";

    return `
      <section class="surface">
        <div class="dashboard-header">
          <div>
            <span class="eyebrow">Teacher Portal</span>
            <h2 class="panel-title">${escapeHtml(state.user.name)}</h2>
            <p class="panel-subtitle">Manage classes for ${escapeHtml(state.user.subject || "your subject")} with a clear class view and a separate homework workspace.</p>
          </div>
          <div class="dashboard-actions">
            <span class="mini-stat">${teacherClasses.length} classes</span>
            <span class="mini-stat">${state.students.length} students</span>
            <span class="mini-stat">${reviewedCount} reviewed</span>
            <button class="btn ghost" type="button" data-action="logout">Logout</button>
          </div>
        </div>
        ${renderDashboardTabs()}
        ${state.dashboardTab === "meetings" ? `
          <div class="summary-strip">
            <article class="summary-card">
              <span>Classes in view</span>
              <strong>${visibleCalendarClasses.length}</strong>
              <small>${selectedKid ? `${escapeHtml(selectedKid.name)} selected` : "All students"}</small>
            </article>
            <article class="summary-card">
              <span>Total classes</span>
              <strong>${teacherClasses.length}</strong>
              <small>Saved in the app</small>
            </article>
            <article class="summary-card">
              <span>Students</span>
              <strong>${state.students.length}</strong>
              <small>Available to assign</small>
            </article>
          </div>

          <section class="card calendar-card">
            <div class="calendar-header">
              <div>
                <h3>Class Calendar</h3>
                <p>Switch between week and month views and filter the class calendar by student name.</p>
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
              <h3>Upcoming Classes</h3>
              <p>Only current and future classes appear here for easy follow-up.</p>
              <div class="section-stack">
                ${upcomingTeacherClasses.length ? upcomingTeacherClasses.map(renderTeacherClassCard).join("") : renderEmptyState("No upcoming classes", "Current and future classes will appear here after you schedule them.")}
              </div>
            </section>
          </div>
        ` : `
          <div class="summary-strip">
            <article class="summary-card">
              <span>Homework received</span>
              <strong>${teacherSubmissions.length}</strong>
              <small>Uploads from students</small>
            </article>
            <article class="summary-card">
              <span>Reviewed</span>
              <strong>${reviewedCount}</strong>
              <small>Already scored</small>
            </article>
            <article class="summary-card">
              <span>Pending</span>
              <strong>${teacherSubmissions.length - reviewedCount}</strong>
              <small>Waiting for review</small>
            </article>
          </div>

          <section class="card">
            <h3>Homework Review</h3>
            <p>Open student uploads, add a score, and leave quick feedback.</p>
            <div class="section-stack">
              ${teacherSubmissions.length ? teacherSubmissions.map(renderTeacherSubmissionCard).join("") : renderEmptyState("No homework uploaded yet", "Student homework photos will appear here after they submit from the app.")}
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
    const visibleCalendarClasses = getCalendarWindowClasses(calendarClasses);

    return `
      <section class="surface">
        <div class="dashboard-header">
          <div>
            <span class="eyebrow">Student Portal</span>
            <h2 class="panel-title">${escapeHtml(state.user.name)}</h2>
            <p class="panel-subtitle">See your classes in week or month view, join online classes, and keep homework in its own tab.</p>
          </div>
          <div class="dashboard-actions">
            <span class="mini-stat">${classes.length} classes</span>
            <span class="mini-stat">${submissions.length} uploads</span>
            <button class="btn ghost" type="button" data-action="logout">Logout</button>
          </div>
        </div>
        ${renderDashboardTabs()}
        ${state.dashboardTab === "meetings" ? `
          <div class="summary-strip">
            <article class="summary-card">
              <span>Classes in view</span>
              <strong>${visibleCalendarClasses.length}</strong>
              <small>${escapeHtml(state.calendarView === "month" ? "Month view" : "Week view")}</small>
            </article>
            <article class="summary-card">
              <span>Total classes</span>
              <strong>${classes.length}</strong>
              <small>Assigned to you</small>
            </article>
            <article class="summary-card">
              <span>Reviewed homework</span>
              <strong>${submissions.filter((submission) => submission.score).length}</strong>
              <small>Results from your teacher</small>
            </article>
          </div>

          <section class="card calendar-card">
            <div class="calendar-header">
              <div>
                <h3>Class Calendar</h3>
                <p>Use week view for the next few classes or month view to see the full class schedule.</p>
              </div>
            </div>
            ${renderCalendarControls({
              title: state.calendarView === "month" ? formatMonthLabel(getCalendarCursorDate()) : formatWeekRange(getCalendarCursorDate()),
              showKidFilter: false
            })}
            ${renderCalendarGrid(calendarClasses)}
          </section>

          <section class="card">
            <h3>Upcoming Classes</h3>
            <p>Use Join Class to open current and future classes when your teacher has shared the link.</p>
            <div class="section-stack">
              ${upcomingClasses.length ? upcomingClasses.map(renderStudentClassCard).join("") : renderEmptyState("No upcoming classes", "Current and future classes will appear here after your teacher assigns them.")}
            </div>
          </section>
        ` : `
          <div class="dashboard-columns">
            <section class="card">
              <h3>Upload Homework</h3>
              <p>Choose a class, upload the homework photo, and send it to your teacher.</p>
              <div class="section-stack">
                ${classes.length ? classes.map(renderStudentHomeworkCard).join("") : renderEmptyState("No classes available", "Homework upload will appear here after a class is scheduled for you.")}
              </div>
            </section>

            <section class="card">
              <h3>Homework Status</h3>
              <p>See uploaded work, scores, and teacher comments in one place.</p>
              <div class="section-stack">
                ${submissions.length ? submissions.map(renderStudentSubmissionCard).join("") : renderEmptyState("No homework uploaded yet", "Upload homework from the left side once a class is scheduled.")}
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
    return `
      <section class="card">
        <div class="section-heading">
          <div>
            <h3>${formTitle}</h3>
            <p>${formIntro}</p>
          </div>
          ${editingClass ? '<button class="btn ghost" type="button" data-action="cancel-class-edit">Back to Details</button>' : ""}
        </div>
        <form class="form-grid" data-form="schedule-class">
          <div class="field">
            <label for="studentIds">Kid for this class</label>
            <select id="studentIds" name="studentIds" ${state.students.length ? "required" : "disabled"}>
              <option value="">${state.students.length ? "Select kid name" : "No student accounts yet"}</option>
              ${state.students.map((student) => `
                <option value="${escapeAttribute(student.id)}"${formStudentId === student.id ? " selected" : ""}>${escapeHtml(student.name)}</option>
              `).join("")}
            </select>
            ${state.students.length ? '<div class="field-hint">Choose the kid who should see this class in their account.</div>' : '<p class="calendar-empty">Create the student accounts first so you can assign classes.</p>'}
          </div>
          <div class="form-grid two">
            <div class="field">
              <label for="dateTime">Class Date & Time</label>
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
          <div class="field">
            <label for="scheduleMeetingMode">Class Link</label>
            <select id="scheduleMeetingMode" name="meetingMode">
              ${state.zoomConfigured ? `<option value="auto"${formMeetingMode === "auto" ? " selected" : ""}>Create Zoom class link automatically</option>` : ""}
              <option value="manual"${formMeetingMode === "manual" ? " selected" : ""}>Paste existing Zoom class link</option>
              <option value="none"${formMeetingMode === "none" ? " selected" : ""}>Add later</option>
            </select>
            <div class="field-hint">${escapeHtml(state.zoomConfigured
              ? "Choose auto-create to let the app create the Zoom class link and save it for students."
              : "Zoom credentials are not active right now, so paste an existing Zoom class link or leave it for later.")}</div>
          </div>
          <div class="field" data-manual-zoom-field ${formMeetingMode === "manual" ? "" : "hidden"}>
            <label for="manualMeetingLink">Zoom Class Link</label>
            <input id="manualMeetingLink" name="manualMeetingLink" type="text" value="${escapeAttribute(formManualLink)}" placeholder="Optional: paste Zoom link">
            <div class="field-hint">Paste the Zoom link if the class is already created. Students will use the Join Class button to open it.</div>
          </div>
          <div class="field">
            <label for="topic">Topic</label>
            <input id="topic" name="topic" type="text" value="${escapeAttribute(editingClass ? (editingClass.topic || "") : "")}" placeholder="Optional class title">
          </div>
          <div class="field">
            <label for="details">Notes</label>
            <textarea id="details" name="details" placeholder="Optional notes for the class">${escapeHtml(editingClass ? (editingClass.details || "") : "")}</textarea>
          </div>
          <div class="field">
            <label for="driveLink">Google Drive Link</label>
            <input id="driveLink" name="driveLink" type="url" value="${escapeAttribute(editingClass ? (editingClass.driveLink || "") : "")}" placeholder="Optional: https://drive.google.com/...">
          </div>
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
            <h3>Class Details</h3>
            <p>Review the selected class information here, then switch to edit mode if something needs to change.</p>
          </div>
          <div class="panel-actions">
            <button class="btn primary" type="button" data-action="start-class-edit">Edit Class</button>
            <button class="btn ghost" type="button" data-action="clear-class-selection">New Class</button>
          </div>
        </div>
        <div class="class-detail-block">
          <span class="subject-pill ${escapeAttribute(String(classItem.subject || "class").toLowerCase())}">${escapeHtml(classItem.subject || "Class")}</span>
          <h3>${escapeHtml(getClassTitle(classItem))}</h3>
          ${renderClassDetails(classItem.details)}
          ${renderKidBadges(classItem)}
        </div>
        <div class="detail-list">
          <span><strong>Date:</strong> ${escapeHtml(formatDate(classItem.dateTime))}</span>
          <span><strong>Duration:</strong> ${escapeHtml(String(classItem.durationMinutes || 45))} minutes</span>
          <span><strong>Kid:</strong> ${escapeHtml(formatStudentNames(classItem.studentNames))}</span>
          <span><strong>Class Type:</strong> ${escapeHtml(getMeetingProviderLabel(meetingProvider))}</span>
          <span><strong>Class Link:</strong> ${escapeHtml(getReadableMeetingLink(classItem))}</span>
          ${classItem.driveLink ? `<span><strong>Drive:</strong> ${escapeHtml(classItem.driveLink)}</span>` : ""}
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary", getMeetingActionLabel(meetingProvider, "teacher"), getMeetingUnavailableLabel(meetingProvider))}
          ${renderExternalAction(driveLink, "secondary", "Open Drive Doc", "Drive link unavailable")}
        </div>
      </section>
    `;
  }

  function renderTeacherClassCard(classItem) {
    const meetingProvider = getClassMeetingProvider(classItem);
    const meetingLink = getClassMeetingLink(classItem);
    const driveLink = safeExternalUrl(classItem.driveLink);
    const meetingStatus = getMeetingStatus(classItem, meetingProvider);

    return `
      <article class="card">
      <article class="card${state.selectedClassId === classItem.id ? " is-selected" : ""}">
        <div class="card__top">
          <span class="subject-pill ${escapeAttribute(String(classItem.subject || "class").toLowerCase())}">${escapeHtml(classItem.subject || "Class")}</span>
          <span class="status-pill">${formatDate(classItem.dateTime)}</span>
        </div>
        <h3>${escapeHtml(getClassTitle(classItem))}</h3>
        ${renderClassDetails(classItem.details)}
        ${renderKidBadges(classItem)}
        <div class="meeting-status">
          <span class="meeting-pill ${meetingStatus.tone}">${escapeHtml(meetingStatus.label)}</span>
          ${meetingLink ? `<button class="link-btn ghost copy-link" type="button" data-action="copy-link" data-link="${escapeAttribute(meetingLink)}">Copy link</button>` : ""}
        </div>
        <div class="card__meta">
          <span><strong>Duration:</strong> ${escapeHtml(String(classItem.durationMinutes || 45))} minutes</span>
          <span><strong>Kids:</strong> ${escapeHtml(formatStudentNames(classItem.studentNames))}</span>
          <span><strong>Class Type:</strong> ${escapeHtml(getMeetingProviderLabel(meetingProvider))}</span>
          ${classItem.driveLink ? `<span><strong>Drive:</strong> ${escapeHtml(classItem.driveLink)}</span>` : ""}
          <span class="meeting-link"><strong>Class Link:</strong> ${escapeHtml(getReadableMeetingLink(classItem))}</span>
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary", getMeetingActionLabel(meetingProvider, "teacher"), getMeetingUnavailableLabel(meetingProvider))}
          ${renderExternalAction(driveLink, "secondary", "Open Drive Doc", "Drive link unavailable")}
          <button class="btn ghost" type="button" data-action="edit-class" data-class-id="${escapeAttribute(classItem.id)}">View Details</button>
        </div>
      </article>
    `;
  }

  function renderStudentClassCard(classItem) {
    const existingSubmission = state.submissions.find((submission) => submission.classId === classItem.id);
    const meetingProvider = getClassMeetingProvider(classItem);
    const meetingLink = getClassMeetingLink(classItem);
    const driveLink = safeExternalUrl(classItem.driveLink);
    const meetingStatus = getMeetingStatus(classItem, meetingProvider);
    return `
      <article class="card">
        <div class="card__top">
          <span class="subject-pill ${escapeAttribute(String(classItem.subject || "class").toLowerCase())}">${escapeHtml(classItem.subject || "Class")}</span>
          <span class="status-pill">${formatDate(classItem.dateTime)}</span>
        </div>
        <h3>${escapeHtml(getClassTitle(classItem))}</h3>
        ${renderClassDetails(classItem.details)}
        ${renderKidBadges(classItem)}
        <div class="meeting-status">
          <span class="meeting-pill ${meetingStatus.tone}">${escapeHtml(meetingStatus.label)}</span>
          ${meetingLink ? `<button class="link-btn ghost copy-link" type="button" data-action="copy-link" data-link="${escapeAttribute(meetingLink)}">Copy link</button>` : ""}
        </div>
        <div class="card__meta">
          <span><strong>Teacher:</strong> ${escapeHtml(classItem.teacherName)}</span>
          <span><strong>For:</strong> ${escapeHtml(formatStudentNames(classItem.studentNames))}</span>
          <span><strong>Class Type:</strong> ${escapeHtml(getMeetingProviderLabel(meetingProvider))}</span>
          <span><strong>Homework:</strong> ${existingSubmission ? "Uploaded" : "Pending"}</span>
        </div>
        <div class="class-actions">
          ${renderExternalAction(meetingLink, "primary", getMeetingActionLabel(meetingProvider, "student"), getMeetingUnavailableLabel(meetingProvider))}
          ${renderExternalAction(driveLink, "secondary", "Open Drive Doc", "Drive link unavailable")}
        </div>
      </article>
    `;
  }

  function renderStudentHomeworkCard(classItem) {
    const existingSubmission = state.submissions.find((submission) => submission.classId === classItem.id);
    const driveLink = safeExternalUrl(classItem.driveLink);

    return `
      <article class="card card--soft">
        <div class="card__top">
          <div>
            <h3>${escapeHtml(getClassTitle(classItem))}</h3>
            <p>${escapeHtml(formatDate(classItem.dateTime))}</p>
          </div>
          <span class="status-pill ${existingSubmission ? "" : "pending"}">${existingSubmission ? "Uploaded" : "Pending"}</span>
        </div>
        <div class="card__meta">
          <span><strong>Teacher:</strong> ${escapeHtml(classItem.teacherName)}</span>
          ${driveLink ? `<span><strong>Drive:</strong> ${escapeHtml(classItem.driveLink)}</span>` : ""}
        </div>
        ${existingSubmission && existingSubmission.feedback ? `
          <div class="feedback-note">
            <strong>Teacher comment</strong>
            <p>${escapeHtml(existingSubmission.feedback)}</p>
          </div>
        ` : ""}
        <form class="form-grid" data-form="upload-homework" data-class-id="${classItem.id}">
          <div class="field">
            <label for="homework-${classItem.id}">${existingSubmission ? "Replace homework photo" : "Upload homework photo"}</label>
            <input id="homework-${classItem.id}" name="homework" type="file" accept="image/*" capture="environment" required>
          </div>
          <button class="btn primary" type="submit">${existingSubmission ? "Update Homework" : "Submit Homework"}</button>
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

  function renderDashboardTabs() {
    return `
      <div class="tab-bar" role="tablist" aria-label="Dashboard sections">
        <button class="tab-pill ${state.dashboardTab === "meetings" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.dashboardTab === "meetings"}" data-action="set-dashboard-tab" data-tab="meetings">Classes</button>
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

    if (actionButton.dataset.action === "toggle-user-active") {
      void updateUserActivation(actionButton.dataset.userId, actionButton.dataset.nextActive === "true");
      return;
    }

    if (actionButton.dataset.action === "logout") {
      clearSession();
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
      renderApp({ type: "success", text: "You have been logged out." });
    }
  }

  function handleChange(event) {
    if (event.target.name === "meetingMode") {
      refreshMeetingModeFields(event.target.form);
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
    const meetingMode = modeSelect ? String(modeSelect.value || "") : "none";
    const manualField = form.querySelector("[data-manual-zoom-field], [data-update-manual-zoom-field]");
    const autoHint = form.querySelector("[data-update-auto-hint]");
    const manualInput = form.querySelector('input[name="manualMeetingLink"]');

    if (manualField) {
      manualField.hidden = meetingMode !== "manual";
    }

    if (autoHint) {
      autoHint.hidden = meetingMode !== "auto";
    }

    if (manualInput && meetingMode !== "manual") {
      manualInput.value = meetingMode === "none" ? "" : manualInput.value;
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
      writeSession({ userId: payload.user.id });
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
        body: JSON.stringify({
          adminId: state.user.id,
          isActive
        })
      });

      await refreshDashboard(state.user.id, {
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
      const meetingMode = normalizeClientMeetingMode(formData.get("meetingMode"), {
        zoomConfigured: state.zoomConfigured,
        hasManualLink: Boolean(manualMeetingLink)
      });
      const payload = {
        teacherId: state.user.id,
        topic: String(formData.get("topic") || "").trim(),
        details: String(formData.get("details") || "").trim(),
        dateTime: String(formData.get("dateTime") || "").trim(),
        durationMinutes: Number(formData.get("durationMinutes") || 45),
        driveLink: String(formData.get("driveLink") || "").trim(),
        studentIds: formData.getAll("studentIds").map((value) => String(value || "").trim()).filter(Boolean),
        meetingProvider: meetingMode === "none" ? "none" : "zoom",
        meetingMode,
        useAutoZoom: meetingMode === "auto",
        manualMeetingLink
      };

      const response = await api("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      state.selectedClassId = response.classItem ? response.classItem.id : null;
      state.isEditingClass = false;
      await refreshDashboard(state.user.id, {
        type: "success",
        text: buildClassSaveMessage(response.classItem, response.message || "Class scheduled successfully.")
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function updateClass(formData) {
    try {
      const manualMeetingLink = String(formData.get("manualMeetingLink") || "").trim();
      const meetingMode = normalizeClientMeetingMode(formData.get("meetingMode"), {
        zoomConfigured: state.zoomConfigured,
        hasManualLink: Boolean(manualMeetingLink),
        allowNone: true
      });
      const payload = {
        teacherId: state.user.id,
        topic: String(formData.get("topic") || "").trim(),
        details: String(formData.get("details") || "").trim(),
        dateTime: String(formData.get("dateTime") || "").trim(),
        durationMinutes: Number(formData.get("durationMinutes") || 45),
        driveLink: String(formData.get("driveLink") || "").trim(),
        studentIds: formData.getAll("studentIds").map((value) => String(value || "").trim()).filter(Boolean),
        meetingProvider: meetingMode === "none" ? "none" : "zoom",
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
      await refreshDashboard(state.user.id, {
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
    body.append("studentId", state.user.id);
    body.append("homework", file);

    try {
      const response = await api("/api/submissions", {
        method: "POST",
        body
      });

      await refreshDashboard(state.user.id, {
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
          teacherId: state.user.id,
          score: String(formData.get("score") || "").trim(),
          feedback: String(formData.get("feedback") || "").trim()
        })
      });

      await refreshDashboard(state.user.id, {
        type: "success",
        text: response.message || "Homework ranking saved."
      });
    } catch (error) {
      renderApp({ type: "error", text: error.message });
    }
  }

  async function refreshDashboard(userId, message) {
    const payload = await api(`/api/dashboard?userId=${encodeURIComponent(userId)}`);
    applyDashboardPayload(payload);
    renderApp(message);
  }

  async function refreshActiveSessionSilently() {
    if (!state.user || document.visibilityState === "hidden") {
      return;
    }

    try {
      const payload = await api(`/api/dashboard?userId=${encodeURIComponent(state.user.id)}`);
      const classesChanged = JSON.stringify(state.classes) !== JSON.stringify(payload.classes || []);
      const submissionsChanged = JSON.stringify(state.submissions) !== JSON.stringify(payload.submissions || []);
      const studentsChanged = JSON.stringify(state.students) !== JSON.stringify(payload.students || []);
      const managedUsersChanged = JSON.stringify(state.managedUsers) !== JSON.stringify(payload.managedUsers || []);

      applyDashboardPayload(payload);

      if (classesChanged || submissionsChanged || studentsChanged || managedUsersChanged) {
        renderApp();
      }
    } catch (_error) {
      // Ignore background refresh failures and let the next explicit action surface errors.
    }
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      throw new Error((payload && payload.error) || "Something went wrong.");
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
      state.meetingProvider = ["none", "zoom", "teams"].includes(state.meetingProvider) ? state.meetingProvider : "none";
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

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      clearSession();
      return null;
    }
  }

  function writeSession(payload) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
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

  function normalizeClientMeetingMode(value, { zoomConfigured, hasManualLink, allowNone = true }) {
    const normalized = String(value || "").trim().toLowerCase();

    if (normalized === "auto" && zoomConfigured) {
      return "auto";
    }

    if (normalized === "manual") {
      return "manual";
    }

    if (allowNone && normalized === "none") {
      return "none";
    }

    if (hasManualLink) {
      return "manual";
    }

    return zoomConfigured ? "auto" : "none";
  }

  function getAuthRoleLabel() {
    if (state.authRole === "student") {
      return "student";
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

  function getEditableMeetingMode(classItem) {
    if (classItem.zoomMeetingId) {
      return "auto";
    }

    if (getClassMeetingLink(classItem)) {
      return "manual";
    }

    return "none";
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

    if (provider === "none") {
      return "No Class Link";
    }

    return "Zoom";
  }

  function getClassMeetingProvider(classItem) {
    if (classItem.meetingProvider === "teams") {
      return "teams";
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

    if (provider === "zoom" && classItem.zoomMeetingId) {
      return { tone: "ready auto", label: "Zoom class link ready" };
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
