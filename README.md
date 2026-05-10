# Bowser Learning Portal

A small full-stack teacher-student portal for scheduling classes, sharing links, and reviewing homework.

## Features

- Teacher login for Maths and English teachers
- Schedule classes from the portal
- Create Zoom meeting links automatically when Zoom credentials are configured
- Manual Zoom link fallback when Zoom is not configured yet
- Share lesson details and Google Drive document links
- Assign classes to one or more kids
- Student access to their own assigned class links and shared documents
- Homework photo upload from device camera or gallery
- Homework upload validation for image type and size
- Teacher review, ranking, and feedback for homework
- Week and month calendar views for both teachers and students
- Kid-name calendar filtering for teachers
- Local JSON storage for development
- Postgres-backed storage for Vercel and production deployments

## Accounts

- The app now starts without demo users or demo classes.
- Create real teacher and student accounts from the login page.
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

4. If you want automatic Zoom meeting creation, fill in:

- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_USER_ID`

If those values are missing, the portal still works and teachers can paste a manual Zoom link instead.

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
- Zoom integration uses Server-to-Server OAuth and creates meetings from the backend.
- Teachers can schedule a class with only `date/time` and selected `kid` accounts; topic, notes, Drive link, and meeting link are optional.
