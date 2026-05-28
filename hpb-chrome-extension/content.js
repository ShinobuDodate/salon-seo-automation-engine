// HPBブログ自動投稿 - content.js
// HPBのページ上で実際のDOM操作（ログイン・記事投稿）を行うスクリプト
// Phase 2でHPBアカウントにアクセスした後、セレクタを実装する

// background.jsからの指示を受信
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'startPost') {
    handlePost(message.post)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // 非同期応答
  }
});

// 投稿処理メイン
async function handlePost(post) {
  console.log('[HPB Content] 投稿処理開始:', post.title);

  try {
    // ログイン状態確認
    const isLoggedIn = await checkLoginStatus();
    if (!isLoggedIn) {
      await doLogin(post);
    }

    // ブログ投稿ページに移動
    await navigateToBlogPost();

    // 記事を入力・投稿
    await fillAndSubmitPost(post);

    // 投稿完了をbackground.jsに通知
    chrome.runtime.sendMessage({ action: 'postComplete', postId: post.id });
  } catch (e) {
    console.error('[HPB Content] エラー:', e);
    chrome.runtime.sendMessage({ action: 'postFailed', postId: post.id, error: e.message });
  }
}

// ログイン状態を確認する
// TODO: Phase 2でHPB管理画面のURLとセレクタを確認後に実装
async function checkLoginStatus() {
  // HPBにログイン済みかどうかを確認するロジック
  // 例: ログイン後に表示される要素の有無を確認
  // const loggedInElement = document.querySelector('TODO: ログイン後要素のセレクタ');
  // return !!loggedInElement;
  console.log('[HPB Content] ログイン状態確認 - TODO: Phase 2で実装');
  return false; // 暫定: 常にログインが必要とみなす
}

// ログイン処理
// TODO: Phase 2でHPBログインフォームのセレクタを確認後に実装
async function doLogin(post) {
  console.log('[HPB Content] ログイン処理 - TODO: Phase 2で実装');

  // HPBログイン情報はSupabaseの予約データに含める予定
  // または、拡張機能の設定から読み込む

  /*
  Phase 2実装予定:
  // ログインページに移動
  window.location.href = 'TODO: HPBログインURL';
  await waitForNavigation();

  // ID入力
  const idInput = document.querySelector('TODO: IDフィールドセレクタ');
  idInput.value = loginId;

  // パスワード入力
  const pwInput = document.querySelector('TODO: パスワードフィールドセレクタ');
  pwInput.value = loginPassword;

  // ログインボタンクリック
  const loginBtn = document.querySelector('TODO: ログインボタンセレクタ');
  loginBtn.click();
  await waitForNavigation();
  */
}

// ブログ投稿ページへ移動
// TODO: Phase 2でHPBブログ投稿URLを確認後に実装
async function navigateToBlogPost() {
  console.log('[HPB Content] ブログ投稿ページへ移動 - TODO: Phase 2で実装');

  /*
  Phase 2実装予定:
  window.location.href = 'TODO: HPBブログ新規投稿URL';
  await waitForPageLoad();
  */
}

// 記事フォームに入力して投稿
// TODO: Phase 2でHPBブログ投稿フォームのセレクタを確認後に実装
async function fillAndSubmitPost(post) {
  console.log('[HPB Content] 記事投稿フォーム入力 - TODO: Phase 2で実装');

  /*
  Phase 2実装予定:
  // タイトル入力
  const titleInput = document.querySelector('TODO: タイトルフィールドセレクタ');
  titleInput.value = post.title;

  // 本文入力
  const contentInput = document.querySelector('TODO: 本文フィールドセレクタ');
  contentInput.value = post.content;

  // 画像アップロード（方式はPhase 2で確認）
  if (post.image_url) {
    // TODO: 画像アップロード処理
  }

  // 投稿ボタンクリック
  const submitBtn = document.querySelector('TODO: 投稿ボタンセレクタ');
  submitBtn.click();
  await waitForNavigation();
  */
}

// ページ読み込み完了まで待機するユーティリティ
function waitForPageLoad() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
      return;
    }
    window.addEventListener('load', resolve, { once: true });
  });
}

// 指定セレクタの要素が出現するまで待機するユーティリティ
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`タイムアウト: ${selector} が見つかりません`));
    }, timeout);
  });
}

// 指定ms待機するユーティリティ
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[HPB Content] content.js 読み込み完了');
