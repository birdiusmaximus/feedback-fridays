# Feedback Fridays nomination form

Static nomination form for GIG Health's internal *Feedback Fridays* newsletter, served by GitHub Pages.

- Works only with a current issue link (`?t=...`); the link is checked on the server.
- Submissions go to Supabase through two narrow functions. The key in `config.js` is the project's
  publishable key: it cannot read nominations or anything else.
- Voice input uses the browser's own speech recognition; no audio is stored.

Source of truth: `Studio/form/` in the Feedback Fridays Studio project. Edit there, then re-upload.
