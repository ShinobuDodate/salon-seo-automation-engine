# CLAUDE.md

このファイルはClaude Code（claude.ai/code）がこのリポジトリで作業する際のルールと手順を記載する。
引継ぎ資料.txt の内容が正であり、このファイルはそれに準拠している。

---

## 言語設定

**必ず日本語で応答すること。** 専門用語はなるべく使わない。

---

## プロジェクト概要

**salon-seo-automation-engine** — 美容サロン向けSEO記事を自動生成し、WordPress・Instagram・Threadsに自動投稿するツール。
- Gemini AIで記事と画像を生成し、WordPress・Instagram・Threadsに自動投稿する
- Google AI Studio（Cloud Run）上でホスティングして運用している

主なファイル：
- `src/App.tsx` — フロントエンド全体（UIとすべてのロジック）※非常に大きい（297KB超）
- `server.ts` — バックエンドAPI（WP投稿・SNS投稿・スケジューラ）
- `metadata.json` — AI Studioのアプリ設定（基本触らない）

---

## 開発フロー（必ず守ること）

コードはClaude Code（ここ）で書いて、GitHubにpushするとAI Studio Buildに自動反映される。

```bash
git add src/App.tsx server.ts
git commit -m "fix: 変更内容の説明"
git push origin main
```

pushしたあと、AI Studioで最新を読み込んで動作確認する。
ローカル（`npm run dev`）ではAPIキーが必要なため、本番確認はAI Studioで行う。

GitHubリポジトリ：https://github.com/ShinobuDodate/salon-seo-automation-engine

---

## AI Studioの重要な特性（ここが最重要）

### ブラウザ側のGemini SDK呼び出し → 動く
AI Studio Build環境では、ブラウザ上でGemini SDKを呼ぶとAI Studioが自動で認証してくれる。APIキー不要で動く。

### サーバー側（server.ts）のGemini呼び出し → 動かない
server.tsからGeminiを呼ぶと「API key not valid」エラーになる。
ADC（Cloud RunのメタデータサーバーのトークンでGeminiを呼ぶ方法）も試したが、generative-languageのスコープが足りず403エラーになる。この問題の解決策は現時点で見つかっていない。

### 【絶対ルール】
**Geminiを使う処理は、必ずブラウザ側（src/App.tsx）に書く。server.tsにGemini呼び出しを追加してはいけない。**

---

## 使用するモデル名（変更禁止）

| 用途 | モデル名 |
|------|----------|
| Flashモデル（最新） | `gemini-3-flash-preview` |
| Proモデル（最新） | `gemini-3.1-pro-preview` |
| 画像生成・編集 | `gemini-2.5-flash-image` |

AI Studio Build環境では、これらのモデルを制限なく使える。これらを使うためにBuild環境で運用している。

**NG例**：`gemini-2.0-flash`、`gemini-1.5-pro` など他のモデル名に変える → APIキーエラーまたは動作不良になる

**モデル名を変える場合は必ずユーザーに確認してから変更すること。**

---

## 各機能の実装場所（現在の正しい状態）

| 機能 | 実装場所 | 備考 |
|------|----------|------|
| 記事生成テキスト（generateBlogPost） | ブラウザ側（App.tsx） | 以前サーバー側に移したがAPIキーエラーで戻した |
| タイトル案生成（generateBatchPosts） | ブラウザ側（App.tsx） | |
| ファイル解析（PDF/画像のアップロード） | ブラウザ側（App.tsx） | ボディパース問題＋APIキーエラーでサーバー側は断念 |
| TXT/MD/CSVの読み込み | ブラウザ側（FileReader直接） | Gemini不要 |
| 画像生成（/api/generate-image） | server.ts | 同様のAPIキー問題を抱えている可能性あり（未解決） |
| WordPress投稿・SNS投稿・スケジューラ | server.ts | 問題なし |

---

## 技術スタック

| 役割 | 技術 |
|------|------|
| フロントエンド | React + TypeScript + Vite + Tailwind CSS |
| バックエンド | Express.js（`server.ts`） |
| AI | Google Gemini API（`@google/genai`） |
| DB・スケジューラ | Supabase |
| ホスティング | Google AI Studio / Cloud Run |

---

## 主なAPIエンドポイント（server.ts）

| エンドポイント | 役割 |
|--------------|------|
| `POST /api/wp-proxy` | WordPressへのCORSプロキシ |
| `POST /api/generate-image` | Geminiで画像生成（サーバーサイド） |
| `POST /api/schedule-post` | Supabaseに予約投稿を保存 |
| `GET /api/scheduled-posts` | 予約投稿一覧取得 |
| `POST /api/publish-instagram` | Instagram即時投稿 |
| `POST /api/publish-threads` | Threads即時投稿 |
| `POST /api/publish-story` | Instagramストーリーズ即時投稿 |
| `POST /api/fetch-url` | サロン参照URLの本文抽出 |
| `POST /api/extract-file-context` | アップロードファイルのテキスト抽出 |

---

## ファイルサイズ制限

PDF・画像のアップロード上限：**50MB**

理由：GeminiのinlineData上限が52428800バイト（50MB）。超えると「Document size exceeds supported limit」エラーになる。100MB超になるとブラウザがbase64変換の途中でOOMクラッシュし、エラーメッセージすら出ない。

対策済み：ファイル選択時に`file.size`を事前チェックして、50MB超は読み込まずに即エラーメッセージを表示する。

---

## エラー表示の仕組み

エラーを画面に出すには `setNotification` を使う。

```javascript
// 正しい書き方
setNotification({ message: 'エラーメッセージ', type: 'error' });

// 間違いやすい書き方（画面に何も出ない）
setState({ status: 'error', error: 'メッセージ' });
// ※ state.errorはJSXでレンダリングされていないため見た目に何も変わらない
```

---

## コード変更前に必ず行うこと

1. **TypeScriptチェックを実行する**：`npx tsc --noEmit`
2. **変更後も再チェックして、変更前と結果が同じことを確認**してからpush

---

## 【最重要】変更・push前の必須手順

**Edit・Write・git commit・git push を実行する前に、必ず「実行していいですか？」とユーザーに確認すること。**

以下の流れを必ず守る：
1. 何を・なぜ変えるのかを説明する
2. 「実行していいですか？」と聞く
3. ユーザーから明示的な承認（「はい」「OK」「進めて」「やって」「いいです」など）をもらう
4. その後にはじめてコードを変更・pushする

**以下は許可ではない（承認とみなさない）：**
- ユーザーが質問に答えた（「画像編集です」「ストーリーです」など）
- ユーザーが状況を補足・説明した
- ユーザーが感情を表現した（「おい！」など）
- 別の質問が返ってきた

この手順を省略・省略と解釈することは一切禁止。過去に何度も繰り返した失敗。

---

## ユーザーとのやりとりのルール（必ず守ること）

1. **必ず日本語で応答する**
2. **コードを変更する前に「何を・なぜ変えるのか」をユーザーに説明し、「実行していいですか？」と聞いてから実行する**
3. **問題が解決しない場合、勝手に代替案を提示しない**（ユーザーのルール：「以前できていたことができないからといって、他のやり方で代案するのは禁止」）
4. **モデル名・認証まわりの変更は必ずユーザーに確認を取ってから行う**
5. **「最新をAI Studioで確認してください」を同じ問題に対して繰り返さない**
6. **revertを指示されたとき**：本当に動いていた状態まで戻すこと。commitを一つ一つ確認して、どの時点まで戻すべきか慎重に判断する

---

## 過去にやってダメだったこと（繰り返し禁止）

1. **記事生成をserver.tsに移した** → サーバー側APIキーエラーで動かない。ブラウザ側に戻すこと
2. **ファイル解析をserver.tsに残した** → express.raw()のボディパース問題＋APIキーエラーで動かない
3. **ADC認証を試みた** → generative-languageスコープ不足で403エラー。現時点で解決策なし
4. **モデル名を勝手に変えた（gemini-2.0-flashなど）** → ユーザーが強く反対。モデル名変更はユーザー確認が必須
5. **「最新をAI Studioで読み込んでみてください」を何度も繰り返した** → 1ヶ月間解決できていない問題に同じ言葉を繰り返すのはNG
6. **元のやり方ができないからと勝手に代替案を提示した** → 禁止
7. **revertが中途半端だった** → 「最初に戻せ」と言われたとき、本当に動いていた状態まで戻すこと
8. **「実行していいですか？」を聞かずにコード変更・pushした** → ユーザーの返答（質問・補足・感情表現）を許可と解釈してpushするのは禁止

---

## 注意事項

- `src/App.tsx` は297KB超の巨大ファイル。div開閉のバランスが崩れやすい
- 画像（base64 / data URI）はメモリ不足（OOM）の原因になる。ブラウザ側で持たせない
- localStorageにdata URI画像を保存しない（Chromeのメインスレッドがハングする）
- `.env.local` のAPIキーをコミットしない

---

## デバッグツール（App.tsxを壊したとき）

```bash
# divタグの開閉バランスを確認する
npx tsx src/counter.ts > out.txt   # 行2370-3585の範囲
npx tsx src/count2.ts              # 行2335-3906の範囲（main含む）

# App.tsxをgitの最新に戻す（緊急復元）
npx tsx src/restore.ts
```

---

## 現在の未解決の問題

- 画像生成（/api/generate-image）がserver.ts側にあり、同様のAPIキー問題を抱えている可能性がある（未確認）
- PDFの内容をGeminiで解析する際、Geminiの解析精度は内容・形式による
- 大きいPDFファイル（40〜50MB）は上限内でも処理が遅い可能性がある
