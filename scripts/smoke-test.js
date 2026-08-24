/**
 * API health tests for Bowser Learning Portal (no external services required).
 * Uses an isolated temporary data directory (BOWSER_DATA_ROOT) so real portal
 * data is never modified.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bowser-api-test-"));
const PORT = 34567 + Math.floor(Math.random() * 1000);

process.chdir(ROOT);
process.env.PORT = String(PORT);
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.ADMIN_PASSWORD = "TestAdminPass1";
process.env.ADMIN_NAME = "Portal Admin";
process.env.SESSION_SECRET = "api-test-session-secret-32chars!!!!";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
// Never touch the real Desktop/Bowser/data store during automated tests.
process.env.BOWSER_DATA_ROOT = TMP;

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
  console.log("Starting API tests…");

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
      body: { email: "nobody@example.test", password: "wrong-password", role: "teacher" }
    });
    assert.strictEqual(badLogin.status, 401);

    async function loginWith2fa(email, password) {
      const step1 = await request("POST", "/api/login", {
        body: { email, password }
      });
      assert.strictEqual(step1.status, 200, `login step1 failed: ${step1.raw}`);
      assert.strictEqual(step1.json.requires2fa, true, "expects 2FA challenge");
      assert.ok(step1.json.challengeId, "challengeId required");
      assert.ok(step1.json.devCode, "devCode should be exposed in tests");
      const step2 = await request("POST", "/api/login/verify-2fa", {
        body: {
          challengeId: step1.json.challengeId,
          code: step1.json.devCode
        }
      });
      assert.strictEqual(step2.status, 200, `login step2 failed: ${step2.raw}`);
      assert.ok(step2.cookie.includes("bowser_session"), "session cookie set after 2FA");
      return step2;
    }

    const adminLogin = await loginWith2fa(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const adminCookie = adminLogin.cookie;

    const stamp = crypto.randomBytes(3).toString("hex");
    const phoneStamp = String(Date.now()).slice(-7);
    const teacherEmail = `teacher.${stamp}@example.test`;
    const studentEmail = `student.${stamp}@example.test`;
    const password = "TestPass12";

    const regTeacher = await request("POST", "/api/register", {
      body: {
        role: "teacher",
        name: "Alex Rivera",
        subject: "Maths",
        email: teacherEmail,
        phone: `+9198${phoneStamp}1`,
        password
      }
    });
    assert.strictEqual(regTeacher.status, 201, regTeacher.raw);

    const regStudent = await request("POST", "/api/register", {
      body: {
        role: "student",
        name: "Jordan Lee",
        email: studentEmail,
        phone: `+9198${phoneStamp}2`,
        password
      }
    });
    assert.strictEqual(regStudent.status, 201, regStudent.raw);

    const shortPass = await request("POST", "/api/register", {
      body: {
        role: "student",
        name: "Casey Ng",
        email: `casey.${stamp}@example.test`,
        phone: "+919999999999",
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

    const teacherLogin = await loginWith2fa(teacherEmail, password);
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
        topic: "Intro lesson"
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
        topic: "Weekly series"
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
        topic: "Alternate multi-slot series"
      }
    });
    assert.strictEqual(alternate.status, 201, alternate.raw);
    // 7 days alternate => days 0,2,4,6 = 4 days * 3 times = 12
    assert.strictEqual(alternate.json.count, 12, `expected 12 classes, got ${alternate.json.count}`);

    const studentLogin = await loginWith2fa(studentEmail, password);
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

    // A class time is a wall clock in the teacher's zone, not the server's.
    const zoned = await request("POST", "/api/classes", {
      cookie: teacherLogin.cookie,
      body: {
        scheduleMode: "once",
        timeZone: "Asia/Kolkata",
        dateTime: "2026-09-01T16:00",
        durationMinutes: 45,
        studentIds: [studentId],
        meetingProvider: "none",
        meetingMode: "none",
        topic: "Timezone check"
      }
    });
    assert.strictEqual(zoned.status, 201, zoned.raw);
    assert.strictEqual(
      zoned.json.classItem.dateTime,
      "2026-09-01T10:30:00.000Z",
      `16:00 IST should store as 10:30Z, got ${zoned.json.classItem.dateTime}`
    );

    // Inactive kids cannot be scheduled, and the error says why.
    const pendingKidEmail = `pending.${stamp}@example.test`;
    const pendingKid = await request("POST", "/api/register", {
      body: {
        role: "student",
        name: "Pending Kid",
        email: pendingKidEmail,
        phone: "+919825285643",
        password
      }
    });
    assert.strictEqual(pendingKid.status, 201, pendingKid.raw);
    const pendingDash = await request("GET", "/api/dashboard", { cookie: adminLogin.cookie });
    const pendingKidId = (pendingDash.json.managedUsers || []).find((entry) => entry.email === pendingKidEmail).id;
    const pendingSchedule = await request("POST", "/api/classes", {
      cookie: teacherLogin.cookie,
      body: {
        scheduleMode: "once",
        dateTime: "2026-09-02T10:00",
        durationMinutes: 45,
        studentIds: [pendingKidId],
        meetingProvider: "none",
        meetingMode: "none"
      }
    });
    assert.strictEqual(pendingSchedule.status, 400, pendingSchedule.raw);
    assert.ok(/active/i.test(pendingSchedule.json.error), "pending kid error mentions activation");

    // Cancelling one class, then a whole series.
    const cancelOne = await request("DELETE", `/api/classes/${zoned.json.classItem.id}?scope=single`, {
      cookie: teacherLogin.cookie
    });
    assert.strictEqual(cancelOne.status, 200, cancelOne.raw);
    assert.strictEqual(cancelOne.json.removed, 1);

    const seriesId = series.json.classItem.seriesId;
    const seriesSize = series.json.count;
    const cancelSeries = await request("DELETE", `/api/classes/${series.json.classItem.id}?scope=series`, {
      cookie: teacherLogin.cookie
    });
    assert.strictEqual(cancelSeries.status, 200, cancelSeries.raw);
    assert.strictEqual(cancelSeries.json.removed, seriesSize, "whole series cancelled");

    const afterCancel = await request("GET", "/api/dashboard", { cookie: teacherLogin.cookie });
    assert.ok(
      !(afterCancel.json.classes || []).some((entry) => entry.seriesId === seriesId),
      "cancelled series is gone from the dashboard"
    );

    // A kid cannot cancel a class.
    const remainingClassId = (afterCancel.json.classes || [])[0].id;
    const kidCancel = await request("DELETE", `/api/classes/${remainingClassId}`, {
      cookie: studentLogin.cookie
    });
    assert.strictEqual(kidCancel.status, 403, "students cannot cancel classes");

    console.log("All API tests passed.");
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
  console.error("API tests failed:", error);
  process.exit(1);
});
