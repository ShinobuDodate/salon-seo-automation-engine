import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// --- WordPress publish ---
async function publishToWordPress(post: any): Promise<{ success: boolean; wpPostId?: number; imageUrl?: string; error?: string }> {
  const { wp_url, wp_username, wp_app_password, wp_news_slug, wp_category_id } = post
  if (!wp_url || !wp_username || !wp_app_password) return { success: false, error: 'WP credentials missing' }

  const base = wp_url.trim().replace(/\/$/, '')
  const credentials = btoa(`${wp_username.trim()}:${wp_app_password.replace(/\s+/g, '')}`)
  const authHeader = { 'Authorization': `Basic ${credentials}` }

  const tryFetch = async (url: string, opts: RequestInit) => {
    try { return await fetch(url, opts) } catch { return null }
  }

  let uploadedImageUrl = (post.image_url && !post.image_url.startsWith('data:')) ? post.image_url : ''
  let featuredMediaId = 0

  // 1. 画像アップロード
  if (post.image_base64 && !uploadedImageUrl) {
    const binaryString = atob(post.image_base64)
    const imageBuffer = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      imageBuffer[i] = binaryString.charCodeAt(i)
    }
    const uploadHeaders = {
      ...authHeader,
      'Content-Disposition': `attachment; filename="blog-image-${post.id}.png"`,
      'Content-Type': 'image/png'
    }
    for (const url of [`${base}/wp-json/wp/v2/media`, `${base}/index.php?rest_route=/wp/v2/media`]) {
      const r = await tryFetch(url, { method: 'POST', headers: uploadHeaders, body: imageBuffer })
      if (r?.ok) {
        const d = await r.json()
        featuredMediaId = d.id || 0
        uploadedImageUrl = d.source_url || ''
        break
      }
    }
  }

  // 2. 記事本文の組み立て
  const imageHtml = uploadedImageUrl
    ? `<div style="margin: 40px 0;"><img src="${uploadedImageUrl}" alt="${(post.keywords || []).join(', ')}" style="width:100%; height:auto; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);"></div>`
    : ''
  const baseContent = (post.content || '').trim()
  const contentWithTop = post.top_content_html ? baseContent.replace('</h1>', '</h1>\n' + post.top_content_html) : baseContent
  const finalContent = `${contentWithTop}\n${post.above_image_html || ''}\n${imageHtml}`

  const destinations: string[] = post.wp_destinations || ['news']
  const types: string[] = []
  if (destinations.includes('blog')) types.push('posts')
  if (destinations.includes('news')) types.push(wp_news_slug || 'news')
  if (types.length === 0) types.push(wp_news_slug || 'news')

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
  }

  let lastWpPostId: number | undefined
  let lastError: string | undefined

  for (const type of types) {
    const headers = { 'Content-Type': 'application/json', ...authHeader }
    for (const url of [`${base}/wp-json/wp/v2/${type}`, `${base}/index.php?rest_route=/wp/v2/${type}`]) {
      const r = await tryFetch(url, { method: 'POST', headers, body: JSON.stringify(postBody) })
      if (r?.ok) {
        const d = await r.json()
        lastWpPostId = d.id
        break
      } else if (r) {
        try { lastError = (await r.text()).substring(0, 200) } catch {}
      }
    }
    if (lastWpPostId) break
  }

  if (lastWpPostId) return { success: true, wpPostId: lastWpPostId, imageUrl: uploadedImageUrl }
  return { success: false, error: lastError || 'WP post creation failed', imageUrl: uploadedImageUrl }
}

// --- Instagram Story publish ---
async function publishToInstagramStory(imageUrl: string, accountId: string, accessToken: string) {
  if (!imageUrl || !accountId || !accessToken) return { success: false, error: 'Instagram credentials or image URL missing' }
  try {
    const containerRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'STORIES', image_url: imageUrl })
    })
    const containerData = await containerRes.json()
    if (containerData.error) throw new Error(`[Container] ${containerData.error.message}`)
    if (!containerData.id) throw new Error('No creation ID from Instagram Stories')
    await new Promise(r => setTimeout(r, 4000))
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media_publish?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerData.id })
    })
    const publishData = await publishRes.json()
    if (publishData?.error) throw new Error(`[Publish] ${publishData.error.message}`)
    return { success: true, postId: publishData.id }
  } catch (e: any) { return { success: false, error: e.message } }
}

// --- Instagram publish ---
async function publishToInstagram(imageUrl: string, caption: string, accountId: string, accessToken: string) {
  if (!imageUrl || !accountId || !accessToken) return { success: false, error: 'Instagram credentials or image URL missing' }
  try {
    const containerRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption })
    })
    const containerData = await containerRes.json()
    if (containerData.error) throw new Error(`[Container] ${containerData.error.message}`)
    if (!containerData.id) throw new Error('No creation ID from Instagram')

    let publishData: any
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 4000 + i * 2000))
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${accountId}/media_publish?access_token=${accessToken}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerData.id })
      })
      publishData = await publishRes.json()
      if (!publishData.error) break
    }
    if (publishData?.error) throw new Error(`[Publish] ${publishData.error.message}`)
    return { success: true, postId: publishData.id }
  } catch (e: any) { return { success: false, error: e.message } }
}

// --- Threads publish ---
async function publishToThreads(imageUrl: string | null, caption: string, userId: string, accessToken: string) {
  if (!userId || !accessToken) return { success: false, error: 'Threads credentials missing' }
  try {
    const bodyPayload: any = { text: caption }
    if (imageUrl) { bodyPayload.media_type = 'IMAGE'; bodyPayload.image_url = imageUrl }
    else bodyPayload.media_type = 'TEXT'

    const containerRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    })
    const containerData = await containerRes.json()
    if (containerData.error) throw new Error(`[Container] ${containerData.error.message}`)
    if (!containerData.id) throw new Error('No creation ID from Threads')

    let publishData: any
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 4000 + i * 2000))
      const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish?access_token=${accessToken}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerData.id })
      })
      publishData = await publishRes.json()
      if (!publishData.error) break
    }
    if (publishData?.error) throw new Error(`[Publish] ${publishData.error.message}`)
    return { success: true, postId: publishData.id }
  } catch (e: any) { return { success: false, error: e.message } }
}

// --- 1件の予約投稿を処理 ---
async function processScheduledPost(post: any) {
  await supabase.from('scheduled_posts').update({ status: 'publishing' }).eq('id', post.id)

  let imageUrl = (post.image_url && !post.image_url.startsWith('data:')) ? post.image_url : ''
  let wpPostId: number | undefined
  let instagramPostId: string | undefined
  let threadsPostId: string | undefined
  const errors: string[] = []

  try {
    // 1. WordPress
    if (post.post_to_wp && post.wp_url && post.wp_username && post.wp_app_password) {
      const wpResult = await publishToWordPress(post)
      if (wpResult.success) wpPostId = wpResult.wpPostId
      else errors.push(`WP: ${wpResult.error}`)
      if (wpResult.imageUrl) imageUrl = wpResult.imageUrl
    } else if (!imageUrl && post.image_base64 && post.wp_url && post.wp_username && post.wp_app_password) {
      const imgResult = await publishToWordPress({ ...post, post_to_wp: false })
      if (imgResult.imageUrl) imageUrl = imgResult.imageUrl
    }

    // 2. Instagram
    if (post.post_to_instagram && post.instagram_account_id && post.instagram_access_token && imageUrl) {
      const caption = post.insta_hashtags
        ? `${post.insta_caption || post.title}\n\n${post.insta_hashtags}`.trim()
        : (post.insta_caption || post.title).trim()
      const r = await publishToInstagram(imageUrl, caption, post.instagram_account_id, post.instagram_access_token)
      if (r.success) instagramPostId = r.postId
      else errors.push(`Instagram: ${r.error}`)
    }

    // 2b. Instagram Stories
    if (post.post_to_instagram_story && post.instagram_account_id && post.instagram_access_token && imageUrl) {
      const r = await publishToInstagramStory(imageUrl, post.instagram_account_id, post.instagram_access_token)
      if (!r.success) errors.push(`ストーリーズ: ${r.error}`)
      else if (!instagramPostId) instagramPostId = r.postId
    }

    // 3. Threads
    if (post.post_to_threads && post.threads_user_id && post.threads_access_token) {
      const caption = post.threads_caption || post.insta_caption || post.title
      const r = await publishToThreads(imageUrl || null, caption, post.threads_user_id, post.threads_access_token)
      if (r.success) threadsPostId = r.postId
      else errors.push(`Threads: ${r.error}`)
    }

    const hasSuccess = !!(wpPostId || instagramPostId || threadsPostId)
    const newStatus = errors.length === 0 ? 'published' : (hasSuccess ? 'published' : 'failed')

    await supabase.from('scheduled_posts').update({
      status: newStatus,
      published_at: hasSuccess ? new Date().toISOString() : null,
      wp_post_id: wpPostId || null,
      instagram_post_id: instagramPostId || null,
      threads_post_id: threadsPostId || null,
      image_url: imageUrl || post.image_url,
      error_message: errors.length > 0 ? errors.join('; ') : null
    }).eq('id', post.id)

    // 4. ループ：次回の予約を作成（loop_interval_days日後）
    if (post.loop_enabled && post.loop_interval_days > 0 && hasSuccess) {
      const nextDate = new Date(new Date(post.scheduled_at).getTime() + post.loop_interval_days * 24 * 60 * 60 * 1000)
      const { id, created_at, published_at, status, wp_post_id, instagram_post_id, threads_post_id, error_message, loop_count, image_base64, ...rest } = post
      await supabase.from('scheduled_posts').insert({
        ...rest,
        image_base64: null,
        scheduled_at: nextDate.toISOString(),
        status: 'pending',
        loop_count: (post.loop_count || 0) + 1
      })
    }
  } catch (e: any) {
    console.error(`[Publish] Error for "${post.title}":`, e.message)
    await supabase.from('scheduled_posts').update({ status: 'failed', error_message: e.message }).eq('id', post.id)
  }
}

// --- メインハンドラー（毎分cronから呼ばれる） ---
Deno.serve(async (_req) => {
  try {
    const { data: posts, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(3)

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    if (!posts || posts.length === 0) return new Response(JSON.stringify({ processed: 0 }), { status: 200 })

    for (const post of posts) {
      await processScheduledPost(post)
    }

    return new Response(JSON.stringify({ processed: posts.length }), { status: 200 })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
