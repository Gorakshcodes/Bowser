# Bowser Learning Portal

A small full-stack teacher-student portal with Zoom and Teams meeting support.

## Features

- Teacher login for Maths and English teachers
- Schedule classes from the portal
- Create Zoom meeting links automatically when Zoom credentials are configured
- Manual Zoom link fallback when Zoom is not configured yet
- Manual Microsoft Teams link support for scheduled classes
- Share lesson details and Google Drive document links
- Assign classes to one or more kids
- Student access to their own assigned class links and shared documents
- Homework photo upload from device camera or gallery
- Homework upload validation for image type and size
- Teacher review, ranking, and feedback for homework
- Week and month calendar views for both teachers and students
- Kid-name calendar filtering for teachers
- Persistent JSON-backed storage for classes and submissions

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

3. If you want automatic Zoom meeting creation, fill in:

- `ZOOM_ACCOUNT_ID`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_USER_ID`

If those values are missing, the portal still works and teachers can paste a manual Zoom link instead.
Teams links are currently manual only, so no extra Teams credentials are required.

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Notes

- Static files are served by `server.js`.
- Data is stored in `data/portal-data.json`.
- Homework uploads are stored in `uploads/`.
- Only `JPG`, `PNG`, `WEBP`, `HEIC`, and `HEIF` homework images up to `8 MB` are accepted.
- Zoom integration uses Server-to-Server OAuth and creates meetings from the backend.
- Teams support uses manual `teams.microsoft.com` or `teams.live.com` join links.
- Teachers can schedule a class with only `date/time` and selected `kid` accounts; topic, notes, Drive link, and meeting link are optional.
