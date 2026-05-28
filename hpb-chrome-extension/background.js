// HPBブログ自動投稿 - background.js
// Supabaseから予約投稿を取得し、HPBへの自動投稿を管理する

// Supabase設定（popup.jsから保存された設定を使用）
let supabaseUrl = '';
let supabaseKey = '';
let isPosting = false;
let postQueue = [];

// 設定を読み込む
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], (result) => {
      supabaseUrl = result.supabaseUrl || '';
      supabaseKey = result.supabaseKey || '';
      resolve();
    });
  });
}

// SupabaseからHPB予約投稿を取得
async function fetchHpbPosts() {
  if (!supabaseUrl || !supabaseKey) {
    console.log('[HPB] Supabase未設定');
    return [];
  }

  try {
    const now = new Date().toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/scheduled_posts?post_to_hpb=eq.true&status=eq.pending&scheduled_at=lte.${now}&order=scheduled_at.asc&limit=10`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      console.error('[HPB] Supabase fetch error:', response.status);
      return [];
    }

    const posts = await response.json();
    console.log(`[HPB] 投稿対象: ${posts.length}件`);
    return posts;
  } catch (e) {
    console.error('[HPB] fetch error:', e);
    return [];
  }
}

// 投稿後にSupabaseのステータスを更新
async function updatePostStatus(postId, status, errorMessage = null) {
  if (!supabaseUrl || !supabaseKey) return;

  const body = { status };
  if (status === 'published') body.published_at = new Date().toISOString();
  if (errorMessage) body.error_message = errorMessage;

  try {
    await fetch(
      `${supabaseUrl}/rest/v1/scheduled_posts?id=eq.${postId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(body)
      }
    );

    // ループ投稿の場合、次の予約を作成
    // TODO: Phase 3でループ管理を実装
  } catch (e) {
    console.error('[HPB] status update error:', e);
  }
}

// HPBに記事を投稿するメイン処理
async function startHpbPosting() {
  if (isPosting) {
    console.log('[HPB] 既に投稿中');
    return;
  }

  await loadConfig();
  const posts = await fetchHpbPosts();

  if (posts.length === 0) {
    console.log('[HPB] 投稿対象なし');
    chrome.storage.local.set({ lastCheckResult: '投稿対象なし', lastCheckTime: new Date().toLocaleString('ja-JP') });
    return;
  }

  isPosting = true;
  postQueue = [...posts];
  chrome.storage.local.set({ isPosting: true, queueCount: postQueue.length, currentIndex: 0 });

  console.log(`[HPB] ${postQueue.length}件の投稿を開始`);
  await processNextPost();
}

// キューの次の記事を処理
async function processNextPost() {
  if (postQueue.length === 0) {
    isPosting = false;
    chrome.storage.local.set({ isPosting: false, queueCount: 0, lastCheckResult: '投稿完了' });
    console.log('[HPB] 全件投稿完了');
    return;
  }

  const post = postQueue.shift();
  console.log(`[HPB] 投稿開始: ${post.title}`);

  try {
    // HPBサロン管理画面を開いて投稿を実行
    // TODO: Phase 2でHPBログインとフォーム操作を実装
    // 現在はスケルトン（実際の投稿処理はcontent.jsで行う）

    const tabs = await chrome.tabs.query({ url: 'https://salon.hotpepper.jp/*' });

    if (tabs.length === 0) {
      // HPBページが開いていない場合は新規タブで開く
      const tab = await chrome.tabs.create({ url: 'https://salon.hotpepper.jp/' });
      // タブが読み込まれるまで待機してからcontent.jsに指示を送る
      chrome.storage.local.set({ pendingPost: post, tabId: tab.id });
    } else {
      // 既存のタブを使用
      chrome.storage.local.set({ pendingPost: post, tabId: tabs[0].id });
      chrome.tabs.sendMessage(tabs[0].id, { action: 'startPost', post });
    }
  } catch (e) {
    console.error('[HPB] post error:', e);
    await updatePostStatus(post.id, 'failed', e.message);
    // エラーが起きても次の記事へ
    setTimeout(() => processNextPost(), 3000);
  }
}

// content.jsからの完了通知を受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'postComplete') {
    console.log('[HPB] 投稿完了通知:', message.postId);
    updatePostStatus(message.postId, 'published').then(() => {
      // 次の記事は5秒後（HPBサーバー負荷軽減）
      setTimeout(() => processNextPost(), 5000);
    });
    sendResponse({ ok: true });
  }

  if (message.action === 'postFailed') {
    console.log('[HPB] 投稿失敗通知:', message.postId, message.error);
    updatePostStatus(message.postId, 'failed', message.error).then(() => {
      setTimeout(() => processNextPost(), 5000);
    });
    sendResponse({ ok: true });
  }

  if (message.action === 'getStatus') {
    chrome.storage.local.get(['isPosting', 'queueCount', 'currentIndex', 'lastCheckResult', 'lastCheckTime'], (result) => {
      sendResponse(result);
    });
    return true;
  }
});

// popup.jsからの手動実行指示
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'startPosting') {
    startHpbPosting();
    sendResponse({ ok: true });
  }
});

// 定期チェック（アラーム）— Chromeが開いている間、5分ごとに確認
chrome.alarms.create('hpbCheck', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'hpbCheck') {
    startHpbPosting();
  }
});

// 拡張機能起動時に一度チェック
chrome.runtime.onInstalled.addListener(() => {
  console.log('[HPB] 拡張機能インストール完了');
});

chrome.runtime.onStartup.addListener(() => {
  startHpbPosting();
});
