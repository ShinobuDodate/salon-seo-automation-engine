# CLAUDE.md

このファイルはClaude Code（claude.ai/code）がこのリポジトリで作業する際のルールと手順を記載する。

## 言語設定

**必ず日本語で応答すること。**

## プロジェクト概要

**salon-seo-automation-engine** — Do-Date向けの美容サロンSEO記事自動生成・自動投稿ツール。
- Gemini AIで記事と画像を生成し、WordPress・Instagram・Threadsに自動投稿する
- Google AI Studio上でホスティング（Cloud Run）

## 開発フロー（必ず守ること）

### 1. コードはここ（Claude Code）で書く
- `src/App.tsx`（フロントエンド・UIロジック）と`server.ts`（バックエンドAPI）を編集する
- App.tsxは1ファイルに全機能が集中している設計（分割しない）

### 2. GitHubにpushする
```bash
git add src/App.tsx server.ts  # 変更ファイルを明示的に指定
git commit -m "fix: 変更内容の説明"
git push origin main
```
- pushするとGitHub → AI Studioに自動で反映される

### 3. AI StudioのBuild機能で確認・動作テストする
- AI Studioを開き、GitHubの最新コードを読み込む
- **Build機能内では、Geminiの最新モデルが制限なく使える**
- 記事生成・自動投稿の実際の動作確認はBuild上で行う
- ローカル（`npm run dev`）ではAPIキーが必要なため、本番動作はAI Studioで確認する

## 技術スタック

| 役割 | 技術 |
|------|------|
| フロントエンド | React + TypeScript + Vite + Tailwind CSS |
| バックエンド | Express.js（`server.ts`） |
| AI | Google Gemini API（`@google/genai`） |
| DB・スケジューラ | Supabase |
| ホスティング | Google AI Studio / Cloud Run |

## ファイル構成

```
salon-seo-automation-engine/
├── src/App.tsx       # フロントエンド全体（UIとロジック）※巨大ファイル
├── server.ts         # Expressサーバー（API・WP投稿・SNS投稿・スケジューラ）
├── .env.local        # APIキー類（gitignore済み）
├── metadata.json     # AI Studioアプリ設定
└── package.json      # npm scripts
```

## デバッグツール（App.tsxを壊したとき）

```bash
# divタグの開閉バランスを確認する
npx tsx src/counter.ts > out.txt   # 行2370-3585の範囲
npx tsx src/count2.ts              # 行2335-3906の範囲（main含む）

# App.tsxをgitの最新に戻す（緊急復元）
npx tsx src/restore.ts
```

## 注意事項

- `src/App.tsx`は297KBの巨大ファイル。div開閉のバランスが崩れやすい
- 画像（base64 / data URI）はメモリ不足（OOM）の原因になる。ブラウザ側で持たせない
- 重い処理（画像生成・SNS投稿・ファイル抽出）はすべてサーバーサイド（server.ts）で行う
- localStorageにdata URI画像を保存しない（Chromeのメインスレッドがハングする）
- `.env.local`のAPIキーをコミットしない

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
