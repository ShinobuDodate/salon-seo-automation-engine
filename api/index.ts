import { createApp } from "../lib/app";

// Vercel serverless entry point. No app.listen() and no startPublishTimer():
// scheduled posting is handled by a Supabase Cron Job invoking the
// process-scheduled-posts Edge Function directly, independent of this function.
const app = createApp();

export default app;
