# 1. Use Google Apps Script as the platform

Status: Accepted

## Context

MyTube is a personal tool for a handful of users. It needs Google login, access
to the YouTube Data API, and per-user storage, with as little operations burden
as possible. Full detail in PLAN.md section 3.

## Decision

Build it as a Google Apps Script web app deployed "Execute as: user accessing"
with access "Anyone with a Google account." Each visitor uses their own Google
account, so storage is per-user.

## Consequences

- Free hosting, built-in Google OAuth, built-in YouTube advanced service, no
  servers to run.
- Ceiling: a slower UI, limited storage, and an unverified-app warning plus a
  roughly 100-user cap until Google verification. Acceptable at personal scale.
- If the project outgrows this, the data model ports to a small Next.js app with
  Google login.
