import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_ANON_KEY || '').replace(/\s+/g, '');
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// --- WP publish ---
async function publishToWordPress(post: any): Promise<{ success: boolean; wpPostId?: number; imageUrl?: string; error?: string }> {
  const { wp_url, wp_username, wp_app_password, wp_news_slug, wp_category_id, wp_destinations } = post;
  if (!wp_url || !wp_username || !wp_app_password) return { success: false, error: 'WP credentials missing' };

  const base = wp_url.trim().replace(/\/$/, '');
  const credentials = Buffer.from(`${wp_username.trim()}:${wp_app_password.replace(/\s+/g, '')}`).toString('base64');
  const authHeader = { 'Authorization': `Basic ${credentials}` };

  const tryFetch = async (url: string, opts: any) => {
    try {
      const r = await fetch(url, opts);
      return r;
    } catch { return null; }
  };

  let uploadedImageUrl = (post.image_url && !post.image_url.startsWith('data:')) ? post.image_url : '';
  let featuredMediaId = 0;

  // 1. Upload image if base64 present and no public URL yet
  if (post.image_base64 && !uploadedImageUrl) {
    const imageBuffer = Buffer.from(post.image_base64, 'base64');
    const uploadHeaders = {
      ...authHeader,
      'Content-Disposition': `attachment; filename="blog-image-${post.id}.png"`,
      'Content-Type': 'image/png'
    };
    const urls = [
      `${base}/wp-json/wp/v2/media`,
      `${base}/index.php?rest_route=/wp/v2/media`
    ];
    for (const url of urls) {
      const r = await tryFetch(url, { method: 'POST', headers: uploadHeaders, body: imageBuffer });
      if (r && r.ok) {
        const d = await r.json();
        featuredMediaId = d.id || 0;
        uploadedImageUrl = d.source_url || '';
        break;
      }
    }
  }

  // 2. Construct content
  const imageHtml = uploadedImageUrl
    ? `<div style="margin: 40px 0;"><img src="${uploadedImageUrl}" alt="${(post.keywords || []).join(', ')}" style="width:100%; height:auto; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);"></div>`
    : '';
  const finalContent = `${(post.content || '').trim()}\n${imageHtml}\n${post.bottom_content_html || ''}`;

  // 3. Determine post types
  const destinations: string[] = post.wp_destinations || ['news'];
  const types: string[] = [];
  if (destinations.includes('blog')) types.push('posts');
  if (destinations.includes('news')) types.push(wp_news_slug || 'news');
  if (types.length === 0) types.push(wp_news_slug || 'news');

  const postBody: any = {
    title: post.title,
    content: finalContent,
    excerpt: post.meta_description || '',
    status: 'publish',
    date_gmt: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    categories: wp_category_id ? [parseInt(wp_category_id)] : [],
    featured_media: featuredMediaId > 0 ? featuredMediaId : undefined,
    meta: {
      description: post.meta_description || '',
      _aioseo_description: post.meta_description || '',
      _aioseo_focus_keyphrase: (post.keywords || [])[0] || '',
      _yoast_wpseo_metadesc: post.meta_description || '',
    }
  };

  let lastWpPostId: number | undefined;
  let lastError: string | undefined;

  for (const type of types) {
    const body = JSON.stringify(postBody);
    const headers = { 'Content-Type': 'application/json', ...authHeader };
    const candidates = [
      `${base}/wp-json/wp/v2/${type}`,
      `${base}/index.php?rest_route=/wp/v2/${type}`
    ];
    for (const url of candidates) {
      const r = await tryFetch(url, { method: 'POST', headers, body });
      if (r && r.ok) {
        const d = await r.json();
        lastWpPostId = d.id;
        break;
      } else if (r) {
        try { const t = await r.text(); lastError = t.substring(0, 200); } catch {}
      }
    }
    if (lastWpPostId) break;
  }

  if (lastWpPostId) return { success: true, wpPostId: lastWpPostId, imageUrl: uploadedImageUrl };
  return { success: false, error: lastError || 'WP post creation failed', imageUrl: uploadedImageUrl };
}

// --- Instagram publish ---
async function publishToInstagram(imageUrl: string, caption: string, accountId: string, accessToken: string): Promise<{ success: boolean; postId?: string; error?: string }> {
  if (!imageUrl || !accountId || !accessToken) return { success: false, error: 'Instagram credentials or image URL missing' };
  try {
    const containerRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption })
    });
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(`[Container] ${containerData.error.message}`);
    const creationId = containerData.id;
    if (!creationId) throw new Error('No creation ID from Instagram');

    let publishData: any;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 4000 + i * 2000));
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media_publish?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId })
      });
      publishData = await publishRes.json();
      if (!publishData.error) break;
    }
    if (publishData?.error) throw new Error(`[Publish] ${publishData.error.message}`);
    return { success: true, postId: publishData.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// --- Threads publish ---
async function publishToThreads(imageUrl: string | null, caption: string, userId: string, accessToken: string): Promise<{ success: boolean; postId?: string; error?: string }> {
  if (!userId || !accessToken) return { success: false, error: 'Threads credentials missing' };
  try {
    const bodyPayload: any = { text: caption };
    if (imageUrl) { bodyPayload.media_type = 'IMAGE'; bodyPayload.image_url = imageUrl; }
    else bodyPayload.media_type = 'TEXT';

    const containerRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(`[Container] ${containerData.error.message}`);
    const creationId = containerData.id;
    if (!creationId) throw new Error('No creation ID from Threads');

    let publishData: any;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 4000 + i * 2000));
      const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId })
      });
      publishData = await publishRes.json();
      if (!publishData.error) break;
    }
    if (publishData?.error) throw new Error(`[Publish] ${publishData.error.message}`);
    return { success: true, postId: publishData.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// --- Process a single scheduled post ---
async function processScheduledPost(post: any) {
  if (!supabase) return;
  await supabase.from('scheduled_posts').update({ status: 'publishing' }).eq('id', post.id);

  let imageUrl = (post.image_url && !post.image_url.startsWith('data:')) ? post.image_url : '';
  let wpPostId: number | undefined;
  let instagramPostId: string | undefined;
  let threadsPostId: string | undefined;
  const errors: string[] = [];

  try {
    // 1. WordPress (also handles image upload to get public URL)
    if (post.post_to_wp && post.wp_url && post.wp_username && post.wp_app_password) {
      const wpResult = await publishToWordPress(post);
      if (wpResult.success) {
        wpPostId = wpResult.wpPostId;
      } else {
        errors.push(`WP: ${wpResult.error}`);
      }
      if (wpResult.imageUrl) imageUrl = wpResult.imageUrl;
    } else if (!imageUrl && post.image_base64 && post.wp_url && post.wp_username && post.wp_app_password) {
      // Upload image only (for social media)
      const imgResult = await publishToWordPress({ ...post, post_to_wp: false });
      if (imgResult.imageUrl) imageUrl = imgResult.imageUrl;
    }

    // 2. Instagram
    if (post.post_to_instagram && post.instagram_account_id && post.instagram_access_token && imageUrl) {
      const caption = `${post.insta_caption || post.title}\n${post.insta_hashtags || ''}`.trim();
      const r = await publishToInstagram(imageUrl, caption, post.instagram_account_id, post.instagram_access_token);
      if (r.success) instagramPostId = r.postId;
      else errors.push(`Instagram: ${r.error}`);
    }

    // 3. Threads
    if (post.post_to_threads && post.threads_user_id && post.threads_access_token) {
      const caption = post.threads_caption || post.insta_caption || post.title;
      const r = await publishToThreads(imageUrl || null, caption, post.threads_user_id, post.threads_access_token);
      if (r.success) threadsPostId = r.postId;
      else errors.push(`Threads: ${r.error}`);
    }

    const hasSuccess = !!(wpPostId || instagramPostId || threadsPostId);
    const newStatus = errors.length === 0 ? 'published' : (hasSuccess ? 'published' : 'failed');

    await supabase.from('scheduled_posts').update({
      status: newStatus,
      published_at: hasSuccess ? new Date().toISOString() : null,
      wp_post_id: wpPostId || null,
      instagram_post_id: instagramPostId || null,
      threads_post_id: threadsPostId || null,
      image_url: imageUrl || post.image_url,
      error_message: errors.length > 0 ? errors.join('; ') : null
    }).eq('id', post.id);

    console.log(`[Publish] "${post.title}" → ${newStatus}${errors.length > 0 ? ` (errors: ${errors.join('; ')})` : ''}`);

    // 4. Loop: create next occurrence
    if (post.loop_enabled && post.loop_interval_days > 0 && hasSuccess) {
      const nextDate = new Date(new Date(post.scheduled_at).getTime() + post.loop_interval_days * 60 * 1000);
      const { id, created_at, published_at, status, wp_post_id, instagram_post_id, threads_post_id, error_message, loop_count, image_base64, ...rest } = post;
      await supabase.from('scheduled_posts').insert({
        ...rest,
        image_base64: null, // Don't re-upload; image_url will be reused
        scheduled_at: nextDate.toISOString(),
        status: 'pending',
        loop_count: (post.loop_count || 0) + 1
      });
      console.log(`[Loop] Next "${post.title}" scheduled for ${nextDate.toISOString()}`);
    }
  } catch (e: any) {
    console.error(`[Publish] Error for "${post.title}":`, e.message);
    await supabase.from('scheduled_posts').update({ status: 'failed', error_message: e.message }).eq('id', post.id);
  }
}

// --- Publish timer (every 60s) ---
function startPublishTimer() {
  if (!supabase) { console.log('[Timer] Supabase not configured'); return; }
  console.log('[Timer] Started (60s interval)');
  setInterval(async () => {
    try {
      const { data: posts, error } = await supabase!
        .from('scheduled_posts')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .limit(5);
      if (error) { console.error('[Timer] Query error:', error); return; }
      if (!posts || posts.length === 0) return;
      console.log(`[Timer] Processing ${posts.length} post(s)...`);
      for (const post of posts) await processScheduledPost(post);
    } catch (e: any) {
      console.error('[Timer] Error:', e.message);
    }
  }, 60000);
}

// --- Express server ---
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use((err: any, req: any, res: any, next: any) => {
    if (err) {
      console.error("Express middleware error:", err);
      return res.status(err.status || 500).json({ message: "Server middleware error", error: err.message });
    }
    next();
  });

  // WordPress Proxy Endpoint
  app.post("/api/wp-proxy", async (req, res) => {
    const { url, method, headers, body, isBase64 } = req.body;
    if (!url) return res.status(400).json({ message: "URL is required" });
    try {
      console.log(`Proxying ${method} request to: ${url}`);
      const fetchOptions: any = {
        method: method || 'GET',
        headers: {
          ...headers,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      };
      if (method !== 'GET' && body) {
        if (isBase64) {
          fetchOptions.body = Buffer.from(body, 'base64');
        } else {
          fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : body;
        }
      }
      const response = await fetch(url, fetchOptions);
      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      res.status(response.status).json(data);
    } catch (error: any) {
      console.error("Proxy error:", error);
      res.status(500).json({ message: "Proxy server error", error: error.message, code: error.code });
    }
  });

  // Instagram token extension proxy (avoids CORS in iframe)
  app.get("/api/extend-token", async (req, res) => {
    const { client_id, client_secret, fb_exchange_token } = req.query as Record<string, string>;
    if (!client_id || !client_secret || !fb_exchange_token) {
      return res.status(400).json({ error: { message: 'client_id, client_secret, fb_exchange_token are required' } });
    }
    try {
      const url = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}&fb_exchange_token=${encodeURIComponent(fb_exchange_token)}`;
      const response = await fetch(url);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: { message: e.message } });
    }
  });

  // URL fetch proxy (for reading salon reference pages)
  app.post("/api/fetch-url", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL required" });
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'ja,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000)
      });
      const html = await response.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .substring(0, 8000);
      res.json({ content: text, url });
    } catch (error: any) {
      res.json({ content: '', url, error: error.message });
    }
  });

  // --- Supabase: Save scheduled post ---
  app.post("/api/schedule-post", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { data, error } = await supabase.from('scheduled_posts').insert(req.body).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('schedule-post error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Supabase: Get all scheduled posts ---
  app.get("/api/scheduled-posts", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { data, error } = await supabase
        .from('scheduled_posts')
        .select('id, title, scheduled_at, status, published_at, error_message, loop_enabled, loop_interval_days, loop_count, post_to_wp, post_to_instagram, post_to_threads, wp_post_id, instagram_post_id, threads_post_id')
        .order('scheduled_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Supabase: Stop loop for a post ---
  app.post("/api/scheduled-post/:id/stop-loop", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { error } = await supabase.from('scheduled_posts').update({ loop_enabled: false }).eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Supabase: Delete scheduled post ---
  app.delete("/api/scheduled-post/:id", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { error } = await supabase.from('scheduled_posts').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Supabase: Force publish a post now ---
  app.post("/api/scheduled-post/:id/publish", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
    try {
      const { data: post, error } = await supabase.from('scheduled_posts').select('*').eq('id', req.params.id).single();
      if (error) throw error;
      if (!post) return res.status(404).json({ error: 'Post not found' });
      processScheduledPost(post); // async, don't await
      res.json({ success: true, message: '投稿処理を開始しました' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startPublishTimer();
  });
}

startServer();
