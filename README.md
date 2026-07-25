# Bowser Learning Portal

A small full-stack teacher-student portal for scheduling classes, sharing links, and reviewing homework.

## Features

- Teacher login for Maths and English teachers
- Schedule classes from the portal
- Create Zoom or Google Meet class links automatically when credentials are configured
- Paste an existing Zoom, Google Meet, or Microsoft Teams class link instead
- Manual link fallback when no meeting credentials are configured yet
- Share lesson details and Google Drive document links
- Assign classes to one or more kids
- Student access to their own assigned class links and shared documents
- Homework photo upload from device camera or gallery
- Homework upload validation for image type and size
- Teacher review, ranking, and feedback for homework
- Hashed password storage and signed, HTTP-only login session cookies
- Every API route resolves the signed-in account from the session cookie
- Week and month calendar views for both teachers and students
- Kid-name calendar filtering for teachers
- Local JSON storage for development
- Postgres-backed storage for Vercel and production deployments

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

## Notes

- Static files are served by `server.js`.
- Local development stores data in `data/portal-data.json`.
- Vercel and production deployments should use `DATABASE_URL`.
- When Postgres is enabled, homework images are stored inline with the saved submission data instead of relying on local upload files.
- Local development stores uploaded homework files in `uploads/`.
- Only `JPG`, `PNG`, `WEBP`, `HEIC`, and `HEIF` homework images up to `8 MB` are accepted.
- Teachers and students can only log in after an admin activates their account.
- Passwords are stored as `scrypt` hashes. Accounts saved before this change are re-hashed automatically on the next startup, so existing passwords keep working.
- Logging in sets a signed, HTTP-only session cookie that lasts 7 days. The browser never holds a user id, and the API ignores any account id sent in a request.
- Deactivating an account takes effect immediately, including for sessions that are already open.
- Zoom integration uses Server-to-Server OAuth and creates meetings from the backend.
- Google Meet integration uses an OAuth refresh token and the Calendar API, also from the backend.
- Teachers can schedule a class with only `date/time` and selected `kid` accounts; topic, notes, Drive link, and meeting link are optional.
