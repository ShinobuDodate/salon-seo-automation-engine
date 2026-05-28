// HPBブログ自動投稿 - popup.js

const startBtn = document.getElementById('startBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const statusBadge = document.getElementById('statusBadge');
const queueInfo = document.getElementById('queueInfo');
const queueCount = document.getElementById('queueCount');
const lastCheck = document.getElementById('lastCheck');
const supabaseUrlInput = document.getElementById('supabaseUrl');
const supabaseKeyInput = document.getElementById('supabaseKey');

// 保存済み設定を読み込む
chrome.storage.local.get(['supabaseUrl', 'supabaseKey', 'isPosting', 'queueCount', 'lastCheckResult', 'lastCheckTime'], (result) => {
  if (result.supabaseUrl) supabaseUrlInput.value = result.supabaseUrl;
  if (result.supabaseKey) supabaseKeyInput.value = result.supabaseKey;
  updateStatusUI(result);
});

// 状態を定期更新（1秒ごと）
setInterval(() => {
  chrome.storage.local.get(['isPosting', 'queueCount', 'lastCheckResult', 'lastCheckTime'], updateStatusUI);
}, 1000);

function updateStatusUI(result) {
  if (result.isPosting) {
    statusBadge.className = 'status-badge status-active';
    statusBadge.textContent = '投稿中...';
    startBtn.disabled = true;
    queueInfo.textContent = result.queueCount ? `残り ${result.queueCount} 件` : '';
  } else {
    statusBadge.className = 'status-badge status-idle';
    statusBadge.textContent = '待機中';
    startBtn.disabled = false;
    queueInfo.textContent = '';
  }

  if (result.lastCheckResult) {
    const time = result.lastCheckTime || '';
    lastCheck.textContent = `最終確認: ${time} — ${result.lastCheckResult}`;
  }

  if (result.queueCount !== undefined) {
    queueCount.textContent = result.queueCount || '0';
  }
}

// 設定を保存
saveConfigBtn.addEventListener('click', () => {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    alert('URLとKeyを入力してください');
    return;
  }

  chrome.storage.local.set({ supabaseUrl: url, supabaseKey: key }, () => {
    saveConfigBtn.textContent = '保存しました ✓';
    setTimeout(() => { saveConfigBtn.textContent = '設定を保存'; }, 2000);
  });
});

// 手動で投稿を実行
startBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startPosting' }, (response) => {
    if (response && response.ok) {
      statusBadge.className = 'status-badge status-active';
      statusBadge.textContent = '投稿中...';
      startBtn.disabled = true;
    }
  });
});
