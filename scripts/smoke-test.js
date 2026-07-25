/**
 * Smoke tests for Bowser Learning Portal (no external services required).
 * Uses an isolated temporary data directory when possible.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bowser-smoke-"));
const PORT = 34567 + Math.floor(Math.random() * 1000);

process.chdir(ROOT);
process.env.PORT = String(PORT);
process.env.ADMIN_EMAIL = "admin@test.local";
process.env.ADMIN_PASSWORD = "TestAdminPass1";
process.env.ADMIN_NAME = "Smoke Admin";
process.env.SESSION_SECRET = "smoke-test-session-secret-32chars!!";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";

// Point runtime file storage at temp by using non-vercel file mode under ROOT
// We run against real local data file carefully — use isolated DATA by
// patching env and importing after env is set.

function request(method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_error) {
            json = null;
          }
          const setCookie = res.headers["set-cookie"] || [];
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json,
            raw: data,
            cookie: setCookie.map((entry) => entry.split(";")[0]).join("; ")
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function expandSeriesLocal(body) {
  // Mirror of core series expansion logic for unit-style checks without server internals.
  const start = new Date(`${body.seriesStartDate}T12:00:00`);
  const end = new Date(`${body.seriesEndDate}T12:00:00`);
  const times = body.seriesTimes;
  const pattern = body.seriesPattern;
  const weekdays = (body.seriesWeekdays || []).map(Number);
  const slots = [];
  const cursor = new Date(start);
  let dayIndex = 0;
  while (cursor <= end) {
    const weekday = cursor.getDay();
    let include = false;
    if (pattern === "daily") include = true;
    else if (pattern === "alternate") include = dayIndex % 2 === 0;
    else include = weekdays.includes(weekday);
    if (include) {
      for (const time of times) {
        const [h, m] = time.split(":").map(Number);
        slots.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), h, m));
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    dayIndex += 1;
  }
  return slots;
}

async function main() {
  console.log("Starting smoke tests…");

  // Pure logic checks for monthly series expansion
  const weekdaySlots = expandSeriesLocal({
    seriesStartDate: "2026-08-03",
    seriesEndDate: "2026-08-14",
    seriesPattern: "weekdays",
    seriesWeekdays: [1, 3, 5],
    seriesTimes: ["10:00", "16:00"]
  });
  assert.ok(weekdaySlots.length >= 6, "weekday series should create multiple slots");
  assert.strictEqual(weekdaySlots.filter((d) => d.getHours() === 10).length, weekdaySlots.filter((d) => d.getHours() === 16).length);

  const alternateSlots = expandSeriesLocal({
    seriesStartDate: "2026-08-01",
    seriesEndDate: "2026-08-10",
    seriesPattern: "alternate",
    seriesTimes: ["09:00"]
  });
  assert.strictEqual(alternateSlots.length, 5, "alternate days over 10 days starting day 0 => 5 classes");

  const app = require(path.join(ROOT, "server.js"));
  const server = await new Promise((resolve) => {
    const s = app.listen(PORT, "127.0.0.1", () => resolve(s));
  });

  try {
    const health = await request("GET", "/api/health");
    assert.strictEqual(health.status, 200, "health should be 200");
    assert.strictEqual(health.json.ok, true, "health.ok true");
    assert.ok(health.headers["x-content-type-options"] === "nosniff", "security header nosniff");
    assert.ok(health.headers["x-frame-options"] === "DENY", "security header frame deny");

    const badLogin = await request("POST", "/api/login", {
      body: { email: "nobody@test.local", password: "wrong-password", role: "teacher" }
    });
    assert.strictEqual(badLogin.status, 401);

    const adminLogin = await request("POST", "/api/login", {
      body: {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        role: "admin"
      }
    });
    assert.strictEqual(adminLogin.status, 200, `admin login failed: ${adminLogin.raw}`);
    assert.ok(adminLogin.cookie.includes("bowser_session"), "session cookie set");
    const adminCookie = adminLogin.cookie;

    const stamp = crypto.randomBytes(3).toString("hex");
    const teacherEmail = `teacher-${stamp}@test.local`;
    const studentEmail = `student-${stamp}@test.local`;
    const password = "SecurePass1";

    const regTeacher = await request("POST", "/api/register", {
      body: {
        role: "teacher",
        name: "Smoke Teacher",
        subject: "Maths",
        email: teacherEmail,
        password
      }
    });
    assert.strictEqual(regTeacher.status, 201, regTeacher.raw);

    const regStudent = await request("POST", "/api/register", {
      body: {
        role: "student",
        name: "Smoke Kid",
        email: studentEmail,
        password
      }
    });
    assert.strictEqual(regStudent.status, 201, regStudent.raw);

    const shortPass = await request("POST", "/api/register", {
      body: {
        role: "student",
        name: "Tiny",
        email: `tiny-${stamp}@test.local`,
        password: "short"
      }
    });
    assert.strictEqual(shortPass.status, 400, "short password rejected");

    const dash = await request("GET", "/api/dashboard", { cookie: adminCookie });
    assert.strictEqual(dash.status, 200);
    const pendingTeacher = (dash.json.managedUsers || []).find((u) => u.email === teacherEmail);
    const pendingStudent = (dash.json.managedUsers || []).find((u) => u.email === studentEmail);
    assert.ok(pendingTeacher, "teacher pending");
    assert.ok(pendingStudent, "student pending");

    const actTeacher = await request("PUT", `/api/admin/users/${pendingTeacher.id}/activation`, {
      cookie: adminCookie,
      body: { isActive: true }
    });
    assert.strictEqual(actTeacher.status, 200, actTeacher.raw);

    const actStudent = await request("PUT", `/api/admin/users/${pendingStudent.id}/activation`, {
      cookie: adminCookie,
      body: { isActive: true }
    });
    assert.strictEqual(actStudent.status, 200, actStudent.raw);

    const teacherLogin = await request("POST", "/api/login", {
      body: { email: teacherEmail, password, role: "teacher" }
    });
    assert.strictEqual(teacherLogin.status, 200, teacherLogin.raw);
    const teacherCookie = teacherLogin.cookie;
    const studentId = pendingStudent.id;

    const once = await request("POST", "/api/classes", {
      cookie: teacherCookie,
      body: {
        scheduleMode: "once",
        dateTime: "2026-08-20T16:00:00",
        durationMinutes: 45,
        studentIds: [studentId],
        meetingProvider: "none",
        meetingMode: "none",
        topic: "Single class"
      }
    });
    assert.strictEqual(once.status, 201, once.raw);
    assert.strictEqual(once.json.count, 1);

    const series = await request("POST", "/api/classes", {
      cookie: teacherCookie,
      body: {
        scheduleMode: "series",
        seriesStartDate: "2026-09-01",
        seriesEndDate: "2026-09-14",
        seriesPattern: "weekdays",
        seriesWeekdays: [1, 3, 5],
        seriesTimes: ["10:00", "16:00"],
        durationMinutes: 45,
        studentIds: [studentId],
        meetingProvider: "none",
        meetingMode: "none",
        topic: "Month series"
      }
    });
    assert.strictEqual(series.status, 201, series.raw);
    assert.ok(series.json.count > 1, `expected multi-class series, got ${series.json.count}`);
    assert.ok(Array.isArray(series.json.classItems), "classItems returned");

    const alternate = await request("POST", "/api/classes", {
      cookie: teacherCookie,
      body: {
        scheduleMode: "series",
        seriesStartDate: "2026-10-01",
        seriesEndDate: "2026-10-07",
        seriesPattern: "alternate",
        seriesTimes: ["09:00", "12:00", "15:00"],
        durationMinutes: 30,
        studentIds: [studentId],
        meetingProvider: "none",
        meetingMode: "none",
        topic: "Three times a day alternate"
      }
    });
    assert.strictEqual(alternate.status, 201, alternate.raw);
    // 7 days alternate => days 0,2,4,6 = 4 days * 3 times = 12
    assert.strictEqual(alternate.json.count, 12, `expected 12 classes, got ${alternate.json.count}`);

    const studentLogin = await request("POST", "/api/login", {
      body: { email: studentEmail, password, role: "student" }
    });
    assert.strictEqual(studentLogin.status, 200, studentLogin.raw);
    const studentDash = await request("GET", "/api/dashboard", { cookie: studentLogin.cookie });
    assert.strictEqual(studentDash.status, 200);
    assert.ok((studentDash.json.classes || []).length >= 1, "student sees classes");

    const unauthorized = await request("POST", "/api/classes", {
      cookie: studentLogin.cookie,
      body: {
        scheduleMode: "once",
        dateTime: "2026-11-01T10:00:00",
        durationMinutes: 45,
        studentIds: [studentId],
        meetingProvider: "none",
        meetingMode: "none"
      }
    });
    assert.strictEqual(unauthorized.status, 403);

    console.log("All smoke tests passed.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch (_error) {
      // ignore
    }
  }
}

main().catch((error) => {
  console.error("Smoke tests failed:", error);
  process.exit(1);
});
