# Job Tracker Project Context

Working directory:

```bash
/Users/mre2/Documents/Codigo/Job-Tracker
```

## What This Is

A single-page Job Pipeline Tracker web app, hosted from GitHub Pages and backed by Firebase.

The app tracks job applications with table, kanban, and parse-job views. Data syncs through Firebase Realtime Database and is protected by Google sign-in.

## GitHub / Deployment

Repository:

```text
https://github.com/OBXIV/Job-Tracker
```

Primary app file:

```text
index.html
```

GitHub Pages serves the app from the repo. After changing app code, commit and push to publish.

## Firebase

Firebase project:

```text
job-tracker-f6ed5
```

Realtime Database:

```text
https://job-tracker-f6ed5-default-rtdb.firebaseio.com
```

Main data path:

```text
/pipeline
```

Security model:

- Firebase Auth with Google sign-in
- Only `mechev14@gmail.com` should have read/write access
- Database rules are scoped to `/pipeline`

Expected rules:

```json
{
  "rules": {
    "pipeline": {
      ".read": "auth != null && auth.token.email == 'mechev14@gmail.com'",
      ".write": "auth != null && auth.token.email == 'mechev14@gmail.com'"
    },
    ".read": false,
    ".write": false
  }
}
```

## Local CLI

Use the CLI for agent-driven job updates:

```bash
node tracker.js list --limit 5
node tracker.js search --query "Apex"
node tracker.js add --company "Company" --role "Role" --applied "YYYY-MM-DD" --stage "Applied" --notes "Notes"
node tracker.js update --company "Company" --stage "Phone Screen" --note "Note text"
node tracker.js reject --company "Company" --note "Rejected via email M/D"
```

Old add-job wrapper still exists:

```bash
node add-job.js --company "Company" --role "Role"
```

## Local Private Credential

The Firebase Admin service account must stay local and private:

```text
service-account.json
```

Do not upload it to GitHub, Firebase Hosting, iCloud shared folders, email, or chat.

It is ignored by `.gitignore`.

## Current Data Notes

As of the last verified live check:

- Tracker had 133 entries
- Latest entry was `#133 American Express — Director, Technology Operations (App Support Service Delivery)`
- Current working directory was renamed from older names to `Codigo`

## How User Usually Works

The user often pastes a job posting and says:

```text
applied for this job:
```

Preferred behavior:

1. Parse company, role, location, compensation, remote/hybrid/onsite, tech stack, leadership scope, notable requirements.
2. Add with today’s date unless the user says otherwise.
3. Default stage is `Applied`.
4. Keep notes concise but useful for later interview/job-fit review.
5. Use `tracker.js` to write to Firebase.

For status updates:

- “thank you no thank you” means mark `Rejected`
- “AI phone screen” means stage `Phone Screen`
- “direct outreach LinkedIn message” usually means stage `HM Outreach` unless already further along
- Append a dated note using the current date

## Future Ideas

See also IRMA CRM migration note:

```text
/Users/mre2/Documents/Codigo/irmae-crm-pages/FUTURE_MIGRATION_NOTES.md
```

Potential future improvements:

- Move from GitHub Pages to Firebase Hosting
- Add Firebase Cloud Functions
- Add secure AI parsing via OpenAI API through backend function
- Consider Firestore for a cleaner per-record data model
- Add “Analyze Fit” or “Copy for ChatGPT” feature
