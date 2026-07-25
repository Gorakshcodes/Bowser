const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = Boolean(process.env.VERCEL);
const IS_PRODUCTION = IS_VERCEL || process.env.NODE_ENV === "production";
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_NAME = String(process.env.ADMIN_NAME || "").trim() || "Bowser Admin";
const STORAGE_MODE = DATABASE_URL ? "postgres" : (IS_VERCEL ? "runtime-file" : "file");
const RUNTIME_ROOT = STORAGE_MODE === "file" ? __dirname : path.join("/tmp", "bowser-runtime");
const DATA_DIR = path.join(RUNTIME_ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "portal-data.json");
const REPO_DATA_FILE = path.join(__dirname, "data", "portal-data.json");
const UPLOADS_DIR = path.join(RUNTIME_ROOT, "uploads");
const STORAGE_STATE_KEY = "default";
const MAX_SERIES_CLASSES = 90;
const MIN_PASSWORD_LENGTH = 8;
const MAX_TEXT_LENGTH = 2000;
const MAX_TOPIC_LENGTH = 200;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_MAX_ATTEMPTS = 12;
const loginAttemptTracker = new Map();
const pool = STORAGE_MODE === "postgres"
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: shouldUseDatabaseSsl()
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;
const LEGACY_DEMO_USER_IDS = new Set([
  "teacher-maths",
  "teacher-english",
  "student-1",
  "student-2",
  "student-3"
]);
const LEGACY_DEMO_EMAILS = new Set([
  "maths@bowser.app",
  "english@bowser.app",
  "student@bowser.app",
  "diya@bowser.app",
  "kabir@bowser.app"
]);
const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif"
};
const MEETING_PROVIDERS = {
  zoom: {
    label: "Zoom",
    hosts: ["zoom.us"],
    supportsAuto: true
  },
  meet: {
    label: "Google Meet",
    hosts: ["meet.google.com"],
    supportsAuto: true
  },
  teams: {
    label: "Teams",
    hosts: [
      "teams.microsoft.com",
      "teams.live.com",
      "teams.microsoft.us",
      "teams.microsoft.de"
    ],
    supportsAuto: false
  }
};
const MEETING_TIMEZONE = process.env.MEETING_TIMEZONE || "Asia/Riyadh";
const NOT_CONFIGURED_ERROR_CODES = new Set(["ZOOM_NOT_CONFIGURED", "GOOGLE_MEET_NOT_CONFIGURED"]);
const SESSION_COOKIE_NAME = "bowser_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_SECRET_ENV = String(process.env.SESSION_SECRET || "").trim();
const USE_SECURE_COOKIES = IS_VERCEL || process.env.NODE_ENV === "production";
const PASSWORD_SCHEME = "scrypt";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;
const DUMMY_PASSWORD_HASH = hashPasswordBootstrap("login-rate-dummy");

function hashPasswordBootstrap(plainPassword) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const derivedKey = crypto.scryptSync(String(plainPassword ?? ""), salt, PASSWORD_KEY_LENGTH);
  return `${PASSWORD_SCHEME}$${salt}$${derivedKey.toString("hex")}`;
}

let storageInitializationError = null;
const storageReady = initializeStorage().catch((error) => {
  storageInitializationError = error;
  throw error;
});

const upload = multer({
  storage: STORAGE_MODE === "postgres"
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, UPLOADS_DIR),
        filename: (_req, file, callback) => {
          const extension = ALLOWED_IMAGE_TYPES[file.mimetype] || ".jpg";
          callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
        }
      }),
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      callback(new Error("Only JPG, PNG, WEBP, HEIC, or HEIF homework images are allowed."));
      return;
    }

    callback(null, true);
  },
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

const handleHomeworkUpload = (req, res, next) => {
  upload.single("homework")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Homework images must be 8 MB or smaller." });
      return;
    }

    res.status(400).json({ error: error.message || "Homework upload failed." });
  });
};

const handleAsync = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
if (STORAGE_MODE !== "postgres") {
  app.use("/uploads", express.static(UPLOADS_DIR, {
    fallthrough: true,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=3600");
    }
  }));
}
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/app.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/styles.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "styles.css"));
});

app.get("/api/health", handleAsync(async (_req, res) => {
  try {
    await ensureStorageReady();
    res.json({
      ok: true,
      zoomConfigured: isZoomConfigured(),
      googleMeetConfigured: isGoogleMeetConfigured(),
      teamsSupported: true,
      storageMode: STORAGE_MODE
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      storageMode: STORAGE_MODE
    });
  }
}));

app.post("/api/login", handleAsync(async (req, res) => {
  const clientKey = getClientRateKey(req);
  if (isRateLimited(clientKey)) {
    res.status(429).json({ error: "Too many login attempts. Please wait a few minutes and try again." });
    return;
  }

  const { email, password, role } = req.body || {};
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase().slice(0, 254);
  const normalizedPassword = String(password || "");
  try {
    const database = await readDatabase();
    const candidates = database.users.filter((entry) => {
      if (String(entry.email || "").toLowerCase() !== normalizedEmail) {
        return false;
      }

      return ["teacher", "student", "admin"].includes(normalizedRole)
        ? entry.role === normalizedRole
        : true;
    });

    // Always perform a password check to reduce timing differences between
    // missing accounts and wrong passwords.
    let user = null;
    if (candidates.length) {
      user = candidates.find((entry) => verifyPassword(normalizedPassword, entry.password)) || null;
    } else {
      verifyPassword(normalizedPassword, DUMMY_PASSWORD_HASH);
    }

    if (!user) {
      registerFailedLogin(clientKey);
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    if (user.role !== "admin" && !isUserActive(user)) {
      registerFailedLogin(clientKey);
      res.status(403).json({
        error: getActivationStatus(user) === "inactive"
          ? "Your account is deactivated. Please contact admin."
          : "Your account is waiting for admin activation."
      });
      return;
    }

    clearFailedLogins(clientKey);

    let databaseChanged = ensureSessionSecret(database);
    if (!isHashedPassword(user.password)) {
      user.password = hashPassword(normalizedPassword);
      databaseChanged = true;
    }

    if (databaseChanged) {
      await writeDatabase(database);
    }

    setSessionCookie(res, createSessionToken(user, resolveSessionSecret(database)));
    res.json({
      user: sanitizeUser(user),
      dashboard: buildDashboard(user, database)
    });
  } catch (error) {
    res.status(500).json({ error: "Could not complete login." });
  }
}));

app.post("/api/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ message: "You have been logged out." });
});

app.post("/api/register", handleAsync(async (req, res) => {
  const { role, name, email, password, subject } = req.body || {};
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "").trim();
  const normalizedSubject = String(subject || "").trim();

  if (!["teacher", "student"].includes(normalizedRole)) {
    res.status(400).json({ error: "Choose a teacher or student account type." });
    return;
  }

  if (!normalizedName) {
    res.status(400).json({ error: "Name is required." });
    return;
  }

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  if (normalizedName.length > 80) {
    res.status(400).json({ error: "Name must be 80 characters or fewer." });
    return;
  }

  if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    return;
  }

  if (normalizedPassword.length > 128) {
    res.status(400).json({ error: "Password must be 128 characters or fewer." });
    return;
  }

  try {
    const database = await readDatabase();
    if (database.users.some((entry) => entry.role === normalizedRole && entry.email.toLowerCase() === normalizedEmail)) {
      res.status(409).json({ error: `A ${normalizedRole} account with this email already exists.` });
      return;
    }

    const user = {
      id: `${normalizedRole}-${crypto.randomUUID()}`,
      role: normalizedRole,
      name: normalizedName.slice(0, 80),
      email: normalizedEmail.slice(0, 254),
      password: hashPassword(normalizedPassword),
      isActive: false,
      activationStatus: "pending",
      createdAt: new Date().toISOString()
    };

    if (normalizedRole === "teacher") {
      user.subject = (normalizedSubject || "General").slice(0, 80);
    }

    database.users.push(user);
    await writeDatabase(database);

    res.status(201).json({
      message: "Account created successfully. Please wait for admin activation before logging in.",
      pendingApproval: true,
      user: sanitizeUser(user)
    });
  } catch (error) {
    res.status(500).json({ error: "Could not create the account." });
  }
}));

app.get("/api/dashboard", requireAuth(), handleAsync(async (req, res) => {
  res.json(buildDashboard(req.currentUser, req.database));
}));

app.post("/api/classes", requireAuth("teacher"), handleAsync(async (req, res) => {
  const database = req.database;
  const teacher = req.currentUser;

  try {
    const plan = buildClassSchedulePlan(req.body || {});
    const selectedStudents = resolveSelectedStudents(database, plan.studentIds);
    const topic = clampText(plan.topic, MAX_TOPIC_LENGTH)
      || `Class with ${selectedStudents.map((student) => student.name).join(", ")}`;
    const details = clampText(plan.details, MAX_TEXT_LENGTH);
    const normalizedDriveLink = plan.driveLink
      ? normalizeExternalUrl(plan.driveLink, {
          label: "Google Drive link",
          allowedHosts: ["drive.google.com", "docs.google.com"]
        })
      : "";
    const normalizedMeetingProvider = normalizeMeetingProvider(plan.meetingProvider);
    const normalizedMeetingMode = normalizeMeetingMode({
      meetingProvider: normalizedMeetingProvider,
      meetingMode: plan.meetingMode,
      useAutoZoom: plan.useAutoZoom
    });

    let meetingLink = "";
    let autoMeeting = null;
    const firstSlot = plan.slots[0];

    if (normalizedMeetingMode === "auto") {
      // One shared auto meeting link for the whole series keeps bulk
      // scheduling fast and matches a fixed classroom meeting room.
      autoMeeting = await createAutoMeeting(normalizedMeetingProvider, {
        teacher,
        topic,
        agenda: details,
        startTime: firstSlot.toISOString(),
        durationMinutes: plan.durationMinutes
      });
      meetingLink = autoMeeting.joinUrl;
    } else if (normalizedMeetingProvider !== "none" && plan.manualMeetingLink) {
      const normalizedLink = normalizeMeetingLink(plan.manualMeetingLink, normalizedMeetingProvider);
      meetingLink = normalizeExternalUrl(normalizedLink, {
        label: `${getMeetingProviderLabel(normalizedMeetingProvider)} class link`,
        allowedHosts: getMeetingHosts(normalizedMeetingProvider)
      });
    }

    const seriesId = plan.slots.length > 1 ? `series-${crypto.randomUUID()}` : "";
    const createdAt = new Date().toISOString();
    const classItems = plan.slots.map((slot) => ({
      id: `class-${crypto.randomUUID()}`,
      seriesId,
      teacherId: teacher.id,
      teacherName: teacher.name,
      subject: teacher.subject,
      topic,
      details,
      dateTime: slot.toISOString(),
      durationMinutes: plan.durationMinutes,
      studentIds: selectedStudents.map((student) => student.id),
      studentNames: selectedStudents.map((student) => student.name),
      meetingProvider: normalizedMeetingProvider,
      meetingMode: normalizedMeetingMode,
      meetingLink,
      zoomLink: normalizedMeetingProvider === "zoom" ? meetingLink : "",
      driveLink: normalizedDriveLink,
      autoMeetingId: autoMeeting ? autoMeeting.meetingId : "",
      zoomMeetingId: autoMeeting && normalizedMeetingProvider === "zoom" ? autoMeeting.meetingId : "",
      zoomStartUrl: autoMeeting && normalizedMeetingProvider === "zoom" ? autoMeeting.startUrl : "",
      createdAt
    }));

    database.classes.push(...classItems);
    await writeDatabase(database);

    const classItem = classItems[0];
    const count = classItems.length;
    const baseMessage = count > 1
      ? `Scheduled ${count} classes.`
      : "Class scheduled successfully.";
    const linkMessage = autoMeeting
      ? ` Shared ${getMeetingProviderLabel(normalizedMeetingProvider)} class link created once for the series.`
      : meetingLink
        ? ` ${getMeetingProviderLabel(normalizedMeetingProvider)} class link saved and shared with students.`
        : count === 1
          ? " You can add a class link later if needed."
          : " Add a class link later if needed.";

    res.status(201).json({
      classItem,
      classItems,
      count,
      message: `${baseMessage}${linkMessage}`
    });
  } catch (error) {
    const status = NOT_CONFIGURED_ERROR_CODES.has(error.code)
      ? 400
      : (error.statusCode || 502);
    res.status(status).json({ error: error.message || "Could not schedule class." });
  }
}));

app.put("/api/classes/:classId", requireAuth("teacher"), handleAsync(async (req, res) => {
  const { classId } = req.params;
  const {
    topic,
    details,
    dateTime,
    durationMinutes,
    driveLink,
    studentIds,
    meetingProvider,
    meetingMode,
    useAutoZoom,
    manualMeetingLink,
    manualZoomLink
  } = req.body || {};

  const database = req.database;
  const teacher = req.currentUser;
  const classItem = database.classes.find((entry) => entry.id === classId);

  if (!classItem) {
    res.status(404).json({ error: "Class not found." });
    return;
  }

  if (classItem.teacherId !== teacher.id) {
    res.status(403).json({ error: "You can only update your own classes." });
    return;
  }

  if (!dateTime) {
    res.status(400).json({ error: "Class date and time are required." });
    return;
  }

  const scheduledDate = new Date(String(dateTime));
  if (Number.isNaN(scheduledDate.getTime())) {
    res.status(400).json({ error: "Please choose a valid class date and time." });
    return;
  }

  const normalizedDuration = Number(durationMinutes || 45);
  if (!Number.isInteger(normalizedDuration) || normalizedDuration < 15 || normalizedDuration > 180) {
    res.status(400).json({ error: "Class duration must be between 15 and 180 minutes." });
    return;
  }

  try {
    const normalizedDriveLink = String(driveLink || "").trim()
      ? normalizeExternalUrl(driveLink, {
          label: "Google Drive link",
          allowedHosts: ["drive.google.com", "docs.google.com"]
        })
      : "";
    const selectedStudents = resolveSelectedStudents(database, studentIds);
    const normalizedMeetingProvider = normalizeMeetingProvider(meetingProvider);
    const normalizedMeetingMode = normalizeMeetingMode({
      meetingProvider: normalizedMeetingProvider,
      meetingMode,
      useAutoZoom
    });
    const rawManualMeetingLink = String(manualMeetingLink || manualZoomLink || "").trim();

    let meetingLink = classItem.meetingLink || classItem.zoomLink || "";
    let autoMeeting = null;

    if (normalizedMeetingMode === "auto") {
      autoMeeting = await createAutoMeeting(normalizedMeetingProvider, {
        teacher,
        topic: String(topic || "").trim() || `Class with ${selectedStudents.map((student) => student.name).join(", ")}`,
        agenda: String(details || "").trim(),
        startTime: scheduledDate.toISOString(),
        durationMinutes: normalizedDuration
      });
      meetingLink = autoMeeting.joinUrl;
    } else if (normalizedMeetingProvider !== "none" && rawManualMeetingLink) {
      const normalizedLink = normalizeMeetingLink(rawManualMeetingLink, normalizedMeetingProvider);
      meetingLink = normalizeExternalUrl(normalizedLink, {
        label: `${getMeetingProviderLabel(normalizedMeetingProvider)} class link`,
        allowedHosts: getMeetingHosts(normalizedMeetingProvider)
      });
    } else if (normalizedMeetingProvider === "none") {
      meetingLink = "";
    } else {
      meetingLink = "";
    }

    classItem.topic = String(topic || "").trim() || `Class with ${selectedStudents.map((student) => student.name).join(", ")}`;
    classItem.details = String(details || "").trim();
    classItem.dateTime = scheduledDate.toISOString();
    classItem.durationMinutes = normalizedDuration;
    classItem.studentIds = selectedStudents.map((student) => student.id);
    classItem.studentNames = selectedStudents.map((student) => student.name);
    classItem.driveLink = normalizedDriveLink;
    classItem.meetingProvider = normalizedMeetingProvider;
    classItem.meetingMode = normalizedMeetingMode;
    classItem.meetingLink = meetingLink;
    classItem.zoomLink = normalizedMeetingProvider === "zoom" ? meetingLink : "";
    classItem.autoMeetingId = autoMeeting ? autoMeeting.meetingId : "";
    classItem.zoomMeetingId = autoMeeting && normalizedMeetingProvider === "zoom" ? autoMeeting.meetingId : "";
    classItem.zoomStartUrl = autoMeeting && normalizedMeetingProvider === "zoom" ? autoMeeting.startUrl : "";

    await writeDatabase(database);
    res.json({
      classItem,
      message: autoMeeting
        ? `Class updated and new ${getMeetingProviderLabel(normalizedMeetingProvider)} class link created.`
        : "Class updated successfully."
    });
  } catch (error) {
    const status = NOT_CONFIGURED_ERROR_CODES.has(error.code)
      ? 400
      : (error.statusCode || 502);
    res.status(status).json({ error: error.message });
  }
}));

app.post("/api/submissions", requireAuth("student"), handleHomeworkUpload, handleAsync(async (req, res) => {
  const { classId } = req.body || {};
  const file = req.file;

  if (!classId || !file) {
    res.status(400).json({ error: "Class and homework image are required." });
    return;
  }

  const database = req.database;
  const student = req.currentUser;
  const studentId = student.id;
  const classItem = database.classes.find((entry) => entry.id === classId);

  if (!classItem) {
    cleanupFile(file.path);
    res.status(404).json({ error: "Class could not be found." });
    return;
  }

  if (!Array.isArray(classItem.studentIds) || !classItem.studentIds.includes(student.id)) {
    cleanupFile(file.path);
    res.status(403).json({ error: "This student is not assigned to the selected class." });
    return;
  }

  const existingSubmission = database.submissions.find(
    (submission) => submission.classId === classId && submission.studentId === studentId
  );

  if (existingSubmission && existingSubmission.filePath) {
    cleanupFile(existingSubmission.filePath);
  }

  const storedHomework = buildStoredHomeworkAsset(file);
  const submissionPayload = {
    id: existingSubmission ? existingSubmission.id : `submission-${crypto.randomUUID()}`,
    classId,
    studentId,
    studentName: student.name,
    subject: classItem.subject,
    imageUrl: storedHomework.imageUrl,
    filePath: storedHomework.filePath,
    submittedAt: new Date().toISOString(),
    score: existingSubmission ? "" : "",
    feedback: existingSubmission ? "" : ""
  };

  if (existingSubmission) {
    Object.assign(existingSubmission, submissionPayload);
  } else {
    database.submissions.push(submissionPayload);
  }

  await writeDatabase(database);
  res.status(201).json({ message: "Homework uploaded successfully." });
}));

app.put("/api/classes/:classId/meeting", requireAuth("teacher"), handleAsync(async (req, res) => {
  const { classId } = req.params;
  const {
    meetingProvider,
    meetingMode,
    useAutoZoom,
    manualMeetingLink,
    manualZoomLink
  } = req.body || {};

  const database = req.database;
  const teacher = req.currentUser;
  const classItem = database.classes.find((entry) => entry.id === classId);

  if (!classItem) {
    res.status(404).json({ error: "Class not found." });
    return;
  }

  if (classItem.teacherId !== teacher.id) {
    res.status(403).json({ error: "You can only update class links for your own classes." });
    return;
  }

  try {
    const normalizedMeetingProvider = normalizeMeetingProvider(meetingProvider);
    const normalizedMeetingMode = normalizeMeetingMode({
      meetingProvider: normalizedMeetingProvider,
      meetingMode,
      useAutoZoom
    });
    const rawManualMeetingLink = String(manualMeetingLink || manualZoomLink || "").trim();

    let meetingLink = "";
    let autoMeeting = null;

    if (normalizedMeetingMode === "auto") {
      autoMeeting = await createAutoMeeting(normalizedMeetingProvider, {
        teacher,
        topic: classItem.topic,
        agenda: classItem.details,
        startTime: new Date(classItem.dateTime).toISOString(),
        durationMinutes: classItem.durationMinutes
      });
      meetingLink = autoMeeting.joinUrl;
    } else if (normalizedMeetingProvider !== "none" && rawManualMeetingLink) {
      const normalizedLink = normalizeMeetingLink(rawManualMeetingLink, normalizedMeetingProvider);
      meetingLink = normalizeExternalUrl(normalizedLink, {
        label: `${getMeetingProviderLabel(normalizedMeetingProvider)} class link`,
        allowedHosts: getMeetingHosts(normalizedMeetingProvider)
      });
    } else if (normalizedMeetingProvider !== "none") {
      throw createValidationError(`Paste a ${getMeetingProviderLabel(normalizedMeetingProvider)} class link before saving.`);
    }

    classItem.meetingProvider = normalizedMeetingProvider;
    classItem.meetingMode = normalizedMeetingMode;
    classItem.meetingLink = meetingLink;
    classItem.zoomLink = normalizedMeetingProvider === "zoom" ? meetingLink : "";
    classItem.autoMeetingId = autoMeeting ? autoMeeting.meetingId : "";
    classItem.zoomMeetingId = autoMeeting && normalizedMeetingProvider === "zoom" ? autoMeeting.meetingId : "";
    classItem.zoomStartUrl = autoMeeting && normalizedMeetingProvider === "zoom" ? autoMeeting.startUrl : "";
    await writeDatabase(database);

    res.json({
      classItem,
      message: normalizedMeetingProvider === "none"
        ? "Class link cleared."
        : autoMeeting
          ? `${getMeetingProviderLabel(normalizedMeetingProvider)} class link created and shared with students.`
          : `${getMeetingProviderLabel(normalizedMeetingProvider)} class link saved and shared with students.`
    });
  } catch (error) {
    const status = NOT_CONFIGURED_ERROR_CODES.has(error.code)
      ? 400
      : (error.statusCode || 502);
    res.status(status).json({ error: error.message });
  }
}));

app.put("/api/submissions/:submissionId/grade", requireAuth("teacher"), handleAsync(async (req, res) => {
  const { submissionId } = req.params;
  const { score, feedback } = req.body || {};
  const database = req.database;
  const teacher = req.currentUser;
  const submission = database.submissions.find((entry) => entry.id === submissionId);

  if (!submission) {
    res.status(404).json({ error: "Submission not found." });
    return;
  }

  const classItem = database.classes.find((entry) => entry.id === submission.classId);
  if (!classItem || classItem.teacherId !== teacher.id) {
    res.status(403).json({ error: "You can only rank homework for your own classes." });
    return;
  }

  submission.score = String(score || "").trim();
  submission.feedback = String(feedback || "").trim();
  await writeDatabase(database);

  res.json({ message: "Homework ranking saved." });
}));

app.put("/api/admin/users/:userId/activation", requireAuth("admin"), handleAsync(async (req, res) => {
  const { userId } = req.params;
  const { isActive } = req.body || {};
  const database = req.database;
  const admin = req.currentUser;
  const targetUser = database.users.find((entry) => entry.id === userId);

  if (!targetUser || !["teacher", "student"].includes(targetUser.role)) {
    res.status(404).json({ error: "Teacher or student account not found." });
    return;
  }

  if (targetUser.id === admin.id) {
    res.status(400).json({ error: "Admin account cannot update itself here." });
    return;
  }

  const shouldActivate = isActive === true || isActive === "true";
  targetUser.isActive = shouldActivate;
  targetUser.activationStatus = shouldActivate ? "active" : "inactive";
  targetUser.updatedAt = new Date().toISOString();
  await writeDatabase(database);

  res.json({
    user: sanitizeUser(targetUser),
    message: shouldActivate
      ? `${targetUser.name} is now active and can log in.`
      : `${targetUser.name} has been deactivated.`
  });
}));

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  const safeMessage = status >= 500
    ? "Something went wrong."
    : (error.message || "Something went wrong.");
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ error: safeMessage });
});

if (require.main === module) {
  if (IS_PRODUCTION && !SESSION_SECRET_ENV) {
    console.warn("Warning: SESSION_SECRET is not set. Sessions may reset across redeploys.");
  }
  if (IS_PRODUCTION && !DATABASE_URL) {
    console.warn("Warning: DATABASE_URL is not set. Production data may not persist on Vercel.");
  }

  app.listen(PORT, () => {
    console.log(`Bowser portal running at http://localhost:${PORT}`);
  });
}

module.exports = app;

function buildDashboard(user, database) {
  const students = database.users.filter((entry) => entry.role === "student");
  const classes = user.role === "teacher"
    ? database.classes.filter((entry) => entry.teacherId === user.id)
    : user.role === "student"
      ? database.classes.filter((entry) => Array.isArray(entry.studentIds) && entry.studentIds.includes(user.id))
      : [];

  const submissions = user.role === "teacher"
    ? database.submissions.filter((submission) =>
        classes.some((classItem) => classItem.id === submission.classId)
      )
    : user.role === "student"
      ? database.submissions.filter((submission) => submission.studentId === user.id)
      : [];

  const managedUsers = user.role === "admin"
    ? database.users
      .filter((entry) => ["teacher", "student"].includes(entry.role))
      .sort((left, right) => {
        const leftWeight = getActivationSortWeight(left);
        const rightWeight = getActivationSortWeight(right);
        if (leftWeight !== rightWeight) {
          return leftWeight - rightWeight;
        }

        return String(left.name || "").localeCompare(String(right.name || ""));
      })
      .map(sanitizeUser)
    : [];

  classes.sort((left, right) => new Date(left.dateTime) - new Date(right.dateTime));
  submissions.sort((left, right) => new Date(right.submittedAt) - new Date(left.submittedAt));

  return {
    user: sanitizeUser(user),
    students: (user.role === "teacher" ? students : students.filter((entry) => entry.id === user.id)).map(sanitizeUser),
    classes,
    submissions,
    managedUsers,
    zoomConfigured: isZoomConfigured(),
    googleMeetConfigured: isGoogleMeetConfigured(),
    teamsSupported: true
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    role: user.role,
    subject: user.subject || "",
    name: user.name,
    email: user.email,
    isActive: isUserActive(user),
    activationStatus: getActivationStatus(user),
    createdAt: user.createdAt || ""
  };
}

function requireAuth(...allowedRoles) {
  return handleAsync(async (req, res, next) => {
    const database = await readDatabase();
    const secret = resolveSessionSecret(database);
    if (!secret) {
      res.status(500).json({ error: "Session storage is not ready. Please try again." });
      return;
    }

    const session = readSessionToken(readCookie(req, SESSION_COOKIE_NAME), secret);
    if (!session) {
      clearSessionCookie(res);
      res.status(401).json({ error: "Please log in to continue." });
      return;
    }

    const user = database.users.find((entry) => entry.id === session.userId);
    if (!user) {
      clearSessionCookie(res);
      res.status(401).json({ error: "Please log in to continue." });
      return;
    }

    if (user.role !== "admin" && !isUserActive(user)) {
      clearSessionCookie(res);
      res.status(403).json({
        error: getActivationStatus(user) === "inactive"
          ? "Your account is deactivated. Please contact admin."
          : "Your account is waiting for admin activation."
      });
      return;
    }

    if (allowedRoles.length && !allowedRoles.includes(user.role)) {
      res.status(403).json({ error: "You do not have access to this action." });
      return;
    }

    req.currentUser = user;
    req.database = database;
    next();
  });
}

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const derivedKey = crypto.scryptSync(String(plainPassword ?? ""), salt, PASSWORD_KEY_LENGTH);
  return `${PASSWORD_SCHEME}$${salt}$${derivedKey.toString("hex")}`;
}

function isHashedPassword(storedPassword) {
  return typeof storedPassword === "string" && storedPassword.startsWith(`${PASSWORD_SCHEME}$`);
}

function verifyPassword(plainPassword, storedPassword) {
  const candidate = String(plainPassword ?? "");
  if (!isHashedPassword(storedPassword)) {
    // Accounts created before password hashing still hold a plaintext value.
    // They are re-hashed on the next successful login and at startup.
    return safeCompare(candidate, String(storedPassword ?? ""));
  }

  const [, salt, expectedHex] = storedPassword.split("$");
  if (!salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const derivedKey = crypto.scryptSync(candidate, salt, expected.length || PASSWORD_KEY_LENGTH);
  if (expected.length !== derivedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expected);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureSessionSecret(database) {
  if (!database.auth || typeof database.auth !== "object") {
    database.auth = {};
  }

  if (typeof database.auth.sessionSecret === "string" && database.auth.sessionSecret.length >= 32) {
    return false;
  }

  database.auth.sessionSecret = crypto.randomBytes(32).toString("hex");
  return true;
}

function resolveSessionSecret(database) {
  if (SESSION_SECRET_ENV) {
    return SESSION_SECRET_ENV;
  }

  return database && database.auth ? String(database.auth.sessionSecret || "") : "";
}

function createSessionToken(user, secret) {
  const payload = `${user.id}.${Date.now()}`;
  return `${payload}.${signSessionPayload(payload, secret)}`;
}

function signSessionPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function readSessionToken(token, secret) {
  if (!token || !secret) {
    return null;
  }

  const parts = String(token).split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [userId, issuedAtRaw, signature] = parts;
  if (!safeCompare(signature, signSessionPayload(`${userId}.${issuedAtRaw}`, secret))) {
    return null;
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0 || Date.now() - issuedAt > SESSION_TTL_MS) {
    return null;
  }

  return { userId, issuedAt };
}

function readCookie(req, name) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    if (part.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch (_error) {
      return "";
    }
  }

  return "";
}

function setSessionCookie(res, token) {
  res.append("Set-Cookie", buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)));
}

function clearSessionCookie(res) {
  res.append("Set-Cookie", buildSessionCookie("", 0));
}

function buildSessionCookie(value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (USE_SECURE_COOKIES) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

async function readDatabase() {
  await ensureStorageReady();
  if (STORAGE_MODE === "postgres") {
    const payload = await readDatabaseFromPostgres();
    return payload || createSeedData();
  }

  return readDatabaseFromFile();
}

async function writeDatabase(payload) {
  await ensureStorageReady();
  if (STORAGE_MODE === "postgres") {
    await writeDatabaseToPostgres(payload);
    return;
  }

  writeDatabaseToFile(payload);
}

function ensureSeedData() {
  if (fs.existsSync(DATA_FILE)) {
    return;
  }

  writeDatabaseToFile(loadSeedDatabase());
}

function ensureDataShape() {
  const database = readDatabaseFromFile();
  const { changed } = normalizeDatabase(database);
  if (changed) {
    writeDatabaseToFile(database);
  }
}

function normalizeDatabase(database) {
  database.users = Array.isArray(database.users) ? database.users : [];
  database.classes = Array.isArray(database.classes) ? database.classes : [];
  database.submissions = Array.isArray(database.submissions) ? database.submissions : [];
  let changed = false;
  if (ensureSessionSecret(database)) {
    changed = true;
  }

  const usersBeforePurge = database.users.length;
  database.users = database.users.filter(
    (entry) => !LEGACY_DEMO_USER_IDS.has(entry.id) && !LEGACY_DEMO_EMAILS.has(String(entry.email || "").toLowerCase())
  );
  if (database.users.length !== usersBeforePurge) {
    changed = true;
  }

  if (ensureBootstrapAdmin(database)) {
    changed = true;
  }

  for (const user of database.users) {
    if (!user.createdAt) {
      user.createdAt = new Date().toISOString();
      changed = true;
    }

    if (user.password && !isHashedPassword(user.password)) {
      user.password = hashPassword(user.password);
      changed = true;
    }

    const normalizedStatus = normalizeUserActivation(user);
    if (user.isActive !== normalizedStatus.isActive) {
      user.isActive = normalizedStatus.isActive;
      changed = true;
    }

    if (user.activationStatus !== normalizedStatus.activationStatus) {
      user.activationStatus = normalizedStatus.activationStatus;
      changed = true;
    }
  }

  const validUserIds = new Set(database.users.map((entry) => entry.id));
  const classesBeforePurge = database.classes.length;
  database.classes = database.classes.filter((entry) => {
    if (!validUserIds.has(entry.teacherId)) {
      return false;
    }

    const teacher = database.users.find((user) => user.id === entry.teacherId);
    return teacher && teacher.role === "teacher";
  });
  if (database.classes.length !== classesBeforePurge) {
    changed = true;
  }

  const studentMap = new Map(
    database.users
      .filter((entry) => entry.role === "student")
      .map((entry) => [entry.id, entry])
  );
  const allStudentIds = [...studentMap.keys()];

  for (const classItem of database.classes) {
    const normalizedStudentIds = Array.isArray(classItem.studentIds)
      ? [...new Set(classItem.studentIds.filter((studentId) => studentMap.has(studentId)))]
      : allStudentIds.slice();
    const normalizedStudentNames = normalizedStudentIds.map((studentId) => studentMap.get(studentId).name);

    if (!Array.isArray(classItem.studentIds) || classItem.studentIds.length !== normalizedStudentIds.length ||
        classItem.studentIds.some((studentId, index) => studentId !== normalizedStudentIds[index])) {
      classItem.studentIds = normalizedStudentIds;
      changed = true;
    }

    if (!Array.isArray(classItem.studentNames) || classItem.studentNames.length !== normalizedStudentNames.length ||
        classItem.studentNames.some((name, index) => name !== normalizedStudentNames[index])) {
      classItem.studentNames = normalizedStudentNames;
      changed = true;
    }

    const normalizedMeetingProvider = normalizeStoredMeetingProvider(classItem);
    const normalizedMeetingLink = normalizeStoredMeetingLink(classItem);
    const normalizedMeetingMode = normalizeStoredMeetingMode(classItem, normalizedMeetingProvider);

    if (classItem.meetingProvider !== normalizedMeetingProvider) {
      classItem.meetingProvider = normalizedMeetingProvider;
      changed = true;
    }

    if (classItem.meetingMode !== normalizedMeetingMode) {
      classItem.meetingMode = normalizedMeetingMode;
      changed = true;
    }

    if (classItem.meetingLink !== normalizedMeetingLink) {
      classItem.meetingLink = normalizedMeetingLink;
      changed = true;
    }

    const normalizedZoomLink = normalizedMeetingProvider === "zoom" ? normalizedMeetingLink : "";
    if (classItem.zoomLink !== normalizedZoomLink) {
      classItem.zoomLink = normalizedZoomLink;
      changed = true;
    }

    if (!classItem.topic) {
      classItem.topic = `Class with ${normalizedStudentNames.join(", ") || "students"}`;
      changed = true;
    }

    if (!classItem.details) {
      classItem.details = "";
      changed = true;
    }

    if (!classItem.driveLink) {
      classItem.driveLink = "";
      changed = true;
    }
  }

  const validClassIds = new Set(database.classes.map((entry) => entry.id));
  const submissionsBeforePurge = database.submissions.length;
  database.submissions = database.submissions.filter(
    (entry) => validClassIds.has(entry.classId) && validUserIds.has(entry.studentId)
  );
  if (database.submissions.length !== submissionsBeforePurge) {
    changed = true;
  }

  return { database, changed };
}

function createSeedData() {
  const bootstrapAdmin = createBootstrapAdmin();
  const database = {
    users: bootstrapAdmin ? [bootstrapAdmin] : [],
    classes: [],
    submissions: []
  };
  ensureSessionSecret(database);
  return database;
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function cleanupFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Ignore cleanup failures for demo simplicity.
  }
}

function buildStoredHomeworkAsset(file) {
  if (STORAGE_MODE === "postgres") {
    return {
      imageUrl: `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
      filePath: ""
    };
  }

  return {
    imageUrl: `/uploads/${path.basename(file.path)}`,
    filePath: file.path
  };
}

function readDatabaseFromFile() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeDatabaseToFile(payload) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
}

async function readDatabaseFromPostgres() {
  const result = await pool.query(
    "SELECT payload FROM bowser_portal_state WHERE state_key = $1",
    [STORAGE_STATE_KEY]
  );
  if (!result.rows[0]) {
    return null;
  }

  return result.rows[0].payload || null;
}

async function writeDatabaseToPostgres(payload) {
  await pool.query(
    `INSERT INTO bowser_portal_state (state_key, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (state_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [STORAGE_STATE_KEY, JSON.stringify(payload)]
  );
}

function loadSeedDatabase() {
  if (fs.existsSync(REPO_DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(REPO_DATA_FILE, "utf8"));
    } catch (_error) {
      return createSeedData();
    }
  }

  return createSeedData();
}

async function initializeStorage() {
  if (STORAGE_MODE === "postgres") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bowser_portal_state (
        state_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existingDatabase = await readDatabaseFromPostgres();
    if (!existingDatabase) {
      const seededDatabase = loadSeedDatabase();
      normalizeDatabase(seededDatabase);
      await writeDatabaseToPostgres(seededDatabase);
      return;
    }

    const { changed } = normalizeDatabase(existingDatabase);
    if (changed) {
      await writeDatabaseToPostgres(existingDatabase);
    }
    return;
  }

  ensureDirectory(DATA_DIR);
  ensureDirectory(UPLOADS_DIR);
  ensureSeedData();
  ensureDataShape();
}

async function ensureStorageReady() {
  if (storageInitializationError) {
    throw storageInitializationError;
  }

  return storageReady;
}

function shouldUseDatabaseSsl() {
  return process.env.DATABASE_SSL !== "false";
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function normalizeExternalUrl(value, { label, allowedHosts }) {
  const trimmed = String(value || "").trim();
  let parsed;

  if (!trimmed) {
    throw createValidationError(`${label} is required.`);
  }

  try {
    parsed = new URL(trimmed);
  } catch (_error) {
    throw createValidationError(`${label} must be a valid URL.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createValidationError(`${label} must start with http:// or https://.`);
  }

  if (allowedHosts && !allowedHosts.some((host) => hasMatchingHostname(parsed.hostname, host))) {
    throw createValidationError(`${label} must use ${allowedHosts.join(" or ")}.`);
  }

  return parsed.toString();
}

function normalizeMeetingLink(value, meetingProvider) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (meetingProvider === "zoom") {
    const maybeMeetingId = trimmed.replace(/[^\d]/g, "");
    if (maybeMeetingId.length >= 9 && maybeMeetingId.length <= 12 && !/[a-z]/i.test(trimmed)) {
      return `https://zoom.us/j/${maybeMeetingId}`;
    }

    if (/^(www\.)?([\w-]+\.)?zoom\.us\//i.test(trimmed)) {
      return `https://${trimmed.replace(/^https?:\/\//i, "")}`;
    }
  }

  if (meetingProvider === "meet") {
    // Google Meet codes are three groups of letters, e.g. abc-defg-hij.
    if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(trimmed)) {
      return `https://meet.google.com/${trimmed.toLowerCase()}`;
    }

    if (/^(www\.)?meet\.google\.com\//i.test(trimmed)) {
      return `https://${trimmed.replace(/^https?:\/\//i, "")}`;
    }
  }

  if (meetingProvider === "teams" && /^(?:[\w-]+\.)?teams\.(?:microsoft\.(?:com|us|de)|live\.com)\//i.test(trimmed)) {
    return `https://${trimmed.replace(/^https?:\/\//i, "")}`;
  }

  return trimmed;
}

function normalizeMeetingProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "teams") {
    return "teams";
  }

  if (["meet", "google-meet", "googlemeet", "google_meet", "google meet"].includes(normalized)) {
    return "meet";
  }

  if (normalized === "none") {
    return "none";
  }

  return "zoom";
}

function normalizeMeetingMode({ meetingProvider, meetingMode, useAutoZoom }) {
  if (meetingProvider === "none") {
    return "none";
  }

  if (!supportsAutoMeeting(meetingProvider)) {
    return "manual";
  }

  if (meetingMode === "auto" || useAutoZoom === true || useAutoZoom === "true") {
    return "auto";
  }

  return "manual";
}

function getActivationStatus(user) {
  return normalizeUserActivation(user).activationStatus;
}

function isUserActive(user) {
  return normalizeUserActivation(user).isActive;
}

function normalizeUserActivation(user) {
  if (!user || user.role === "admin") {
    return {
      isActive: true,
      activationStatus: "active"
    };
  }

  const normalizedStatus = String(user.activationStatus || "").trim().toLowerCase();
  if (normalizedStatus === "pending") {
    return { isActive: false, activationStatus: "pending" };
  }

  if (normalizedStatus === "inactive") {
    return { isActive: false, activationStatus: "inactive" };
  }

  if (normalizedStatus === "active") {
    return { isActive: true, activationStatus: "active" };
  }

  if (typeof user.isActive === "boolean") {
    return {
      isActive: user.isActive,
      activationStatus: user.isActive ? "active" : "pending"
    };
  }

  return {
    isActive: true,
    activationStatus: "active"
  };
}

function getActivationSortWeight(user) {
  const status = getActivationStatus(user);
  if (status === "pending") {
    return 0;
  }

  if (status === "inactive") {
    return 2;
  }

  return 1;
}

function createBootstrapAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return null;
  }

  return {
    id: "admin-bootstrap",
    role: "admin",
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: hashPassword(ADMIN_PASSWORD),
    subject: "",
    isActive: true,
    activationStatus: "active",
    createdAt: new Date().toISOString()
  };
}

function ensureBootstrapAdmin(database) {
  const bootstrapAdmin = createBootstrapAdmin();
  if (!bootstrapAdmin) {
    return false;
  }

  const existingAdmin = database.users.find(
    (entry) => entry.role === "admin" && String(entry.email || "").toLowerCase() === bootstrapAdmin.email
  );

  if (existingAdmin) {
    let changed = false;
    // Re-hash whenever the stored value no longer matches ADMIN_PASSWORD, which also
    // migrates an admin account that predates password hashing.
    if (!isHashedPassword(existingAdmin.password) || !verifyPassword(ADMIN_PASSWORD, existingAdmin.password)) {
      existingAdmin.password = bootstrapAdmin.password;
      changed = true;
    }
    if (existingAdmin.name !== bootstrapAdmin.name) {
      existingAdmin.name = bootstrapAdmin.name;
      changed = true;
    }
    if (!existingAdmin.createdAt) {
      existingAdmin.createdAt = bootstrapAdmin.createdAt;
      changed = true;
    }
    existingAdmin.isActive = true;
    existingAdmin.activationStatus = "active";
    return changed;
  }

  database.users.push(bootstrapAdmin);
  return true;
}

function normalizeStoredMeetingProvider(classItem) {
  if (classItem.meetingProvider === "none") {
    return "none";
  }

  if (classItem.meetingProvider === "teams") {
    return "teams";
  }

  if (classItem.meetingProvider === "meet") {
    return "meet";
  }

  if (classItem.meetingLink && isLikelyProviderLink(classItem.meetingLink, "teams")) {
    return "teams";
  }

  if (classItem.meetingLink && isLikelyProviderLink(classItem.meetingLink, "meet")) {
    return "meet";
  }

  if (!String(classItem.meetingLink || classItem.zoomLink || "").trim()) {
    return "none";
  }

  return "zoom";
}

function normalizeStoredMeetingLink(classItem) {
  return String(classItem.meetingLink || classItem.zoomLink || "").trim();
}

function normalizeStoredMeetingMode(classItem, meetingProvider) {
  if (meetingProvider === "none") {
    return "none";
  }

  if (!supportsAutoMeeting(meetingProvider)) {
    return "manual";
  }

  return (classItem.autoMeetingId || classItem.zoomMeetingId) ? "auto" : "manual";
}

function getMeetingHosts(meetingProvider) {
  if (meetingProvider === "none") {
    return null;
  }

  const provider = MEETING_PROVIDERS[meetingProvider] || MEETING_PROVIDERS.zoom;
  return provider.hosts;
}

function getMeetingProviderLabel(meetingProvider) {
  if (meetingProvider === "none") {
    return "No class link";
  }

  const provider = MEETING_PROVIDERS[meetingProvider] || MEETING_PROVIDERS.zoom;
  return provider.label;
}

function isLikelyProviderLink(value, meetingProvider) {
  const provider = MEETING_PROVIDERS[meetingProvider];
  if (!provider) {
    return false;
  }

  try {
    const parsed = new URL(String(value || "").trim());
    return provider.hosts.some((host) => hasMatchingHostname(parsed.hostname, host));
  } catch (_error) {
    return false;
  }
}

function hasMatchingHostname(hostname, allowedHost) {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

function resolveSelectedStudents(database, studentIds) {
  const rawIds = Array.isArray(studentIds) ? studentIds : [studentIds];
  const normalizedIds = [...new Set(rawIds.map((entry) => String(entry || "").trim()).filter(Boolean))];

  if (!normalizedIds.length) {
    throw createValidationError("Select at least one kid for the class.");
  }

  const students = normalizedIds.map((studentId) =>
    database.users.find((entry) => entry.id === studentId && entry.role === "student")
  );

  if (students.some((student) => !student)) {
    throw createValidationError("One or more selected kids could not be found.");
  }

  if (students.some((student) => !isUserActive(student))) {
    throw createValidationError("Selected kid accounts must be active before scheduling classes.");
  }

  return students;
}

function clampText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function buildClassSchedulePlan(body) {
  const scheduleMode = String(body.scheduleMode || "once").trim().toLowerCase();
  const durationMinutes = Number(body.durationMinutes || 45);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 180) {
    throw createValidationError("Class duration must be between 15 and 180 minutes.");
  }

  const topic = clampText(body.topic, MAX_TOPIC_LENGTH);
  const details = clampText(body.details, MAX_TEXT_LENGTH);
  const driveLink = String(body.driveLink || "").trim();
  const studentIds = body.studentIds;
  const meetingProvider = body.meetingProvider;
  const meetingMode = body.meetingMode;
  const useAutoZoom = body.useAutoZoom;
  const manualMeetingLink = String(body.manualMeetingLink || body.manualZoomLink || "").trim();

  if (scheduleMode === "series" || scheduleMode === "recurring" || scheduleMode === "month") {
    const slots = expandSeriesSlots(body);
    if (!slots.length) {
      throw createValidationError("No class dates match that schedule pattern. Adjust the range or days.");
    }

    if (slots.length > MAX_SERIES_CLASSES) {
      throw createValidationError(`A series can create at most ${MAX_SERIES_CLASSES} classes. Narrow the date range or times.`);
    }

    return {
      slots,
      durationMinutes,
      topic,
      details,
      driveLink,
      studentIds,
      meetingProvider,
      meetingMode,
      useAutoZoom,
      manualMeetingLink
    };
  }

  if (!body.dateTime) {
    throw createValidationError("Class date and time are required.");
  }

  const scheduledDate = new Date(String(body.dateTime));
  if (Number.isNaN(scheduledDate.getTime())) {
    throw createValidationError("Please choose a valid class date and time.");
  }

  return {
    slots: [scheduledDate],
    durationMinutes,
    topic,
    details,
    driveLink,
    studentIds,
    meetingProvider,
    meetingMode,
    useAutoZoom,
    manualMeetingLink
  };
}

function expandSeriesSlots(body) {
  const startDateRaw = String(body.seriesStartDate || body.startDate || "").trim();
  let endDateRaw = String(body.seriesEndDate || body.endDate || "").trim();
  const pattern = String(body.seriesPattern || body.pattern || "weekdays").trim().toLowerCase();

  if (!startDateRaw) {
    throw createValidationError("Choose a start date for the class series.");
  }

  const startDate = parseLocalDateOnly(startDateRaw);
  if (!startDate) {
    throw createValidationError("Start date is invalid.");
  }

  if (!endDateRaw) {
    // Default to the rest of the start month when teachers schedule a full month.
    const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 12, 0, 0, 0);
    endDateRaw = formatLocalDateOnly(monthEnd);
  }

  const endDate = parseLocalDateOnly(endDateRaw);
  if (!endDate) {
    throw createValidationError("End date is invalid.");
  }

  if (endDate < startDate) {
    throw createValidationError("End date must be on or after the start date.");
  }

  const maxSpanMs = 62 * 24 * 60 * 60 * 1000;
  if (endDate.getTime() - startDate.getTime() > maxSpanMs) {
    throw createValidationError("Series range cannot be longer than about two months.");
  }

  const times = normalizeSeriesTimes(body);
  const weekdays = normalizeSeriesWeekdays(body.seriesWeekdays || body.weekdays, pattern);
  const slots = [];
  const cursor = new Date(startDate);
  let dayIndex = 0;

  while (cursor <= endDate) {
    const weekday = cursor.getDay();
    let includeDay = false;

    if (pattern === "daily" || pattern === "every-day") {
      includeDay = true;
    } else if (pattern === "alternate" || pattern === "every-other-day") {
      includeDay = dayIndex % 2 === 0;
    } else if (pattern === "weekdays" || pattern === "custom") {
      includeDay = weekdays.includes(weekday);
    } else {
      throw createValidationError("Choose a valid schedule pattern: weekdays, daily, or alternate days.");
    }

    if (includeDay) {
      for (const time of times) {
        const [hours, minutes] = time.split(":").map(Number);
        const slot = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          hours,
          minutes,
          0,
          0
        );
        slots.push(slot);
      }
    }

    cursor.setDate(cursor.getDate() + 1);
    dayIndex += 1;
  }

  return slots;
}

function normalizeSeriesTimes(body) {
  const rawTimes = Array.isArray(body.seriesTimes)
    ? body.seriesTimes
    : Array.isArray(body.times)
      ? body.times
      : [];

  let times = rawTimes
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map(normalizeTimeValue);

  if (!times.length && body.dateTime) {
    const fromDateTime = new Date(String(body.dateTime));
    if (!Number.isNaN(fromDateTime.getTime())) {
      times = [
        `${String(fromDateTime.getHours()).padStart(2, "0")}:${String(fromDateTime.getMinutes()).padStart(2, "0")}`
      ];
    }
  }

  if (!times.length && body.seriesTime) {
    times = [normalizeTimeValue(body.seriesTime)];
  }

  if (!times.length) {
    throw createValidationError("Add at least one class time for the series.");
  }

  if (times.length > 6) {
    throw createValidationError("You can set up to 6 class times per day.");
  }

  return [...new Set(times)].sort();
}

function normalizeTimeValue(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw createValidationError("Class times must use HH:MM format, for example 16:00.");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw createValidationError("Class times must use a valid 24-hour clock time.");
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeSeriesWeekdays(rawWeekdays, pattern) {
  if (pattern === "daily" || pattern === "every-day" || pattern === "alternate" || pattern === "every-other-day") {
    return [];
  }

  const source = Array.isArray(rawWeekdays) && rawWeekdays.length
    ? rawWeekdays
    : [1, 2, 3, 4, 5]; // Mon–Fri default

  const weekdays = [...new Set(source.map((entry) => Number(entry)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  if (!weekdays.length) {
    throw createValidationError("Select at least one weekday for the series.");
  }

  return weekdays;
}

function parseLocalDateOnly(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function formatLocalDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function getClientRateKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || "unknown";
}

function isRateLimited(key) {
  pruneLoginAttempts();
  const entry = loginAttemptTracker.get(key);
  if (!entry) {
    return false;
  }

  return entry.count >= LOGIN_RATE_MAX_ATTEMPTS && entry.resetAt > Date.now();
}

function registerFailedLogin(key) {
  pruneLoginAttempts();
  const now = Date.now();
  const entry = loginAttemptTracker.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttemptTracker.set(key, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return;
  }

  entry.count += 1;
  loginAttemptTracker.set(key, entry);
}

function clearFailedLogins(key) {
  loginAttemptTracker.delete(key);
}

function pruneLoginAttempts() {
  const now = Date.now();
  for (const [key, entry] of loginAttemptTracker.entries()) {
    if (entry.resetAt <= now) {
      loginAttemptTracker.delete(key);
    }
  }
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function supportsAutoMeeting(meetingProvider) {
  const provider = MEETING_PROVIDERS[meetingProvider];
  return Boolean(provider && provider.supportsAuto);
}

async function createAutoMeeting(meetingProvider, options) {
  if (meetingProvider === "meet") {
    return createGoogleMeetMeeting(options);
  }

  return createZoomMeeting(options);
}

function isGoogleMeetConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

async function createGoogleMeetMeeting({ topic, agenda, startTime, durationMinutes }) {
  if (!isGoogleMeetConfigured()) {
    const error = new Error("Google Meet is not configured yet. Add credentials in .env or paste a manual Google Meet link.");
    error.code = "GOOGLE_MEET_NOT_CONFIGURED";
    throw error;
  }

  const accessToken = await createGoogleAccessToken();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const eventResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: topic,
        description: agenda,
        start: {
          dateTime: start.toISOString(),
          timeZone: MEETING_TIMEZONE
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: MEETING_TIMEZONE
        },
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" }
          }
        }
      })
    }
  );

  if (!eventResponse.ok) {
    const details = await readApiError(eventResponse);
    const error = new Error(`Google Meet could not create the meeting: ${details}. Verify GOOGLE_CALENDAR_ID and that the OAuth client has the https://www.googleapis.com/auth/calendar.events scope.`);
    error.statusCode = 502;
    throw error;
  }

  const event = await eventResponse.json();
  const joinUrl = readGoogleMeetLink(event);

  if (!joinUrl) {
    const error = new Error("Google created the calendar event but returned no Meet link. Check that Meet conferencing is enabled for that Google account.");
    error.statusCode = 502;
    throw error;
  }

  return {
    meetingId: String((event.conferenceData && event.conferenceData.conferenceId) || event.id || ""),
    joinUrl,
    startUrl: ""
  };
}

async function createGoogleAccessToken() {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    }).toString()
  });

  if (!tokenResponse.ok) {
    const details = await readApiError(tokenResponse);
    const error = new Error(`Google auth failed: ${details}. Re-check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN in .env.`);
    error.statusCode = 502;
    throw error;
  }

  const tokenPayload = await tokenResponse.json();
  if (!tokenPayload.access_token) {
    const error = new Error("Google auth returned no access token. Re-check that GOOGLE_REFRESH_TOKEN is still valid.");
    error.statusCode = 502;
    throw error;
  }

  return tokenPayload.access_token;
}

function readGoogleMeetLink(event) {
  if (event && typeof event.hangoutLink === "string" && event.hangoutLink) {
    return event.hangoutLink;
  }

  const entryPoints = event && event.conferenceData ? event.conferenceData.entryPoints : null;
  if (!Array.isArray(entryPoints)) {
    return "";
  }

  const videoEntry = entryPoints.find((entry) => entry && entry.entryPointType === "video" && entry.uri);
  return videoEntry ? String(videoEntry.uri) : "";
}

function isZoomConfigured() {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID &&
    process.env.ZOOM_CLIENT_ID &&
    process.env.ZOOM_CLIENT_SECRET &&
    process.env.ZOOM_USER_ID
  );
}

async function createZoomMeeting({ teacher, topic, agenda, startTime, durationMinutes }) {
  if (!isZoomConfigured()) {
    const error = new Error("Zoom is not configured yet. Add credentials in .env or use a manual Zoom link.");
    error.code = "ZOOM_NOT_CONFIGURED";
    throw error;
  }

  const credentials = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const tokenResponse = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`
      }
    }
  );

  if (!tokenResponse.ok) {
    const details = await readApiError(tokenResponse);
    const error = new Error(`Zoom auth failed: ${details}. Re-check ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in .env.`);
    error.statusCode = 502;
    throw error;
  }

  const tokenPayload = await tokenResponse.json();
  const meetingResponse = await fetch(
    `https://api.zoom.us/v2/users/${encodeURIComponent(process.env.ZOOM_USER_ID)}/meetings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        topic,
        type: 2,
        start_time: startTime,
        duration: durationMinutes,
        timezone: MEETING_TIMEZONE,
        agenda,
        settings: {
          join_before_host: false,
          waiting_room: true,
          participant_video: true,
          host_video: true
        }
      })
    }
  );

  if (!meetingResponse.ok) {
    const details = await readApiError(meetingResponse);
    const error = new Error(`Zoom could not create the meeting: ${details}. Verify ZOOM_USER_ID and that the Server-to-Server OAuth app has the meeting:write scope.`);
    error.statusCode = 502;
    throw error;
  }

  const meeting = await meetingResponse.json();
  return {
    meetingId: String(meeting.id || ""),
    joinUrl: meeting.join_url,
    startUrl: meeting.start_url || ""
  };
}

async function readApiError(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object") {
      if (payload.message) {
        return String(payload.message);
      }

      if (payload.reason) {
        return String(payload.reason);
      }

      if (payload.error && typeof payload.error === "object" && payload.error.message) {
        return String(payload.error.message);
      }

      if (payload.error_description) {
        return String(payload.error_description);
      }

      if (typeof payload.error === "string") {
        return payload.error;
      }
    }

    return `HTTP ${response.status}`;
  } catch (_error) {
    try {
      const text = await response.text();
      return text ? text.slice(0, 240) : `HTTP ${response.status}`;
    } catch (_inner) {
      return `HTTP ${response.status}`;
    }
  }
}

module.exports = app;
module.exports.app = app;
module.exports.buildDashboard = buildDashboard;
module.exports.isZoomConfigured = isZoomConfigured;
module.exports.isGoogleMeetConfigured = isGoogleMeetConfigured;
module.exports.createGoogleMeetMeeting = createGoogleMeetMeeting;
module.exports.normalizeExternalUrl = normalizeExternalUrl;
