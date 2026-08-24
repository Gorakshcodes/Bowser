# Bowser Learning Portal

A small full-stack teacher-student portal for scheduling classes, sharing links, and reviewing homework.

## Features

- Teacher, kid (student), and admin accounts
- Schedule one class or a full **month series** in one step
  - Selected weekdays, alternate days, or every day
  - Up to 6 class times per day (e.g. 10:00, 14:00, 17:00)
- Create Zoom or Google Meet class links automatically when credentials are configured
- Paste an existing Zoom, Google Meet, or Microsoft Teams class link instead
- Shared meeting link applied across a series (one room for the month)
- Optional topic, notes, and Google Drive materials
- Kid-friendly student home: next class hero, big join buttons, simple homework flow
- **Progress** tab for teachers and kid/parent accounts: scheduled vs conducted counts, completion %, and topics covered
  - Filter by kid (teachers) and All time / This month
  - Per-kid table so teachers can see who is on track
- Homework **activities** teachers can assign (notes, questions, revision)
- Students submit **text answers** and/or photos under each activity
- Homework photo upload (camera or gallery) with type/size validation
- Teacher review, ranking, and feedback for homework
- **AI Coach** for teachers: lesson plans, homework questions, activities, revision notes, student learning insights
  - Uses `AI_API_KEY` when set (OpenAI-compatible)
  - Falls back to free offline education templates (and local Ollama if available)
- Security: scrypt password hashes, 2-step login (password + SMS 6-digit code via Twilio), signed HTTP-only cookies, login rate limits, security headers
- Kid portal themes: **Game** (Mech Arena style) and **Play** (simple colorful)
- Week and month calendars; teachers can filter by kid
- Local JSON storage for development; Postgres for Vercel/production

## Accounts

- The app now starts without demo users or demo classes.
- Admin login is bootstrapped from `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME`.
- Create real teacher and student accounts from the login page.
- New teacher and student accounts stay pending until an admin activates them.
- Create student accounts for kids first, then teachers can assign classes to those saved kid accounts.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`.

Node 18+ is recommended because the backend uses the built-in `fetch` API for Zoom.

3. For production or Vercel, add a Postgres connection string:

- `DATABASE_URL`

If your provider needs SSL, leave `DATABASE_SSL=true`.

The app uses:
- local `data/portal-data.json` when `DATABASE_URL` is not set
- Postgres when `DATABASE_URL` is set

4. Add an admin account in `.env`:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

5. For production, set a login session signing key:

- `SESSION_SECRET`

When it is empty the app generates a key and stores it with the portal data. Setting it explicitly keeps
sessions valid across redeploys and across multiple server instances.

6. If you want automatic Zoom meeting creation, fill in:

- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_USER_ID`

If those values are missing, the portal still works and teachers can paste a manual class link instead.

7. If you want automatic Google Meet link creation, fill in:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (optional, defaults to `primary`)

Google Meet links are created through the Google Calendar API: the app adds a calendar event with a Meet
conference attached and saves the join link on the class. To get those values:

1. In the Google Cloud console, create a project and enable the **Google Calendar API**.
2. Create an **OAuth client ID** and add `https://developers.google.com/oauthplayground` as a redirect URI
   (or use your own redirect if you prefer).
3. Authorise the scope `https://www.googleapis.com/auth/calendar.events` once, with `access_type=offline`
   and `prompt=consent` so Google returns a refresh token.
4. Put the client id, client secret, and that refresh token in `.env`.

Sign in as the Google account that should own the meetings — that account is the Meet host.

## Class links

| Provider | Automatic creation | Paste your own |
| --- | --- | --- |
| Zoom | yes, with Zoom credentials | yes |
| Google Meet | yes, with Google credentials | yes |
| Microsoft Teams | no | yes |

Auto-create options only appear in the class form once that provider's credentials are set, so teachers
never see an option that cannot work. For a pasted Google Meet link you can use the full URL or just the
`abc-defg-hij` meeting code. Each link is checked against that provider's own domain, so a Meet link
cannot be saved under Zoom or the other way round.

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Test

```bash
npm test
```

Runs API smoke tests (health, auth, activation, single + series scheduling, access control).

## Month series scheduling

On the teacher **Schedule class** form:

1. Choose **Month series** (instead of one class).
2. Set **From** / **To** dates (defaults to rest of the current month).
3. Pick a pattern:
   - **Selected weekdays** — tick Mon–Sun as needed
   - **Alternate days** — every other day from the start date
   - **Every day**
4. Add one or more **times each day** (for example three slots: morning, afternoon, evening).
5. Save once — up to 90 classes can be created in a single series.

Auto-created Zoom/Meet links for a series are generated **once** and shared across all sessions in that series.

## Deploy (Vercel)

1. Push the repo and import it in Vercel.
2. Set environment variables (see `.env.example`):
   - `DATABASE_URL` (required for durable production data)
   - `DATABASE_SSL=true` unless your provider forbids SSL
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
   - `SESSION_SECRET` (long random string; required so sessions survive redeploys)
   - Optional Zoom / Google Meet credentials
3. Deploy. Entry is `server.js` via `vercel.json`.
4. After deploy, open `/api/health` and confirm `"ok": true` and `"storageMode": "postgres"`.

## Notes

- Static files are served by `server.js`.
- Local development stores data in `data/portal-data.json`.
- Vercel and production deployments should use `DATABASE_URL`.
- When Postgres is enabled, homework images are stored inline with the saved submission data instead of relying on local upload files.
- Local development stores uploaded homework files in `uploads/`.
- Only `JPG`, `PNG`, `WEBP`, `HEIC`, and `HEIF` homework images up to `8 MB` are accepted.
- Teachers and students can only log in after an admin activates their account.
- Passwords must be at least 8 characters and are stored as `scrypt` hashes.
- Logging in sets a signed, HTTP-only, `SameSite=Strict` session cookie that lasts 7 days.
- Failed logins are rate-limited per client IP.
- Deactivating an account takes effect immediately, including for sessions that are already open.
- Zoom integration uses Server-to-Server OAuth and creates meetings from the backend.
- Google Meet integration uses an OAuth refresh token and the Calendar API, also from the backend.
- Teachers can schedule with only kid + date/time (or a series); topic, notes, Drive link, and meeting link are optional.
