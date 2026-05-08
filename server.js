const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "portal-data.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
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

ensureDirectory(DATA_DIR);
ensureDirectory(UPLOADS_DIR);
ensureSeedData();
ensureDataShape();

const upload = multer({
  storage: multer.diskStorage({
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

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/app.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/styles.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "styles.css"));
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    zoomConfigured: isZoomConfigured(),
    teamsSupported: true
  });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const database = readDatabase();
  const user = database.users.find(
    (entry) =>
      entry.email.toLowerCase() === String(email || "").trim().toLowerCase() &&
      entry.password === String(password || "").trim()
  );

  if (!user) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  res.json({
    user: sanitizeUser(user),
    dashboard: buildDashboard(user.id)
  });
});

app.post("/api/register", (req, res) => {
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

  if (normalizedPassword.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters long." });
    return;
  }

  const database = readDatabase();
  if (database.users.some((entry) => entry.email.toLowerCase() === normalizedEmail)) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const user = {
    id: `${normalizedRole}-${crypto.randomUUID()}`,
    role: normalizedRole,
    name: normalizedName,
    email: normalizedEmail,
    password: normalizedPassword
  };

  if (normalizedRole === "teacher") {
    user.subject = normalizedSubject || "General";
  }

  database.users.push(user);
  writeDatabase(database);

  res.status(201).json({
    user: sanitizeUser(user),
    dashboard: buildDashboard(user.id)
  });
});

app.get("/api/dashboard", (req, res) => {
  const userId = String(req.query.userId || "");
  try {
    const dashboard = buildDashboard(userId);
    res.json(dashboard);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/api/classes", async (req, res) => {
  const {
    teacherId,
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

  const database = readDatabase();
  const teacher = database.users.find((entry) => entry.id === teacherId && entry.role === "teacher");

  if (!teacher) {
    res.status(403).json({ error: "Teacher account not found." });
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

    let meetingLink = "";
    let zoomMetadata = null;

    if (normalizedMeetingProvider === "zoom" && normalizedMeetingMode === "auto") {
      zoomMetadata = await createZoomMeeting({
        teacher,
        topic: String(topic || "").trim() || `Class with ${selectedStudents.map((student) => student.name).join(", ")}`,
        agenda: String(details || "").trim(),
        startTime: scheduledDate.toISOString(),
        durationMinutes: normalizedDuration
      });
      meetingLink = zoomMetadata.joinUrl;
    } else if (normalizedMeetingProvider !== "none" && rawManualMeetingLink) {
      const normalizedLink = normalizeMeetingLink(rawManualMeetingLink, normalizedMeetingProvider);
      meetingLink = normalizeExternalUrl(normalizedLink, {
        label: `${getMeetingProviderLabel(normalizedMeetingProvider)} class link`,
        allowedHosts: getMeetingHosts(normalizedMeetingProvider)
      });
    }

    const classItem = {
      id: `class-${crypto.randomUUID()}`,
      teacherId: teacher.id,
      teacherName: teacher.name,
      subject: teacher.subject,
      topic: String(topic || "").trim() || `Class with ${selectedStudents.map((student) => student.name).join(", ")}`,
      details: String(details || "").trim(),
      dateTime: scheduledDate.toISOString(),
      durationMinutes: normalizedDuration,
      studentIds: selectedStudents.map((student) => student.id),
      studentNames: selectedStudents.map((student) => student.name),
      meetingProvider: normalizedMeetingProvider,
      meetingMode: normalizedMeetingMode,
      meetingLink,
      zoomLink: normalizedMeetingProvider === "zoom" ? meetingLink : "",
      driveLink: normalizedDriveLink,
      zoomMeetingId: zoomMetadata ? zoomMetadata.meetingId : "",
      zoomStartUrl: zoomMetadata ? zoomMetadata.startUrl : "",
      createdAt: new Date().toISOString()
    };

    database.classes.push(classItem);
    writeDatabase(database);
    res.status(201).json({
      classItem,
      message: normalizedMeetingProvider === "zoom" && zoomMetadata
        ? "Zoom class link created and shared with students."
        : meetingLink
          ? `${getMeetingProviderLabel(normalizedMeetingProvider)} class link saved and shared with students.`
          : "Class scheduled successfully. You can add a class link later if needed."
    });
  } catch (error) {
    const status = error.code === "ZOOM_NOT_CONFIGURED"
      ? 400
      : (error.statusCode || 502);
    res.status(status).json({ error: error.message });
  }
});

app.put("/api/classes/:classId", async (req, res) => {
  const { classId } = req.params;
  const {
    teacherId,
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

  const database = readDatabase();
  const teacher = database.users.find((entry) => entry.id === teacherId && entry.role === "teacher");
  const classItem = database.classes.find((entry) => entry.id === classId);

  if (!teacher || !classItem) {
    res.status(404).json({ error: "Teacher or class not found." });
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
    let zoomMetadata = null;

    if (normalizedMeetingProvider === "zoom" && normalizedMeetingMode === "auto") {
      zoomMetadata = await createZoomMeeting({
        teacher,
        topic: String(topic || "").trim() || `Class with ${selectedStudents.map((student) => student.name).join(", ")}`,
        agenda: String(details || "").trim(),
        startTime: scheduledDate.toISOString(),
        durationMinutes: normalizedDuration
      });
      meetingLink = zoomMetadata.joinUrl;
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
      classItem.zoomMeetingId = "";
      classItem.zoomStartUrl = "";
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
    classItem.zoomMeetingId = zoomMetadata ? zoomMetadata.meetingId : "";
    classItem.zoomStartUrl = zoomMetadata ? zoomMetadata.startUrl : "";

    writeDatabase(database);
    res.json({
      classItem,
      message: zoomMetadata
        ? "Class updated and new Zoom class link created."
        : "Class updated successfully."
    });
  } catch (error) {
    const status = error.code === "ZOOM_NOT_CONFIGURED"
      ? 400
      : (error.statusCode || 502);
    res.status(status).json({ error: error.message });
  }
});

app.post("/api/submissions", handleHomeworkUpload, (req, res) => {
  const { classId, studentId } = req.body || {};
  const file = req.file;

  if (!classId || !studentId || !file) {
    res.status(400).json({ error: "Class, student, and homework image are required." });
    return;
  }

  const database = readDatabase();
  const student = database.users.find((entry) => entry.id === studentId && entry.role === "student");
  const classItem = database.classes.find((entry) => entry.id === classId);

  if (!student || !classItem) {
    cleanupFile(file.path);
    res.status(404).json({ error: "Student or class could not be found." });
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

  const storedUrl = `/uploads/${path.basename(file.path)}`;
  const submissionPayload = {
    id: existingSubmission ? existingSubmission.id : `submission-${crypto.randomUUID()}`,
    classId,
    studentId,
    studentName: student.name,
    subject: classItem.subject,
    imageUrl: storedUrl,
    filePath: file.path,
    submittedAt: new Date().toISOString(),
    score: existingSubmission ? "" : "",
    feedback: existingSubmission ? "" : ""
  };

  if (existingSubmission) {
    Object.assign(existingSubmission, submissionPayload);
  } else {
    database.submissions.push(submissionPayload);
  }

  writeDatabase(database);
  res.status(201).json({ message: "Homework uploaded successfully." });
});

app.put("/api/classes/:classId/meeting", async (req, res) => {
  const { classId } = req.params;
  const {
    teacherId,
    meetingProvider,
    meetingMode,
    useAutoZoom,
    manualMeetingLink,
    manualZoomLink
  } = req.body || {};

  const database = readDatabase();
  const teacher = database.users.find((entry) => entry.id === teacherId && entry.role === "teacher");
  const classItem = database.classes.find((entry) => entry.id === classId);

  if (!teacher || !classItem) {
    res.status(404).json({ error: "Teacher or class not found." });
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
    let zoomMetadata = null;

    if (normalizedMeetingProvider === "zoom" && normalizedMeetingMode === "auto") {
      zoomMetadata = await createZoomMeeting({
        teacher,
        topic: classItem.topic,
        agenda: classItem.details,
        startTime: new Date(classItem.dateTime).toISOString(),
        durationMinutes: classItem.durationMinutes
      });
      meetingLink = zoomMetadata.joinUrl;
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
    classItem.zoomMeetingId = zoomMetadata ? zoomMetadata.meetingId : "";
    classItem.zoomStartUrl = zoomMetadata ? zoomMetadata.startUrl : "";
    writeDatabase(database);

    res.json({
      classItem,
      message: normalizedMeetingProvider === "none"
        ? "Class link cleared."
        : zoomMetadata
          ? "Zoom class link created and shared with students."
          : `${getMeetingProviderLabel(normalizedMeetingProvider)} class link saved and shared with students.`
    });
  } catch (error) {
    const status = error.code === "ZOOM_NOT_CONFIGURED"
      ? 400
      : (error.statusCode || 502);
    res.status(status).json({ error: error.message });
  }
});

app.put("/api/submissions/:submissionId/grade", (req, res) => {
  const { submissionId } = req.params;
  const { teacherId, score, feedback } = req.body || {};
  const database = readDatabase();
  const teacher = database.users.find((entry) => entry.id === teacherId && entry.role === "teacher");
  const submission = database.submissions.find((entry) => entry.id === submissionId);

  if (!teacher || !submission) {
    res.status(404).json({ error: "Teacher or submission not found." });
    return;
  }

  const classItem = database.classes.find((entry) => entry.id === submission.classId);
  if (!classItem || classItem.teacherId !== teacher.id) {
    res.status(403).json({ error: "You can only rank homework for your own classes." });
    return;
  }

  submission.score = String(score || "").trim();
  submission.feedback = String(feedback || "").trim();
  writeDatabase(database);

  res.json({ message: "Homework ranking saved." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Bowser portal running at http://localhost:${PORT}`);
  });
}

function buildDashboard(userId) {
  const database = readDatabase();
  const user = database.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const students = database.users.filter((entry) => entry.role === "student");
  const classes = user.role === "teacher"
    ? database.classes.filter((entry) => entry.teacherId === user.id)
    : database.classes.filter((entry) => Array.isArray(entry.studentIds) && entry.studentIds.includes(user.id));

  const submissions = user.role === "teacher"
    ? database.submissions.filter((submission) =>
        classes.some((classItem) => classItem.id === submission.classId)
      )
    : database.submissions.filter((submission) => submission.studentId === user.id);

  classes.sort((left, right) => new Date(left.dateTime) - new Date(right.dateTime));
  submissions.sort((left, right) => new Date(right.submittedAt) - new Date(left.submittedAt));

  return {
    user: sanitizeUser(user),
    students: (user.role === "teacher" ? students : students.filter((entry) => entry.id === user.id)).map(sanitizeUser),
    classes,
    submissions,
    zoomConfigured: isZoomConfigured(),
    teamsSupported: true
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    role: user.role,
    subject: user.subject || "",
    name: user.name,
    email: user.email
  };
}

function readDatabase() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeDatabase(payload) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
}

function ensureSeedData() {
  if (fs.existsSync(DATA_FILE)) {
    return;
  }

  writeDatabase(createSeedData());
}

function ensureDataShape() {
  const database = readDatabase();
  let changed = false;
  const usersBeforePurge = database.users.length;
  database.users = database.users.filter(
    (entry) => !LEGACY_DEMO_USER_IDS.has(entry.id) && !LEGACY_DEMO_EMAILS.has(String(entry.email || "").toLowerCase())
  );
  if (database.users.length !== usersBeforePurge) {
    changed = true;
  }

  const validUserIds = new Set(database.users.map((entry) => entry.id));
  const classesBeforePurge = database.classes.length;
  database.classes = database.classes.filter((entry) => validUserIds.has(entry.teacherId));
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

  if (changed) {
    writeDatabase(database);
  }
}

function createSeedData() {
  return {
    users: [],
    classes: [],
    submissions: []
  };
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

  if (normalized === "none") {
    return "none";
  }

  return "zoom";
}

function normalizeMeetingMode({ meetingProvider, meetingMode, useAutoZoom }) {
  if (meetingProvider === "none") {
    return "none";
  }

  if (meetingProvider !== "zoom") {
    return "manual";
  }

  if (meetingMode === "auto" || useAutoZoom === true || useAutoZoom === "true") {
    return "auto";
  }

  return "manual";
}

function normalizeStoredMeetingProvider(classItem) {
  if (classItem.meetingProvider === "none") {
    return "none";
  }

  if (classItem.meetingProvider === "teams") {
    return "teams";
  }

  if (classItem.meetingLink && isLikelyTeamsLink(classItem.meetingLink)) {
    return "teams";
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

  if (meetingProvider !== "zoom") {
    return "manual";
  }

  return classItem.zoomMeetingId ? "auto" : "manual";
}

function getMeetingHosts(meetingProvider) {
  if (meetingProvider === "none") {
    return null;
  }

  return meetingProvider === "teams"
    ? [
        "teams.microsoft.com",
        "teams.live.com",
        "teams.microsoft.us",
        "teams.microsoft.de"
      ]
    : ["zoom.us"];
}

function getMeetingProviderLabel(meetingProvider) {
  if (meetingProvider === "none") {
    return "No class link";
  }

  return meetingProvider === "teams" ? "Teams" : "Zoom";
}

function isLikelyTeamsLink(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return [
      "teams.microsoft.com",
      "teams.live.com",
      "teams.microsoft.us",
      "teams.microsoft.de"
    ].some((host) => hasMatchingHostname(parsed.hostname, host));
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

  return students;
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
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
    const details = await readZoomError(tokenResponse);
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
        timezone: "Asia/Riyadh",
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
    const details = await readZoomError(meetingResponse);
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

async function readZoomError(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object") {
      if (payload.message) {
        return String(payload.message);
      }

      if (payload.reason) {
        return String(payload.reason);
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

module.exports = {
  app,
  buildDashboard,
  isZoomConfigured,
  normalizeExternalUrl
};
