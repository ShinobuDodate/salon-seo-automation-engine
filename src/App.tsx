

import { useState, ChangeEvent, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import React from 'react';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Play,
  Loader2,
  Calendar,
  CheckCircle,
  AlertCircle,
  Zap,
  Image as ImageIcon,
  Settings,
  Plus,
  Trash2,
  ChevronDown,
  X,
  Share2,
  Instagram,
  Eye,
  Save,
  FileText,
  Globe,
  RefreshCw,
  Database
} from "lucide-react";

// --- Types ---
interface GenerationState {
  status: 'idle' | 'generating' | 'completed' | 'error';
  imageUrl?: string;
  error?: string;
  progressMessage?: string;
  isDemo?: boolean;
}

interface ProductImages {
  main?: string;
}

// --- Constants ---
const SAMPLE_IMAGE_PROMPT = "A professional and high-end aesthetic salon business scene, professional photography, 4k, bright and trustworthy.";

// --- Blog Types ---
interface BlogPost {
  id: string;
  title: string;
  content: string;
  plainContent?: string;
  metaDescription: string;
  instaCaption?: string;
  instaHashtags?: string;
  threadsCaption?: string;
  imageUrl?: string;
  imageBase64?: string;
  keywords: string[];
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'posted';
  isPosting?: boolean;
  wpId?: number;
  wpStatus?: string;
  wpLink?: string;
  postingMessage?: string;
  jsonLd?: string;
  selectedSocialAccounts?: string[]; // IDs of social accounts to post to
}

interface SocialAccount {
  id: string;
  name: string;
  platform: 'instagram' | 'threads';
  accessToken: string;
  pageId?: string; // For Instagram
  userId?: string; // For Threads
  appId?: string;
  appSecret?: string;
}

interface CommonContent {
  id: string;
  name: string;
  type: 'code' | 'plain';
  content: string;
}

interface WpSite {
  id: string;
  name: string;
  url: string;
  username: string;
  appPassword: string;
  newsSlug: string;
}

interface SalonProfile {
  id: string;
  name: string;
  hpUrl: string;
  hotpepperUrl: string;
  instagramUrl: string;
  otherUrls: string[];
  notes: string;
}

// --- Styles ---
const COMMON_FOOTER = `<div style="margin-top: 50px; padding: 30px; background: #f9f9f9; border-radius: 15px; border: 1px solid #eee; text-align: center; font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, sans-serif;">
<h3 style="color: #333; margin-bottom: 15px; font-size: 18px; font-weight: bold; line-height: 1.4;">商品の導入、詳細はお気軽にお問い合わせください</h3>
<p style="color: #666; font-size: 14px; line-height: 1.8; margin-bottom: 25px;">商品の資料や詳細を知りたい方、ご興味ある方はお気軽にご相談ください。
資料、講習などお客様のご要望に合わせて、ご紹介させていただきます。</p>

<div style="text-align: center; margin: 20px 0;"><a style="display: inline-block; background-color: #d4af37; color: #ffffff; padding: 18px 40px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.4); border: none; cursor: pointer;" href="https://do-date.com/contact/">お問い合わせ・資料請求はこちら
</a></div>
<div style="margin-top: 30px; font-size: 12px; color: #999; border-top: 1px dotted #ccc; padding-top: 20px;"><strong>Do-Date 事務局</strong>
公式サイト: <a style="color: #d4af37; text-decoration: none;" href="https://do-date.com/">https://do-date.com/</a></div>
</div>
`;

// --- Utilities ---
const callGeminiWithRetry = async (fn: () => Promise<any>, maxRetries = 5, initialDelay = 2000) => {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      const errorStr = (errorMsg + (error.stack || '')).toLowerCase();
      // 認証・リクエスト不正エラーは即失敗（リトライ不要）
      const isFatal = errorStr.includes('401') ||
                      errorStr.includes('403') ||
                      errorStr.includes('invalid api key') ||
                      errorStr.includes('unauthorized') ||
                      errorStr.includes('permission denied');
      if (!isFatal && retries < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, retries);
        console.warn(`Gemini API error, retrying in ${delay}ms (${retries + 1}/${maxRetries}): ${errorMsg}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      } else {
        throw error;
      }
    }
  }
};

const safeParseJson = (text: string, fallback: any = {}) => {
  if (!text) return fallback;
  
  // Clean the text from bad control characters that break JSON.parse
  // Specifically, literal newlines, tabs, and other control chars inside string literals.
  const cleanText = (str: string) => {
    try {
      // Replace literal control characters (0-31) that are not allowed in JSON strings.
      // We replace them with their escaped versions.
      return str.replace(/[\x00-\x1F\x7F-\x9F]/g, (match) => {
        if (match === '\n') return '\\n';
        if (match === '\r') return '\\r';
        if (match === '\t') return '\\t';
        return ''; // Remove other control characters
      });
    } catch (e) {
      return str;
    }
  };

  const trimmed = text.trim();
  
  // Helper to try parsing a string as JSON
  const tryParse = (str: string) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      try {
        return JSON.parse(cleanText(str));
      } catch (e2) {
        return null;
      }
    }
  };

  // 1. Try direct parse
  const direct = tryParse(trimmed);
  if (direct) return direct;

  // 2. Try to extract JSON from Markdown blocks or just find the first {
  let jsonCandidate = trimmed;
  const startBrace = trimmed.indexOf('{');
  const startBracket = trimmed.indexOf('[');
  
  if (startBrace !== -1 || startBracket !== -1) {
    const isObject = startBrace !== -1 && (startBracket === -1 || startBrace < startBracket);
    const startIdx = isObject ? startBrace : startBracket;
    const endChar = isObject ? '}' : ']';
    let endIdx = trimmed.lastIndexOf(endChar);
    
    if (endIdx > startIdx) {
      jsonCandidate = trimmed.substring(startIdx, endIdx + 1);
      const extracted = tryParse(jsonCandidate);
      if (extracted) return extracted;
    } else {
      // Truncated: no closing brace found
      jsonCandidate = trimmed.substring(startIdx);
    }
  }

  // 3. Handle truncation by appending missing quotes and braces
  let attempt = jsonCandidate.trim();
  
  // If it ends with a comma or colon, remove it
  if (attempt.endsWith(',') || attempt.endsWith(':')) {
    attempt = attempt.slice(0, -1).trim();
  }

  // Close open string literal
  const chars = attempt.split('');
  let inString = false;
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\\' && !escaped) {
      escaped = true;
    } else {
      if (chars[i] === '"' && !escaped) {
        inString = !inString;
      }
      escaped = false;
    }
  }
  
  if (inString) {
    // If it ends with an escape character, remove it first
    if (attempt.endsWith('\\')) {
      attempt = attempt.slice(0, -1);
    }
    attempt += '"';
  }
  
  // Heuristic: if it ends with a key but no value, e.g. "key"
  // we need to add : null or similar. But that's complex.
  // Let's just try to close the braces.
  
  // Close open braces/brackets
  const openBraces = (attempt.match(/{/g) || []).length;
  const closeBraces = (attempt.match(/}/g) || []).length;
  for (let i = 0; i < openBraces - closeBraces; i++) {
    attempt += '}';
  }
  
  const openBrackets = (attempt.match(/\[/g) || []).length;
  const closeBrackets = (attempt.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    attempt += ']';
  }

  const fixed = tryParse(attempt);
  if (fixed) return fixed;

  // Final fallback: if it's really broken, try to at least get the title if it's there
  if (attempt.includes('"title":')) {
    const titleMatch = attempt.match(/"title":\s*"([^"]+)"/);
    if (titleMatch) {
      return { title: titleMatch[1], content: "（記事の生成中にエラーが発生しました。内容が不完全な可能性があります）" };
    }
  }

  console.error("Failed to parse JSON even after fixes. Original text snippet:", trimmed.substring(0, 500));
  return fallback;
};

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState;
  public props: ErrorBoundaryProps;
  
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-white p-8 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold text-black/90">予期せぬエラーが発生しました</h2>
            <p className="text-sm text-black/50 leading-relaxed">
              アプリケーションの実行中にエラーが発生しました。ページを再読み込みしてもう一度お試しください。
            </p>
            <div className="p-4 bg-black/5 rounded-xl text-left overflow-auto max-h-40">
              <code className="text-[10px] text-red-500 whitespace-pre-wrap">
                {this.state.error?.toString()}
              </code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-gold text-white py-3 rounded-xl font-bold shadow-lg shadow-gold/20 hover:bg-gold/90 transition-all"
            >
              ページを再読み込み
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Main App ---
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [state, setState] = useState<GenerationState>({ status: 'idle' });
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  
  // NEWS State
  const [blogKeywords, setBlogKeywords] = useState<string[]>(["", "", "", "", ""]);
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>(() => {
    const saved = localStorage.getItem('blog_posts_history');
    if (saved) {
      try {
        const posts = safeParseJson(saved, []);
        // 起動時に古いdata URI画像を除去（旧バージョンのデータが残っている場合のOOM対策）
        return posts.map((p: BlogPost) => ({
          ...p,
          imageBase64: undefined,
          imageUrl: p.imageUrl?.startsWith('data:') ? undefined : p.imageUrl,
        }));
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  // Auto-save posts to localStorage (always strip data URI images to avoid blocking main thread)
  useEffect(() => {
    const preparePostsForStorage = (posts: BlogPost[], limit: number) => {
      return posts.slice(0, limit).map(p => {
        const post = { ...p };
        post.imageBase64 = undefined;
        if (post.imageUrl?.startsWith('data:')) {
          post.imageUrl = undefined;
        }
        return post;
      });
    };

    try {
      const postsToSave = preparePostsForStorage(blogPosts, 50);
      localStorage.setItem('blog_posts_history', JSON.stringify(postsToSave));
    } catch (e) {
      console.warn("Failed to save blog posts to localStorage. Trying minimal set...", e);
      try {
        const minimalPosts = preparePostsForStorage(blogPosts, 5);
        localStorage.setItem('blog_posts_history', JSON.stringify(minimalPosts));
      } catch (criticalError) {
        console.error("Critical failure saving to localStorage.", criticalError);
      }
    }
  }, [blogPosts]);

  const [currentlyPostingId, setCurrentlyPostingId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [blogSettings, setBlogSettings] = useState(() => {
    const defaultSettings = {
      targetUrl: "https://do-date.com/web/",
      username: "",
      appPassword: "",
      wpSites: [{
        id: 'default',
        name: 'do-date.com',
        url: 'https://do-date.com/web/',
        username: '',
        appPassword: '',
        newsSlug: 'news'
      }] as WpSite[],
      selectedWpSiteId: 'default',
      categoryId: "",
      articleCount: 10,
      destinations: ['blog'] as string[],
      newsSlug: 'news',
      scheduleStrategy: '1hour' as 'simultaneous' | '10mins' | '1hour' | '1day' | 'custom',
      sourceUrl: "",
      sourceStrategy: 'mixed' as 'mixed' | 'strict',
      useGoogleSearch: true,
      postingInterval: 60, // Restored original posting interval setting
      enableGeoOptimization: false,
      sourceFiles: [] as { name: string, extractedText: string }[],
      customImagePrompt: "",
      uploadedImages: [] as string[], // array of base64
      imageMode: 'ai' as 'ai' | 'upload' | 'edit',
      bannerText: "",
      toWhom: "",
      what: "",
      tone: "専門的・信頼感重視",
      how: "理解してもらう",
      detailedInstructions: "",
      modelSelection: 'pro' as 'pro' | 'flash',
      socialAccounts: [] as SocialAccount[],
      commonContents: [
        {
          id: 'default-footer',
          name: 'デフォルトお問い合わせ',
          type: 'code',
          content: `<div style="margin-top: 50px; padding: 30px; background: #f9f9f9; border-radius: 15px; border: 1px solid #eee; text-align: center; font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, sans-serif;">
<h3 style="color: #333; margin-bottom: 15px; font-size: 18px; font-weight: bold; line-height: 1.4;">商品の導入、詳細はお気軽にお問い合わせください</h3>
<p style="color: #666; font-size: 14px; line-height: 1.8; margin-bottom: 25px;">商品の資料や詳細を知りたい方、ご興味ある方はお気軽にご相談ください。
資料、講習などお客様のご要望に合わせて、ご紹介させていただきます。</p>

<div style="text-align: center; margin: 20px 0;"><a style="display: inline-block; background-color: #d4af37; color: #ffffff; padding: 18px 40px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.4); border: none; cursor: pointer;" href="https://do-date.com/contact/">お問い合わせ・資料請求はこちら
</a></div>
<div style="margin-top: 30px; font-size: 12px; color: #999; border-top: 1px dotted #ccc; padding-top: 20px;"><strong>Do-Date 事務局</strong>
公式サイト: <a style="color: #d4af37; text-decoration: none;" href="https://do-date.com/">https://do-date.com/</a></div>
</div>`
        }
      ] as CommonContent[],
      selectedAboveImageContentId: '',
      selectedBottomContentId: 'default-footer',
      selectedInstaBottomContentId: '',
      selectedThreadsBottomContentId: '',
      instagramAccessToken: '',
      instagramBusinessId: '',
      instagramAppId: '',
      instagramAppSecret: '',
      isShortLivedToken: false,
      salonProfiles: [] as SalonProfile[],
      selectedSalonId: '',
    };
    const saved = localStorage.getItem('blog_settings_v3');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const merged = { ...defaultSettings, ...parsed };
        // 既存設定からwpSitesへ自動移行
        if ((!merged.wpSites || merged.wpSites.length === 0) && merged.targetUrl) {
          merged.wpSites = [{
            id: 'default',
            name: merged.targetUrl.replace(/https?:\/\//, '').replace(/\/.*$/, ''),
            url: merged.targetUrl,
            username: merged.username || '',
            appPassword: merged.appPassword || '',
            newsSlug: merged.newsSlug || 'news'
          }];
          merged.selectedWpSiteId = 'default';
        } else if (merged.wpSites && merged.wpSites.length > 0 && !merged.selectedWpSiteId) {
          merged.selectedWpSiteId = merged.wpSites[0].id;
        }
        // 選択中サイトの情報をミラーフィールドに同期
        const activeSite = merged.wpSites?.find((s: WpSite) => s.id === merged.selectedWpSiteId);
        if (activeSite) {
          merged.targetUrl = activeSite.url;
          merged.username = activeSite.username;
          merged.appPassword = activeSite.appPassword;
          merged.newsSlug = activeSite.newsSlug || 'news';
        }
        return merged;
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  // Save settings to localStorage
  useEffect(() => {
    // Don't save uploadedImages to localStorage as they are too large
    const { uploadedImages, sourceFiles, ...settingsToSave } = blogSettings;
    localStorage.setItem('blog_settings_v3', JSON.stringify(settingsToSave));
  }, [blogSettings]);

  // Policy Presets
  const [policyPresets, setPolicyPresets] = useState<{
    toWhom: string[];
    what: string[];
    keywords: string[];
  }>(() => {
    const defaultPresets = {
      toWhom: ["30代の働く女性", "エステサロンのオーナー", "美容に関心の高い層"],
      what: ["最新の痩身技術", "サロン集客のノウハウ", "美容機器の導入メリット"],
      keywords: ["エステサロン 事務代行", "サロン集客", "美容経営", "痩身エステ", "フェイシャル"]
    };
    const saved = localStorage.getItem('blog_policy_presets');
    if (saved) {
      try {
        const parsed = safeParseJson(saved, {});
        return { ...defaultPresets, ...parsed };
      } catch (e) {
        return defaultPresets;
      }
    }
    return defaultPresets;
  });

  const [showPresetManager, setShowPresetManager] = useState(false);
  const [showCommonContentManager, setShowCommonContentManager] = useState(false);
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SocialAccount | null>(null);
  const [newAccountData, setNewAccountData] = useState({
    name: '',
    platform: 'instagram' as 'instagram' | 'threads',
    pageId: '',
    accessToken: ''
  });
  const [newPresetInputs, setNewPresetInputs] = useState({
    toWhom: '',
    what: '',
    keywords: ''
  });
  const [expandedWpSiteId, setExpandedWpSiteId] = useState<string>(
    () => blogSettings.selectedWpSiteId || 'default'
  );
  const [showAddWpSiteForm, setShowAddWpSiteForm] = useState(false);
  const [newWpSite, setNewWpSite] = useState<Omit<WpSite, 'id'>>({
    name: '', url: '', username: '', appPassword: '', newsSlug: 'news'
  });
  const [showSalonManager, setShowSalonManager] = useState(false);
  const [editingSalon, setEditingSalon] = useState<SalonProfile | null>(null);
  const [newSalon, setNewSalon] = useState<Omit<SalonProfile, 'id'>>({
    name: '', hpUrl: '', hotpepperUrl: '', instagramUrl: '', otherUrls: [], notes: ''
  });
  const [isFetchingUrls, setIsFetchingUrls] = useState(false);
  const [showSupabasePanel, setShowSupabasePanel] = useState(false);
  const [supabasePosts, setSupabasePosts] = useState<any[]>([]);
  const [isFetchingSupabase, setIsFetchingSupabase] = useState(false);
  const [loopModal, setLoopModal] = useState<{
    post: BlogPost | null;
    loopEnabled: boolean;
    loopIntervalDays: number;
    loopTime: string; // "HH:MM" 空文字なら時刻指定なし
    saving: boolean;
  }>({ post: null, loopEnabled: true, loopIntervalDays: 43200, loopTime: '', saving: false });

  const formatLoopInterval = (minutes: number) => {
    if (minutes < 60) return `${minutes}分`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}時間`;
    return `${Math.round(minutes / 1440)}日`;
  };

  // Save presets to localStorage
  const savePresets = (newPresets: typeof policyPresets) => {
    setPolicyPresets(newPresets);
    localStorage.setItem('blog_policy_presets', JSON.stringify(newPresets));
  };

  const exportPosts = () => {
    const dataStr = JSON.stringify(blogPosts, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `blog_library_${new Date().toISOString().split('T')[0]}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const exportPostsAsCsv = () => {
    const headers = ['タイトル', 'メタディスクリプション', '本文(プレーン)', 'インスタキャプション', 'インスタハッシュタグ', 'Threadsキャプション', '画像URL', '生成日時'];
    const rows = blogPosts.map(p => [
      p.title || '',
      p.metaDescription || '',
      (p.plainContent || p.content || '').replace(/"/g, '""'),
      p.instaCaption || '',
      (p.instaHashtags || []).join(' '),
      p.threadsCaption || '',
      p.imageUrl || '',
      p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ja-JP') : ''
    ]);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/\n/g, '\\n')}"`).join(',')).join('\n');
    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `articles_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fetchUrlContent = async (url: string): Promise<string> => {
    if (!url) return '';
    try {
      const res = await fetch('/api/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      return data.content || '';
    } catch {
      return '';
    }
  };

  const buildSalonContext = async (salon: SalonProfile): Promise<string> => {
    setIsFetchingUrls(true);
    const urlMap: Record<string, string> = {
      'HP': salon.hpUrl,
      'ホットペッパー': salon.hotpepperUrl,
      'Instagram': salon.instagramUrl,
    };
    salon.otherUrls.forEach((u, i) => { if (u) urlMap[`参考URL${i + 1}`] = u; });

    let context = `【サロン情報: ${salon.name}】\n`;
    if (salon.notes) context += `メモ: ${salon.notes}\n`;
    context += '\n';

    for (const [label, url] of Object.entries(urlMap)) {
      if (!url) continue;
      const content = await fetchUrlContent(url);
      if (content) {
        context += `---[${label}: ${url}]---\n${content.substring(0, 3000)}\n\n`;
      } else {
        context += `---[${label}: ${url}]---\n(取得できませんでした)\n\n`;
      }
    }
    setIsFetchingUrls(false);
    return context;
  };

  const importPosts = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = safeParseJson(event.target?.result as string, []);
        if (Array.isArray(imported)) {
          setBlogPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newPosts = imported.filter(p => !existingIds.has(p.id));
            // Limit to 100 posts in memory
            return [...newPosts, ...prev].slice(0, 100);
          });
          setNotification({ message: `${imported.length}件の記事をライブラリに読み込みました。`, type: 'success' });
        }
      } catch (err) {
        setNotification({ message: 'ファイルの読み込みに失敗しました。正しい形式のファイルを選択してください。', type: 'error' });
      }
    };
    reader.readAsText(file);
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let files: File[] = [];
    if ('files' in e.target && e.target.files) {
      files = Array.from(e.target.files);
      e.target.value = ''; // ファイル入力をリセット（同じファイルを再選択できるように）
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      files = Array.from(e.dataTransfer.files);
    }

    if (files.length > 0) {
      files.forEach((file: File) => {
        setBlogSettings(prev => {
          if (prev.sourceFiles.some(f => f.name === file.name)) return prev;
          return { ...prev, sourceFiles: [...prev.sourceFiles, { name: file.name, extractedText: '解析中...' }] };
        });

        const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
        const isTxt = mimeType === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.csv');
        const maxBytes = 50 * 1024 * 1024; // 50MB (Geminiの上限)
        if (!isTxt && file.size > maxBytes) {
          setBlogSettings(prev => ({ ...prev, sourceFiles: prev.sourceFiles.filter(f => f.name !== file.name) }));
          setNotification({ message: `ファイルが大きすぎます（${(file.size / 1024 / 1024).toFixed(0)}MB）。PDF・画像は50MB以内にしてください。`, type: 'error' });
          return;
        }

        const reader = new FileReader();

        reader.onloadend = async () => {
          try {
            let extractedText = '';

            if (isTxt) {
              extractedText = reader.result as string;
            } else {
              const bytes = new Uint8Array(reader.result as ArrayBuffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              // レートリミット対策：失敗時に自動リトライ
              const response = await callGeminiWithRetry(() => ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: { parts: [
                  { inlineData: { data: base64, mimeType } },
                  { text: 'このファイルの内容を詳しく要約してください。重要な情報・数値・固有名詞をすべて含めてください。' }
                ]}
              }));
              extractedText = response?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || '';
              if (!extractedText) throw new Error('AIからの応答が空でした。もう一度お試しください。');
            }

            setBlogSettings(prev => ({
              ...prev,
              sourceFiles: prev.sourceFiles.map(f =>
                f.name === file.name ? { name: file.name, extractedText } : f
              )
            }));
          } catch (err: any) {
            // エラー時は「解析中...」のまま残さず必ず削除
            setBlogSettings(prev => ({ ...prev, sourceFiles: prev.sourceFiles.filter(f => f.name !== file.name) }));
            setNotification({ message: `ファイル解析エラー: ${err.message}`, type: 'error' });
          }
        };

        // FileReader自体が失敗した場合も「解析中...」を残さず削除
        reader.onerror = () => {
          setBlogSettings(prev => ({ ...prev, sourceFiles: prev.sourceFiles.filter(f => f.name !== file.name) }));
          setNotification({ message: `ファイルの読み込みに失敗しました。`, type: 'error' });
        };

        if (isTxt) {
          reader.readAsText(file, 'utf-8');
        } else {
          reader.readAsArrayBuffer(file);
        }
      });
    }
  };

  const repairJsonWithPro = async (rawText: string, schema: any) => {
    if (!rawText) return null;
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = blogSettings.modelSelection === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
      
      const repairPrompt = `あなたは高度なJSONデータ修復専門のAIです。
以下のテキストは、ブログ記事生成AIが出力した「不完全」または「壊れた」JSONデータです。
内容（記事本文やタイトルなど）を一切損なうことなく、不足している閉じ括弧、引用符、カンマなどを補完し、指定されたスキーマに完全に準拠した有効なJSON形式に修正してください。
出力はJSONのみとしてください。

【壊れたテキスト】
${rawText}`;

      const response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: modelName,
        contents: repairPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        }
      }));
      return response.text;
    } catch (e) {
      console.error("Pro repair failed:", e);
      return null;
    }
  };

  const generateBlogPost = async (topicOrKeywords?: string | string[], customTime?: string, isBatchMode = false, customImage?: string) => {
    const isBatch = typeof topicOrKeywords === 'string' && !blogKeywords.includes(topicOrKeywords);
    const topic = isBatch ? topicOrKeywords as string : null;
    const keywordsArray = blogKeywords.filter(k => k.trim() !== "");
    const keywordsString = keywordsArray.join(', ');
    
    if (!isBatchMode) {
      setState({
        status: 'generating',
        progressMessage: topic ? `記事「${topic}」を執筆中...` : 'SEOキーワードを分析し、記事を執筆中...'
      });
      // 単発生成時も生成開始前にuploadedImagesをクリア（OOM防止）
      if (blogSettings.uploadedImages.length > 0 && !customImage) {
        setBlogSettings(prev => ({ ...prev, uploadedImages: [] }));
      }
    }

    const overlayTextOnImage = (base64: string, text: string): Promise<{url: string, base64: string}> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ url: `data:image/png;base64,${base64}`, base64 });
            return;
          }
          ctx.drawImage(img, 0, 0);
          if (text) {
            const fontSize = Math.floor(canvas.height * 0.08);
            ctx.font = `bold ${fontSize}px sans-serif`;
            
            // Text wrapping logic
            const maxWidth = canvas.width * 0.85;
            const words = text.split('');
            let lines = [];
            let currentLine = '';

            for (let n = 0; n < words.length; n++) {
              let testLine = currentLine + words[n];
              let metrics = ctx.measureText(testLine);
              let testWidth = metrics.width;
              if (testWidth > maxWidth && n > 0) {
                lines.push(currentLine);
                currentLine = words[n];
              } else {
                currentLine = testLine;
              }
            }
            lines.push(currentLine);

            // Limit to 2 lines as requested
            if (lines.length > 2) {
              lines = [lines[0], lines.slice(1).join('').substring(0, 20) + '...'];
            }

            const lineHeight = fontSize * 1.2;
            const totalHeight = lines.length * lineHeight;
            
            // Position: slightly below center
            const centerY = (canvas.height / 2) + (canvas.height * 0.1);
            const startY = centerY - (totalHeight / 2) + (lineHeight / 2);

            // Draw background rectangle
            const rectPadding = fontSize * 0.5;
            const rectHeight = totalHeight + rectPadding * 2;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, centerY - (rectHeight / 2), canvas.width, rectHeight);

            // Draw text
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 10;

            lines.forEach((line, i) => {
              ctx.fillText(line, canvas.width / 2, startY + (i * lineHeight));
            });
          }
          const dataUrl = canvas.toDataURL('image/png');
          resolve({ url: dataUrl, base64: dataUrl.split(',')[1] });
        };
        img.onerror = () => resolve({ url: `data:image/png;base64,${base64}`, base64 });
        img.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
      });
    };

    try {
      const modelName = blogSettings.modelSelection === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';

      // Select a random angle to increase variety
      const angles = [
        '教育的・解説型（読者の悩みを専門知識で解決する）',
        'ケーススタディ・成功事例型（具体的な成功体験や変化を伝える）',
        'トレンド・最新情報型（業界の最新動向や流行を分析する）',
        'ストーリーテリング・共感型（読者の感情に訴えかけ、信頼を築く）',
        'Q&A・対話型（よくある質問に答える形式で親しみやすさを出す）',
        '比較・ランキング型（メリット・デメリットやおすすめを比較する）'
      ];
      const selectedAngle = angles[Math.floor(Math.random() * angles.length)];

      // サロン情報の取得
      const selectedSalon = blogSettings.salonProfiles.find(s => s.id === blogSettings.selectedSalonId);
      let salonContext = '';
      if (selectedSalon) {
        setState(prev => ({ ...prev, progressMessage: `${selectedSalon.name}のURL情報を読み込み中...` }));
        salonContext = await buildSalonContext(selectedSalon);
      }

      const tools: any[] = [];
      if (blogSettings.sourceUrl || selectedSalon) {
        tools.push({ urlContext: {} });
      }
      if (blogSettings.useGoogleSearch) {
        tools.push({ googleSearch: {} });
      }

      // ファイルはアップロード時にサーバー側で抽出済み（extractedTextとして保存）
      let fileContext = '';
      if (blogSettings.sourceFiles.length > 0) {
        fileContext = blogSettings.sourceFiles
          .filter(f => f.extractedText && f.extractedText !== '解析中...')
          .map(f => f.extractedText)
          .join('\n\n---\n\n');
      }

      const contentPrompt = `あなたは美容サロン専門のSEOライターです。
      【執筆方針】
      - ターゲット読者: ${blogSettings.toWhom || '美容サロンに関心のある読者'}
      - テーマ・訴求点: ${blogSettings.what || '美容・サロン関連の情報'}
      - 文体・トーン: ${blogSettings.tone || '専門的・信頼感重視'}
      - 記事の目的: ${blogSettings.how || '理解してもらう'}
      ${blogSettings.detailedInstructions ? `追加指示: ${blogSettings.detailedInstructions}` : ''}
      ${salonContext ? `\n【サロン参考情報（登録URLから取得）】\n${salonContext}\n上記のサロン情報を十分に理解し、そのサロンの特徴・強み・メニューを反映した記事を作成してください。` : ''}

      【今回の執筆スタイル（多様性の確保）】
      今回の記事は「${selectedAngle}」のスタイルで執筆してください。
      前回の記事と似たような構成にならないよう、文頭の表現や見出しの付け方を工夫し、読者が飽きない独自性のある内容にしてください。

      クライアントのサロンの課題を解決し、読者に価値を提供するブログ記事と、それに対応するInstagram投稿用のキャプションを作成してください。
      
      【情報ソースの扱い】
      ${blogSettings.sourceStrategy === 'strict' 
        ? '【最重要・厳守】外部の知識や創作は一切排除し、提供された「資料ファイル」および「指定URL」の内容のみをソースとして記事を作成してください。資料にない情報は絶対に書かないでください。'
        : '提供された資料やURLの内容を主軸にしつつ、あなたの持つ専門知識や最新の美容トレンドを交えて、読者にとってより有益で深みのある記事を作成してください。'}

      ${fileContext ? `【資料ファイルの内容】\n${fileContext}\n上記の資料内容を正確に反映させてください。` : ''}
      ${blogSettings.sourceUrl ? `・指定URLの内容を参考にしてください: ${blogSettings.sourceUrl}` : ''}
      ${blogSettings.useGoogleSearch ? `・Google検索を使用して、関連する最新情報やトレンドを補足してください。` : ''}

      【ターゲット】
      ${blogSettings.toWhom || '美容サロンに関心のある読者'}。

      ${topic ? `【今回のテーマ】\n${topic}\nこのテーマに沿って、読者の興味を惹く内容にしてください。` : ''}

      【執筆ルール - ブログ】
      1. **SEOスコア（AIOSEO/TrueSEO）で100点を取るための構成**にしてください。
      2. ターゲットキーワードを記事タイトル、**冒頭の一文目**、および各見出し（h2, h3）に必ず含めてください。
      3. 読者の悩みに共感し、解決策を提示するプロフェッショナルな視点で書いてください。
      4. 目的地が「お知らせ（News）」の場合は、最新のトレンドや役立つ情報を発信するトーンで書いてください。
      5. インスタハッシュタグは、必ず「#」記号を付けて、30個程度生成してください。
      6. HTML形式で出力し、タイトルは <h1> タグ、本文は <p> や <h2>, <h3> タグを使って構造化してください。
      7. 必ず一文ごとに改行を入れてください。
      8. **【最重要・警告】メタディスクリプション（metaDescription）は、必ず「120文字〜150文字」の範囲で記事を要約してください。絶対に本文（1000文字など）をそのまま入れないでください。**
      9. **本文は1000文字以上の十分なボリュームを持たせ、専門用語を適切に使用してください。**
      10. **ブログ記事の「HTMLタグを一切含まないプレーンテキスト版（plainContent）」も作成してください。見出しは空行で区切り、箇条書きなどは記号（・や-）を使って表現してください。**
      12. **【重要】出力は必ず有効なJSON形式にしてください。文字列内の改行は必ず \\n にエスケープし、制御文字を含めないでください。**
      13. **【最重要】SEOキーワードを太字（strongタグやbタグ）にしないでください。**
      14. **【禁止事項】記事の最後に「導入に関するご相談や、詳しい資料請求は公式サイトから承っております」や「株式会社Do-Date公式サイトはこちら」などの定型文や、点線で囲まれた連絡先情報を絶対に入れないでください。これらはシステム側で自動付与されます。**
      15. **記事タイトル（title）は、32文字〜40文字程度の簡潔で魅力的なものにしてください。長すぎないように注意してください。**
      16. **出力するHTMLコンテンツ（content）の冒頭や末尾に、不要な改行や空白を入れないでください。必ず <h1> タグから開始してください。**
      ${blogSettings.enableGeoOptimization ? `
      17. **【GEO最適化】GoogleのAI検索（AI Overviews）に選ばれやすくするため、記事の内容に基づいた「構造化データ（JSON-LD）」を生成してください。**
          - 記事の主題に合わせて、適切なSchema.orgタイプ（Article, Restaurant, Service, Productなど）を選択してください。
          - 必須フィールド（name, description, author, datePublishedなど）を網羅してください。
          - 出力JSONの "jsonLd" フィールドに、<script type="application/ld+json">...</script> タグを含めた文字列として格納してください。
      18. **【重要】本文（content）の中に、JSON-LDや構造化データ、スクリプトタグなどを絶対に含めないでください。これらは別途 "jsonLd" フィールドに格納してください。**
      ` : ''}

      【執筆ルール - Instagram】
      1. 読者の目を引く、親しみやすく魅力的なキャプション（instaCaption）を作成してください。**ハッシュタグは絶対に含めないでください。**
      2. 適度に絵文字を使用し、スマホで読みやすいように改行を多用してください。
      3. 記事の内容を3つのポイントで要約してください。
      4. 最後に「詳細はプロフィールのリンクからブログをチェック！」というCTAを入れてください。
      5. 関連性の高いハッシュタグ（instaHashtags）を30個程度、スペース区切りで作成してください。

      【執筆ルール - Threads（threadsCaption）】
      ⚠️【最重要・絶対厳守】以下のルールを必ず守ること。違反した場合はやり直し。
      1. **200文字以内**のプレーンテキストのみ。それ以上は絶対に生成しない。
      2. **「#」記号を1文字も含めない**。ハッシュタグは完全禁止。
      3. **instaCaption・instaHashtagsとは全く別の内容**にすること。コピー禁止。
      4. 絵文字は最大3個まで。
      5. 会話調の短い一言メッセージ形式で書く。

      【キーワードの優先順位と出現頻度】
      以下のキーワードを優先順位に従って使用してください。リストの上位にあるものほど、記事内での出現回数を多くし、より重要な文脈で使用してください。
      ${keywordsArray.map((k, i) => `${i + 1}. ${k}`).join('\n')}

      ターゲットキーワード全体: ${keywordsString}
      
      出力形式: JSON形式 { "title": "...", "content": "...", "plainContent": "...", "metaDescription": "...", "instaCaption": "...", "instaHashtags": "...", "threadsCaption": "..." ${blogSettings.enableGeoOptimization ? ', "jsonLd": "..."' : ''} }`;

      if (!isBatchMode) setState(prev => ({ ...prev, progressMessage: '記事テキストを生成中...' }));
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const articleSchema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          plainContent: { type: Type.STRING },
          metaDescription: { type: Type.STRING },
          instaCaption: { type: Type.STRING },
          instaHashtags: { type: Type.STRING },
          threadsCaption: { type: Type.STRING },
          jsonLd: { type: Type.STRING }
        },
        required: ["title", "content", "plainContent", "metaDescription", "instaCaption", "instaHashtags", "threadsCaption"]
      };
      const articleResponse = await callGeminiWithRetry(() => ai.models.generateContent({
        model: modelName,
        contents: contentPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: articleSchema,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools: tools.length > 0 ? tools : undefined
        }
      }));
      if (!articleResponse?.text) {
        throw new Error('AIからの応答が空でした。もう一度お試しください。');
      }

      // JSONが不完全な場合は修復を試みる
      let rawText = articleResponse.text;
      let needsRepair = false;
      try {
        const parsed = JSON.parse(rawText);
        if (!parsed.title || !parsed.content || parsed.content.length < 500) needsRepair = true;
      } catch { needsRepair = true; }

      if (needsRepair && rawText) {
        if (!isBatchMode) setState(prev => ({ ...prev, progressMessage: '記事を修復中...' }));
        const repairPrompt = `以下のテキストは不完全または壊れたJSONデータです。内容を一切変えずに、有効なJSON形式に修正してください。出力はJSONのみ。\n\n${rawText}`;
        try {
          const repairResponse = await callGeminiWithRetry(() => ai.models.generateContent({
            model: modelName,
            contents: repairPrompt,
            config: { responseMimeType: "application/json", responseSchema: articleSchema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          }));
          if (repairResponse?.text) rawText = repairResponse.text;
        } catch { /* 修復失敗時は元のテキストで続行 */ }
      }

      let blogData = safeParseJson(rawText, null);

      if (!blogData || typeof blogData !== 'object' || (!blogData.title && !blogData.content)) {
        console.error("Invalid blog data:", blogData, "Raw text:", rawText);
        throw new Error('AIからの応答を解析できませんでした。もう一度お試しください。');
      }

      // Use the provided content directly
      let finalContent = blogData.content || '';

      // Clean up any accidentally included JSON-LD in the content
      if (finalContent.includes('{"@context":') || finalContent.includes('<script type="application/ld+json">')) {
        console.warn("Detected JSON-LD inside content field. Stripping it...");
        // Remove script tags
        finalContent = finalContent.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
        // Remove raw JSON-LD objects that might be at the end
        // This regex looks for a JSON object starting with {"@context":"https://schema.org"
        finalContent = finalContent.replace(/\{"@context":\s*"https:\/\/schema\.org"[\s\S]*?\}/g, "");
      }

      let imageUrl = '';
      let imageBase64 = '';

      // Use the provided customImage if available, otherwise fallback to the first uploaded image if in upload/edit mode
      const selectedImage = customImage || (blogSettings.uploadedImages.length > 0 ? blogSettings.uploadedImages[0] : undefined);

      // Select a random image style for variety
      const imageStyles = [
        'A professional and high-end aesthetic salon business scene, bright and trustworthy.',
        'A close-up of a relaxing beauty treatment, soft lighting, serene atmosphere.',
        'A modern and stylish salon interior, minimalist design, elegant decor.',
        'A friendly interaction between a professional therapist and a client, warm and welcoming.',
        'A detail-oriented shot of premium beauty products or equipment, high-end feel.'
      ];
      const selectedImageStyle = imageStyles[Math.floor(Math.random() * imageStyles.length)];

      if (blogSettings.imageMode === 'upload' && selectedImage) {
        imageBase64 = selectedImage.split(',')[1] || selectedImage;
        imageUrl = selectedImage;
        
        if (blogSettings.bannerText) {
          try {
            const overlaid = await overlayTextOnImage(imageBase64, blogSettings.bannerText);
            imageUrl = overlaid.url;
            imageBase64 = overlaid.base64;
          } catch (e) {
            console.error("Image overlay error:", e);
            // Fallback to original image if overlay fails
          }
        }
      } else if (blogSettings.imageMode === 'edit' && selectedImage) {
        // Image-to-Image
        try {
          const imagePrompt = blogSettings.customImagePrompt
            ? `${blogSettings.customImagePrompt}. Keywords: ${keywordsString}. STRICT RULE: DO NOT include any text, letters, or characters in the image.`
            : `${selectedImageStyle} Professional photography, 4k. STRICT RULE: DO NOT include any text, letters, or characters in the image. Keywords: ${keywordsString}`;

          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const imgResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [
              { inlineData: { data: selectedImage.split(',')[1] || selectedImage, mimeType: 'image/png' } },
              { text: imagePrompt }
            ]},
            config: { imageConfig: { aspectRatio: "16:9" } }
          });
          const imgPart = imgResponse.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
          if (imgPart?.inlineData) {
            imageBase64 = imgPart.inlineData.data;
            if (blogSettings.bannerText) {
              const overlaid = await overlayTextOnImage(imageBase64, blogSettings.bannerText);
              imageUrl = overlaid.url;
              imageBase64 = overlaid.base64;
            } else {
              imageUrl = `data:image/png;base64,${imageBase64}`;
            }
          } else {
            imageUrl = selectedImage;
            imageBase64 = selectedImage.split(',')[1] || selectedImage;
          }
        } catch (e) {
          console.error("Image edit error:", e);
          imageUrl = selectedImage;
          imageBase64 = selectedImage.split(',')[1] || selectedImage;
        }
      } else {
        // AI Generation (default)
        try {
          const articleTitle = blogData.title || keywordsString;
          const articleSummary = blogData.metaDescription || '';
          const imagePrompt = blogSettings.customImagePrompt
            ? `${blogSettings.customImagePrompt}. Keywords: ${keywordsString}. STRICT RULE: DO NOT include any text, letters, or characters in the image.`
            : `${selectedImageStyle} This image is for a Japanese beauty salon blog article. Title: "${articleTitle}". Summary: "${articleSummary}". The image must visually represent the article content. Professional photography, 4k. STRICT RULE: DO NOT include any text, letters, or characters in the image. No text, no letters, no characters, no writing. Keywords: ${keywordsString}`;

          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const imgResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: imagePrompt,
            config: { imageConfig: { aspectRatio: "16:9" } }
          });
          const imgPart = imgResponse.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
          if (imgPart?.inlineData) {
            imageBase64 = imgPart.inlineData.data;
            if (blogSettings.bannerText) {
              const overlaid = await overlayTextOnImage(imageBase64, blogSettings.bannerText);
              imageUrl = overlaid.url;
              imageBase64 = overlaid.base64;
            } else {
              imageUrl = `data:image/png;base64,${imageBase64}`;
            }
          } else {
            imageUrl = 'https://picsum.photos/seed/salon/1200/630';
          }
        } catch (e) {
          console.error("Image generation error:", e);
          imageUrl = 'https://picsum.photos/seed/salon/1200/630';
        }
      }

      const newPost: BlogPost = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: blogData.title || '無題の記事',
        content: finalContent,
        plainContent: blogData.plainContent || '',
        metaDescription: blogData.metaDescription || '',
        instaCaption: blogData.instaCaption || '',
        instaHashtags: blogData.instaHashtags || '',
        threadsCaption: (blogData.threadsCaption || '').replace(/#\S*/g, '').replace(/\s{2,}/g, ' ').trim().substring(0, 280),
        imageUrl,
        imageBase64: '',
        jsonLd: blogData.jsonLd,
        keywords: keywordsArray,
        scheduledAt: customTime || new Date(Date.now() + 1000 * 60 * 60).toISOString(), 
        status: 'draft',
        selectedSocialAccounts: blogSettings.socialAccounts.map(a => a.id)
      };

      // Limit to 100 posts in memory
      setBlogPosts(prev => [newPost, ...prev].slice(0, 100));
      if (!isBatchMode) {
        setState({ status: 'completed', imageUrl });
        setEditingPost(newPost);
        setBlogSettings(prev => ({ ...prev, sourceFiles: [] }));
      }
      return newPost;
    } catch (error: any) {
      console.error("Generation error:", error);
      const errorMsg = error.message || String(error);
      const errorStr = (errorMsg + (error.stack || '')).toLowerCase();
      let errorMessage = '記事の生成に失敗しました。';

      const isQuotaError = errorStr.includes('429') ||
                           errorStr.includes('resource_exhausted') ||
                           errorStr.includes('exceeded quota') ||
                           errorStr.includes('quota exceeded');

      if (isQuotaError) {
        errorMessage = 'APIの利用制限（クォータ）に達しました。';
        if (blogSettings.modelSelection === 'pro') {
          errorMessage += ' Gemini 3.1 Proは制限が厳しいため、設定パネル下部で「Gemini 3 Flash」に切り替えてお試しください。';
        } else {
          errorMessage += ' 少し時間を置いてから再度お試しいただくか、生成する記事数を減らしてください。';
        }
      } else {
        errorMessage = `生成エラー: ${errorMsg}`;
      }

      if (!isBatchMode) {
        setState({ status: 'idle', error: undefined });
      }
      setNotification({ message: errorMessage, type: 'error' });
      return null;
    }
  };

  const generateInstaForPost = async (postId: string) => {
    const post = blogPosts.find(p => p.id === postId);
    if (!post) return;

    setState({ 
      status: 'generating', 
      progressMessage: `Instagram用文章を生成中...` 
    });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = blogSettings.modelSelection === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
      
      const prompt = `以下のブログ記事の内容を元に、Instagram投稿用のキャプションとハッシュタグを作成してください。

      【ブログ記事タイトル】
      ${post.title}

      【ブログ記事本文】
      ${post.content.replace(/<[^>]*>/g, '')}

      【執筆ルール】
      1. Instagram用（instaCaption）: 読者の目を引く、親しみやすく魅力的なキャプション。絵文字を適度に使用。**ハッシュタグは絶対に含めないでください。**
      2. Threads用（threadsCaption）: より会話調で、短く、意見や問いかけを含む内容。**ハッシュタグは絶対に含めないでください。**
      3. 共通: スマホで読みやすいように改行を多用。
      4. 共通: 記事の内容を3つのポイントで要約。
      5. 共通: 最後に「詳細はプロフィールのリンクからブログをチェック！」というCTA。
      6. ハッシュタグ（instaHashtags）: 関連性の高いハッシュタグを30個程度、必ず「#」記号を付けて、スペース区切りで作成してください。

      出力形式: JSON形式 { "instaCaption": "...", "threadsCaption": "...", "instaHashtags": "..." }`;

      const response = await callGeminiWithRetry(() => ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              instaCaption: { type: Type.STRING },
              threadsCaption: { type: Type.STRING },
              instaHashtags: { type: Type.STRING }
            },
            required: ["instaCaption", "threadsCaption", "instaHashtags"]
          },
          maxOutputTokens: 4096
        }
      }));

      if (!response || !response.text) {
        throw new Error('Instagram用の応答が空でした。');
      }

      const data = safeParseJson(response.text, {});
      
      if (!data.instaCaption) {
        throw new Error('Instagram用のキャプション生成に失敗しました。');
      }
      
      setBlogPosts(prev => prev.map(p => 
        p.id === postId 
          ? { ...p, instaCaption: data.instaCaption, threadsCaption: data.threadsCaption, instaHashtags: data.instaHashtags } 
          : p
      ));

      setState({ status: 'idle', progressMessage: '' });
    } catch (error) {
      console.error('Error generating Insta content:', error);
      setState({ status: 'error', progressMessage: '生成に失敗しました' });
    }
  };

  const generateBatchPosts = async () => {
    const articleCount = Math.max(1, Number(blogSettings.articleCount) || 1);
    const activeKeywordsArray = blogKeywords.filter(k => k.trim() !== "");
    
    setState({ 
      status: 'generating', 
      progressMessage: `${articleCount}記事の構成案を作成中...` 
    });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = blogSettings.modelSelection === 'pro' ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
      
      const activeKeywords = activeKeywordsArray.join(', ');
      const variationPrompt = `あなたは美容サロン専門のSEOライターです。
      ターゲット読者: ${blogSettings.toWhom || '美容サロン経営者や顧客'}
      テーマ・訴求点: ${blogSettings.what || '美容・サロン関連情報'}
      記事の目的: ${blogSettings.how || '理解してもらう'}

      キーワード「${activeKeywords}」をベースに、読者の興味を惹き、集客や経営改善に繋がるブログ記事のタイトル案（または具体的な小テーマ）を${articleCount}個作成してください。
      ${blogSettings.detailedInstructions ? `追加指示: ${blogSettings.detailedInstructions}` : ''}
      
      【ルール】
      1. 全て異なる切り口にしてください。
      2. ユーザーが入力したキーワードの意図を汲み取ってください。
      
      出力形式: JSON形式 { "variations": ["タイトル1", "タイトル2", ...] }`;

      const variationResponse = await callGeminiWithRetry(() => ai.models.generateContent({
        model: modelName,
        contents: variationPrompt,
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              variations: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["variations"]
          }
        }
      }));

      const variationData = safeParseJson(variationResponse.text || '{"variations": []}', { variations: [] });
      let variations = Array.isArray(variationData.variations) ? variationData.variations : [];
      
      // Ensure we have the requested number of variations
      if (variations.length === 0) {
        variations = Array(articleCount).fill("").map((_, i) => `記事案 ${i + 1}`);
      } else if (variations.length < articleCount) {
        // If LLM returned fewer, pad them
        const originalLength = variations.length;
        for (let i = 0; i < articleCount - originalLength; i++) {
          variations.push(`${variations[i % originalLength]} (別視点 ${Math.floor(i / originalLength) + 1})`);
        }
      }
      
      // Limit to requested count
      variations = variations.slice(0, articleCount);

      let index = 0;
      const now = Date.now() + 1000 * 60 * 5;

      // 生成前にアップロード済み画像をローカルに取り出してstateをクリア（OOM防止）
      const uploadedImagesCopy = [...blogSettings.uploadedImages];
      if (uploadedImagesCopy.length > 0) {
        setBlogSettings(prev => ({ ...prev, uploadedImages: [] }));
      }

      for (const v of variations) {
        // Add a small delay between requests to avoid rate limits (429 errors)
        if (index > 0) {
          setState(prev => ({
            ...prev,
            progressMessage: `レートリミット回避のため待機中... (${index + 1}/${articleCount}記事目)`
          }));
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds delay
        }

        setState({
          status: 'generating',
          progressMessage: `${articleCount}記事中 ${index + 1}記事目を生成中: ${v}`
        });

        let delay = 0;
        switch (blogSettings.scheduleStrategy) {
          case '10mins': delay = 1000 * 60 * 10 * index; break;
          case '1hour': delay = 1000 * 60 * 60 * index; break;
          case '1day': delay = 1000 * 60 * 60 * 24 * index; break;
          case 'simultaneous': delay = 0; break;
          case 'custom': delay = 1000 * 60 * 60 * index; break;
        }

        const scheduledTime = new Date(now + delay).toISOString();
        const customImage = uploadedImagesCopy.length > 0
          ? uploadedImagesCopy[index % uploadedImagesCopy.length]
          : undefined;
        const newPost = await generateBlogPost(v, scheduledTime, true, customImage);
        if (variations.length === 1 && newPost) {
          setEditingPost(newPost);
        }
        index++;
        
        // Small delay to avoid rate limits
        if (index < variations.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      setState({ status: 'completed' });
      setBlogSettings(prev => ({ ...prev, sourceFiles: [] }));
    } catch (error: any) {
      console.error("Batch generation error:", error);
      const errorMsg = error.message || String(error);
      const errorStr = (errorMsg + (error.stack || '')).toLowerCase();
      let errorMessage = '一括生成中にエラーが発生しました。';
      
      // Handle Rate Limit (429) specifically
      const isQuotaError = errorStr.includes('429') || 
                           errorStr.includes('resource_exhausted') || 
                           errorStr.includes('exceeded quota') ||
                           errorStr.includes('quota exceeded');

      if (isQuotaError) {
        errorMessage = 'APIの利用制限（クォータ）に達しました。';
        if (blogSettings.modelSelection === 'pro') {
          errorMessage += ' Gemini 3.1 Proは制限が厳しいため、設定パネル下部で「Gemini 3 Flash」に切り替えてお試しください。';
        } else {
          errorMessage = 'APIの利用制限に達しました。少し時間を置いてから再度お試しいただくか、生成する記事数を減らしてください。';
        }
      } else {
        errorMessage = `一括生成エラー: ${errorMsg}`;
      }
      
      setState({ status: 'idle', error: undefined });
      setNotification({ message: errorMessage, type: 'error' });
    }
  };

  const generateEmptyBatchPosts = () => {
    const articleCount = Math.max(1, Number(blogSettings.articleCount) || 1);
    const newPosts: BlogPost[] = [];
    const now = Date.now();
    
    for (let i = 0; i < articleCount; i++) {
        let delay = 0;
        switch (blogSettings.scheduleStrategy) {
          case '10mins': delay = 1000 * 60 * 10 * i; break;
          case '1hour': delay = 1000 * 60 * 60 * i; break;
          case '1day': delay = 1000 * 60 * 60 * 24 * i; break;
          case 'simultaneous': delay = 0; break;
          case 'custom': delay = 1000 * 60 * 60 * i; break; 
        }
        const scheduledTime = new Date(now + delay).toISOString();
        const customImage = blogSettings.uploadedImages.length > 0 
          ? blogSettings.uploadedImages[i % blogSettings.uploadedImages.length] 
          : undefined;
        
        const emptyPost: BlogPost = {
            id: Date.now().toString() + i,
            title: `ダミー記事 ${i + 1}`,
            content: "<h2>見出し</h2>\n\n<p>ここに本文が入ります。</p>",
            scheduledAt: scheduledTime,
            imageUrl: customImage || `https://picsum.photos/seed/${Date.now() + i}/800/600`,
            imageBase64: customImage,
            status: 'draft',
            instaCaption: "インスタ用のキャプション",
            instaHashtags: "ハッシュタグ1 ハッシュタグ2",
            threadsCaption: "Threads用のキャプション",
            metaDescription: "ダミー記事のメタディスクリプション",
            keywords: ["ダミー"]
        };
        newPosts.push(emptyPost);
    }
    
    setBlogPosts(prev => [...newPosts, ...prev].slice(0, 100));
    setNotification({ message: `${articleCount}件の空のダミー記事（枠）を作成しました。`, type: 'success' });
  };

  const updatePostDate = (id: string, newDate: string) => {
    setBlogPosts(prev => prev.map(p => p.id === id ? { ...p, scheduledAt: newDate } : p));
  };

  const deletePost = (id: string) => {
    setBlogPosts(prev => prev.filter(p => p.id !== id));
    setNotification({ message: "記事を削除しました。", type: 'success' });
  };

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isScanningTypes, setIsScanningTypes] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [availablePostTypes, setAvailablePostTypes] = useState<{slug: string, name: string}[]>([]);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [wpCategories, setWpCategories] = useState<{id: number, name: string}[]>([]);
  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [isCheckingIg, setIsCheckingIg] = useState(false);
  const [isExtendingToken, setIsExtendingToken] = useState(false);

  const getWpApiUrl = (baseUrl: string, endpoint: string = '') => {
    let base = baseUrl.trim();
    if (base.endsWith('/')) base = base.slice(0, -1);
    
    // If base already contains rest_route, it's a plain route
    if (base.includes('rest_route=')) {
      const sep = base.includes('?') ? '&' : '?';
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
      return `${base}${cleanEndpoint ? sep + cleanEndpoint : ''}`;
    }

    // Default to standard wp-json
    return `${base}/wp-json/wp/v2${endpoint}`;
  };

  const wpProxyFetch = async (url: string, options: any = {}) => {
    const { method = 'GET', headers = {}, body, isBase64, signal } = options;
    const response = await fetch('/api/wp-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body, isBase64 }),
      signal
    });
    
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (e) {
        data = await response.text();
      }
    } else {
      data = await response.text();
    }
    
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: async () => {
        if (typeof data === 'string') {
          try {
            return JSON.parse(data);
          } catch (e) {
            return { message: data };
          }
        }
        return data;
      },
      text: async () => typeof data === 'string' ? data : JSON.stringify(data)
    };
  };

  // 全WP APIリクエストに使う統一フォールバックヘルパー
  // 試行順: サブディレクトリ標準 → ルート標準 → サブディレクトリplain → ルートplain
  const wpFetchAuto = async (
    endpointPath: string,
    options: any = {}
  ): Promise<{ response: any; apiBase: string }> => {
    const base = blogSettings.targetUrl.trim().replace(/\/$/, '');

    if (base.includes('rest_route=')) {
      const [pathname, query] = endpointPath.split('?');
      const cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      const url = `${base}${cleanPath ? (base.includes('?') ? '&' : '?') + cleanPath : ''}${query ? '&' + query : ''}`;
      const response = await wpProxyFetch(url, options);
      return { response, apiBase: base };
    }

    const urlParts = base.split('/');
    const rootDomain = `${urlParts[0]}//${urlParts[2]}`;
    const hasSubdir = rootDomain !== base;

    const buildPlainUrl = (domain: string, path: string) => {
      const [pathname, query] = path.split('?');
      return `${domain}/index.php?rest_route=/wp/v2${pathname}${query ? '&' + query : ''}`;
    };

    const candidates: { url: string; apiBase: string }[] = [
      { url: `${base}/wp-json/wp/v2${endpointPath}`, apiBase: `${base}/wp-json/wp/v2` },
      ...(hasSubdir ? [{ url: `${rootDomain}/wp-json/wp/v2${endpointPath}`, apiBase: `${rootDomain}/wp-json/wp/v2` }] : []),
      { url: buildPlainUrl(base, endpointPath), apiBase: `${base}/index.php?rest_route=/wp/v2` },
      ...(hasSubdir ? [{ url: buildPlainUrl(rootDomain, endpointPath), apiBase: `${rootDomain}/index.php?rest_route=/wp/v2` }] : []),
    ];

    let lastResponse: any = null;
    let lastApiBase = candidates[0].apiBase;
    for (const { url, apiBase } of candidates) {
      console.log(`[WP] Trying: ${url}`);
      const response = await wpProxyFetch(url, options);
      if (response.ok) return { response, apiBase };
      lastResponse = response;
      lastApiBase = apiBase;
      if (response.status !== 404) break;
    }

    return { response: lastResponse, apiBase: lastApiBase };
  };

  const scanPostTypes = async () => {
    if (!blogSettings.targetUrl || !blogSettings.username || !blogSettings.appPassword) {
      setNotification({ message: "URL、ユーザー名、アプリパスワードを入力してください。", type: 'error' });
      return;
    }

    setIsScanningTypes(true);
    try {
      let baseUrl = blogSettings.targetUrl.trim();
      if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      
      let apiUrl = baseUrl;
      if (!apiUrl.includes('rest_route=')) {
        if (!apiUrl.includes('/wp-json')) apiUrl += '/wp-json/wp/v2';
        else if (!apiUrl.includes('/v2')) apiUrl += '/v2';
      }

      const credentials = btoa(`${blogSettings.username}:${blogSettings.appPassword}`);
      
      // Fetch all post types
      let response = await wpProxyFetch(`${apiUrl}/types`, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${credentials}` }
      });

      if (!response.ok && response.status === 404) {
        const plainApiUrl = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/index.php?rest_route=/wp/v2`;
        response = await wpProxyFetch(`${plainApiUrl}/types`, {
          method: 'GET',
          headers: { 'Authorization': `Basic ${credentials}` }
        });
      }

      if (response.ok) {
        const typesData = await response.json();
        const types = Object.values(typesData)
          .filter((t: any) => t.rest_base && t.name)
          .map((t: any) => ({ slug: t.rest_base, name: t.name }));
        
        setAvailablePostTypes(types);
        if (types.length > 0) {
          setNotification({ message: `利用可能な投稿タイプを${types.length}件見つけました。\n\n${types.map(t => `・${t.name} (${t.slug})`).join('\n')}`, type: 'success' });
        } else {
          setNotification({ message: "利用可能な投稿タイプが見つかりませんでした。", type: 'error' });
        }
      } else {
        const errText = await response.text();
        throw new Error(`投稿タイプの取得に失敗しました (HTTP ${response.status}): ${errText.substring(0, 100)}`);
      }
    } catch (error: any) {
      console.error("Scan error:", error);
      setNotification({ message: `スキャンエラー: ${error.message}`, type: 'error' });
    } finally {
      setIsScanningTypes(false);
    }
  };

  const handleGenerateImages = async () => {
    if (blogPosts.length === 0) {
      setNotification({ message: '記事がありません。先に記事を生成してください。', type: 'error' });
      return;
    }
    setIsGeneratingImages(true);
    const imageStyles = [
      'A luxurious and calming beauty salon atmosphere, soft lighting, premium aesthetic.',
      'A modern and stylish salon interior, minimalist design, elegant decor.',
      'A friendly interaction between a professional therapist and a client, warm and welcoming.',
      'A detail-oriented shot of premium beauty products or equipment, high-end feel.'
    ];
    let successCount = 0;
    for (const post of blogPosts) {
      try {
        const selectedImageStyle = imageStyles[Math.floor(Math.random() * imageStyles.length)];
        const keywordsString = (post.keywords || []).join(', ');
        const imagePrompt = blogSettings.customImagePrompt
          ? `${blogSettings.customImagePrompt}. Keywords: ${keywordsString}. STRICT RULE: DO NOT include any text, letters, or characters in the image.`
          : `${selectedImageStyle} This image is for a Japanese beauty salon blog article. Title: "${post.title}". Summary: "${post.metaDescription || ''}". Professional photography, 4k. STRICT RULE: DO NOT include any text, letters, or characters in the image. Keywords: ${keywordsString}`;
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const imgResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: imagePrompt,
          config: { imageConfig: { aspectRatio: "16:9" } }
        });
        const imgPart = imgResponse.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        if (imgPart?.inlineData) {
          const imageUrl = `data:image/png;base64,${imgPart.inlineData.data}`;
          setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, imageUrl, imageBase64: '' } : p));
          successCount++;
        }
      } catch (e) {
        console.error(`Image generation failed for "${post.title}":`, e);
      }
    }
    setNotification({ message: `${successCount}/${blogPosts.length}件の画像を生成しました。`, type: 'success' });
    setIsGeneratingImages(false);
  };

  const testWordPressConnection = async () => {
    if (!blogSettings.targetUrl || !blogSettings.username || !blogSettings.appPassword) {
      setConnectionTestResult({ success: false, message: "URL、ユーザー名、アプリパスワードをすべて入力してください。" });
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒でタイムアウト

    try {
      const baseUrl = blogSettings.targetUrl.trim();
      const credentials = btoa(`${blogSettings.username.trim()}:${blogSettings.appPassword.replace(/\s+/g, '')}`);
      const currentSlug = blogSettings.destinations.includes('news') ? blogSettings.newsSlug : 'posts';

      // 1. Try standard REST API path
      const apiUrl = getWpApiUrl(baseUrl);
      const fullEndpoint = `${apiUrl}/${currentSlug}?per_page=1`;
      
      console.log(`Testing standard connection to: ${fullEndpoint}`);
      let response = await wpProxyFetch(fullEndpoint, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${credentials}` },
        signal: controller.signal
      });

      // 2. If 404, try Plain Permalink path (?rest_route=)
      if (!response.ok && response.status === 404) {
        const plainApiUrl = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/index.php?rest_route=/wp/v2`;
        const plainEndpoint = `${plainApiUrl}/${currentSlug}&per_page=1`;
        console.log(`Standard failed (404), trying plain route: ${plainEndpoint}`);
        const plainResponse = await wpProxyFetch(plainEndpoint, {
          method: 'GET',
          headers: { 'Authorization': `Basic ${credentials}` },
          signal: controller.signal
        });
        if (plainResponse.ok) {
          response = plainResponse;
        }
      }

      // 3. If still not ok, try to check if the API exists at all (base check)
      if (!response.ok) {
        const baseApiCheck = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/wp-json/`;
        console.log(`Endpoint failed, checking base API: ${baseApiCheck}`);
        const baseResponse = await wpProxyFetch(baseApiCheck, {
          method: 'GET',
          headers: { 'Authorization': `Basic ${credentials}` },
          signal: controller.signal
        });
        
        if (baseResponse.ok) {
          // API exists but the specific post type/slug is wrong
          throw new Error(`WordPress APIは見つかりましたが、投稿先「${currentSlug}」が見つかりません（404）。\n\n「投稿タイプをスキャン」ボタンを押して、正しいスラッグを確認してください。`);
        }
      }

      clearTimeout(timeoutId);

      if (response.ok) {
        setConnectionTestResult({ success: true, message: "接続テスト成功！WordPressとの通信に成功しました。" });
      } else {
        let errorMessage = '接続に失敗しました。';
        
        try {
          const err = await response.json();
          errorMessage = err.message || errorMessage;
        } catch (e) {
          errorMessage = `HTTPエラー: ${response.status} ${response.statusText}`;
        }

        if (response.status === 401) {
          errorMessage = "認証に失敗しました（401 Unauthorized）。\n\n【チェックリスト】\n1. ユーザー名は「ログイン用ID」ですか？\n2. パスワードは「24文字の英数字」ですか？\n3. サーバーの「REST API制限」が有効になっていませんか？";
        } else if (response.status === 404) {
          errorMessage = `URLが見つかりません（404 Not Found）。\n\n【チェックリスト】\n1. URLが正しいか確認してください（例: https://do-date.com/web/）\n2. パーマリンク設定が「基本」以外になっていますか？\n3. 投稿先「${currentSlug}」は正しいスラッグですか？\n\n「投稿タイプをスキャン」ボタンで正しいスラッグを確認できます。`;
        } else if (response.status === 403) {
          errorMessage = "アクセスが拒否されました（403 Forbidden）。\n\n【原因】サーバーのセキュリティ設定（WAFやIP制限等）によってブロックされている可能性があります。";
        }
        
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error("Connection test error:", error);
      let msg = error.message;
      if (error.name === 'AbortError') {
        msg = "接続がタイムアウトしました（15秒）。\n\n【考えられる原因】\n1. サーバーの応答が極端に遅い\n2. ネットワークが不安定\n3. サーバーがリクエストを無視している";
      } else if (msg.includes('Failed to fetch')) {
        
        msg = "ネットワークエラーが発生しました。\n\n【考えられる原因】\n1. URLが間違っている（https:// が抜けている等）\n2. サーバーが外部からのアクセス（CORS）を許可していない\n3. 広告ブロック等のブラウザ拡張機能が干渉している";
      }
      setConnectionTestResult({ success: false, message: msg });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const fetchWordPressCategories = async () => {
    if (!blogSettings.targetUrl || !blogSettings.username || !blogSettings.appPassword) {
      setNotification({ message: "URL、ユーザー名、アプリパスワードを入力してください。", type: 'error' });
      return;
    }

    setIsFetchingCategories(true);
    try {
      const credentials = btoa(`${blogSettings.username}:${blogSettings.appPassword}`);
      const { response } = await wpFetchAuto('/categories?per_page=100', {
        method: 'GET',
        headers: { 'Authorization': `Basic ${credentials}` }
      });

      if (response.ok) {
        try {
          const categories = await response.json();
          if (!Array.isArray(categories)) {
            throw new Error("カテゴリーとしてHTMLページが返却されました。WordPressのURLが正しく設定されているか、またはREST APIが有効か確認してください。");
          }
          setWpCategories(categories.map((c: any) => ({ id: c.id, name: c.name })));
          setNotification({ message: `${categories.length}件のカテゴリーを取得しました。`, type: 'success' });
        } catch (parseErr: any) {
          throw new Error(parseErr.message || "カテゴリーとしてHTMLページが返却されました。WordPressのURLが正しく設定されているか、またはREST APIが有効か確認してください。");
        }
      } else {
        let errorText = "Unknown Error";
        try { errorText = await response.text(); } catch(e) {}
        const statusStr = response.status || "No Status";
        const isHtml = errorText.trim().toLowerCase().startsWith('<!doctype html>') || errorText.trim().toLowerCase().startsWith('<html');
        if (isHtml) {
          throw new Error(`カテゴリーの取得に失敗しました。[Status ${statusStr}] WordPressのAPI URLが正しくないか、セキュリティプラグインによりブロックされています。URL設定を見直してください。`);
        } else {
          throw new Error(`カテゴリーの取得に失敗しました。[Status ${statusStr}] ${errorText.substring(0, 300)}`);
        }
      }
    } catch (error: any) {
      console.error("Fetch categories error:", error);
      setNotification({ message: `取得エラー: ${error.message}`, type: 'error' });
    } finally {
      setIsFetchingCategories(false);
    }
  };

  const postToInstagramStory = async (imageUrl: string, account?: SocialAccount) => {
    const accessToken = (account?.accessToken || blogSettings.instagramAccessToken || '').trim();
    const businessId = (account?.pageId || blogSettings.instagramBusinessId || '').trim();
    if (!accessToken || !businessId) return { success: false, error: 'Instagram設定が未完了です。' };
    if (imageUrl.startsWith('data:')) return { success: false, error: 'ストーリーズには公開URLの画像が必要です。' };
    try {
      const res = await fetch('/api/publish-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, accountId: businessId, accessToken })
      });
      const data = await res.json();
      return data;
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };

  const postToInstagram = async (imageUrl: string, caption: string, account?: SocialAccount) => {
    const accessToken = (account?.accessToken || blogSettings.instagramAccessToken || '').trim();
    const businessId = (account?.pageId || blogSettings.instagramBusinessId || '').trim();
    if (!accessToken || !businessId) return { success: false, error: 'Instagram設定が未完了です。' };
    if (imageUrl.startsWith('data:')) return { success: false, error: 'Instagramには公開URLの画像が必要です。WordPressへのアップロードが失敗した可能性があります。' };
    try {
      const res = await fetch('/api/publish-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, caption, accountId: businessId, accessToken })
      });
      const data = await res.json();
      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const postToThreads = async (imageUrl: string | undefined, caption: string, account: SocialAccount) => {
    const accessToken = (account.accessToken || '').trim();
    const userId = (account.pageId || '').trim();
    if (!accessToken || !userId) return { success: false, error: 'Threads設定が未完了です。' };
    if (imageUrl && imageUrl.startsWith('data:')) return { success: false, error: 'Threadsに画像付きで投稿するには公開URLが必要です。WordPressへのアップロードが失敗した可能性があります。' };
    try {
      const res = await fetch('/api/publish-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, caption, userId, accessToken })
      });
      const data = await res.json();
      return data;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const extendInstagramToken = async () => {
    // フォーム入力中のトークンを優先して読む
    const token = (newAccountData.accessToken || blogSettings.instagramAccessToken || '').trim();
    const appId = blogSettings.instagramAppId.trim();
    const appSecret = blogSettings.instagramAppSecret.trim();

    if (!token) {
      setNotification({ message: 'アクセストークンを入力してください。（EAAから始まる文字列）', type: 'error' });
      return;
    }
    if (!appId || !appSecret) {
      setNotification({ message: 'アプリIDとApp Secretを入力してください。', type: 'error' });
      return;
    }

    setIsExtendingToken(true);
    try {
      const res = await fetch(
        `/api/extend-token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(token)}`
      );
      const data = await res.json();

      if (data.error) {
        let errorMsg = data.error.message || JSON.stringify(data.error);
        if (errorMsg.includes('Error validating application')) {
          errorMsg = 'アプリIDまたはApp Secretが正しくありません。';
        } else if (errorMsg.includes('Invalid OAuth access token')) {
          errorMsg = 'トークンが無効または期限切れです。Graph APIエクスプローラで新しいトークンを発行してください。';
        }
        throw new Error(errorMsg);
      }

      if (data.access_token) {
        // フォームのトークンも更新する
        setNewAccountData(prev => ({ ...prev, accessToken: data.access_token }));
        setBlogSettings(prev => ({
          ...prev,
          instagramAccessToken: data.access_token,
          instagramAppId: appId,
          instagramAppSecret: appSecret,
          // 登録済みInstagramアカウントのトークンも一括更新
          socialAccounts: prev.socialAccounts.map(acc =>
            acc.platform === 'instagram' ? { ...acc, accessToken: data.access_token } : acc
          )
        }));
        setNotification({ message: 'トークンを60日間に延長しました！登録済みアカウントも更新されました。', type: 'success' });
      }
    } catch (error: any) {
      console.error('Token Extension Error:', error);
      setNotification({ message: '延長エラー: ' + error.message, type: 'error' });
    } finally {
      setIsExtendingToken(false);
    }
  };

  // Instagram ID Checker
  const checkInstagramId = async () => {
    const token = blogSettings.instagramAccessToken.trim();
    if (!token) {
      setNotification({ message: 'アクセストークンを先に入力してください。', type: 'error' });
      return;
    }

    setIsCheckingIg(true);
    try {
      // Try multiple endpoints to find the IG ID
      // 1. Try me/accounts (Pages the user manages)
      const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account,name,access_token&access_token=${token}`);
      const data = await res.json();
      
      if (data.error) {
        throw new Error(`Meta Error: ${data.error.message} (Code: ${data.error.code})`);
      }
      
      let foundId = '';
      if (data.data && data.data.length > 0) {
        const pageWithIg = data.data.find((p: any) => p.instagram_business_account);
        if (pageWithIg) {
          foundId = pageWithIg.instagram_business_account.id;
        }
      }

      // 2. If not found, try direct business accounts (if it's a direct token)
      if (!foundId) {
        const res2 = await fetch(`https://graph.facebook.com/v19.0/me?fields=instagram_business_account&access_token=${token}`);
        const data2 = await res2.json();
        if (data2.instagram_business_account) {
          foundId = data2.instagram_business_account.id;
        }
      }
      
      if (foundId) {
        setBlogSettings({
          ...blogSettings,
          instagramBusinessId: foundId
        });
        setNotification({ message: 'InstagramビジネスIDを取得しました！', type: 'success' });
      } else {
        // Detailed diagnostic for the user
        const pageNames = data.data ? data.data.map((p: any) => p.name).join(', ') : 'なし';
        console.log('IG Diagnostic Data:', data);
        
        let msg = '';
        if (!data.data || data.data.length === 0) {
          msg = '管理しているFacebookページが1つも見つかりません。トークン発行時の画面で「ページ」にチェックを入れましたか？';
        } else {
          msg = `ページ「${pageNames}」は見つかりましたが、Instagramビジネスアカウントが紐付いていません。Facebookページの「設定」からInstagramを再度連携するか、Instagramが「プロアカウント」になっているか確認してください。`;
        }
        setNotification({ message: msg, type: 'error' });
      }
    } catch (error: any) {
      console.error('IG Check Error:', error);
      setNotification({ message: 'ID取得エラー: ' + error.message, type: 'error' });
    } finally {
      setIsCheckingIg(false);
    }
  };

  const deleteWpMedia = async (mediaId: number) => {
    if (!mediaId || !blogSettings.username || !blogSettings.appPassword) return;

    const baseUrl = blogSettings.targetUrl.trim();
    const credentials = btoa(`${blogSettings.username.trim()}:${blogSettings.appPassword.replace(/\s+/g, '')}`);
    let apiUrl = getWpApiUrl(baseUrl);

    try {
      console.log(`[Cleanup] Deleting relay image from WordPress: ID ${mediaId}`);
      // WordPress requires ?force=true to permanently delete, otherwise it goes to trash
      // Use POST with X-HTTP-Method-Override to bypass WAFs (like SiteGuard) blocking DELETE method
      let response = await wpProxyFetch(`${apiUrl}/media/${mediaId}?force=true`, {
        method: 'POST',
        headers: { 
          'Authorization': `Basic ${credentials}`,
          'X-HTTP-Method-Override': 'DELETE'
        }
      });

      if (!response.ok && response.status === 404) {
        const plainApiUrl = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/index.php?rest_route=/wp/v2`;
        console.log(`[Cleanup] 404 on standard route, trying plain route: ${plainApiUrl}`);
        response = await wpProxyFetch(`${plainApiUrl}/media/${mediaId}&force=true`, {
          method: 'POST',
          headers: { 
            'Authorization': `Basic ${credentials}`,
            'X-HTTP-Method-Override': 'DELETE'
          }
        });
      }

      if (response.ok) {
        console.log(`[Cleanup] Relay image ${mediaId} deleted successfully.`);
        // No need to notify success for background cleanup, but logging is good
      } else {
        const errText = await response.text();
        let errMsg = errText;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.message) errMsg = errJson.message;
          else if (errJson.error) errMsg = errJson.error;
        } catch(e) {}
        console.warn(`[Cleanup] Failed to delete relay image ${mediaId}: ${response.status}`, errText);
        setNotification({ 
          message: `一時画像の削除に失敗しました(ID: ${mediaId}, HTTP ${response.status})。詳細: ${errMsg}。手動で削除が必要な場合があります。`, 
          type: 'error' 
        });
      }
    } catch (error: any) {
      console.error("[Cleanup] Error deleting WP media:", error);
      setNotification({ 
        message: `一時画像の削除中にエラーが発生しました: ${error.message}。手動で削除が必要な場合があります。`, 
        type: 'error' 
      });
    }
  };

  const postToBlog = async (post: BlogPost, isImmediate: boolean = false, isBulk: boolean = false) => {
    const hasWpDestination = blogSettings.destinations.includes('blog') || blogSettings.destinations.includes('news');

    // Check both global settings and post-specific selected accounts
    const hasInstaDestination = blogSettings.destinations.includes('instagram') ||
      (post.selectedSocialAccounts && post.selectedSocialAccounts.some(id =>
        blogSettings.socialAccounts.find(a => a.id === id)?.platform === 'instagram'
      ));

    const hasStoryDestination = blogSettings.destinations.includes('instagram_story');

    const hasThreadsDestination = blogSettings.destinations.includes('threads') ||
      (post.selectedSocialAccounts && post.selectedSocialAccounts.some(id =>
        blogSettings.socialAccounts.find(a => a.id === id)?.platform === 'threads'
      ));

    if (hasWpDestination && (!blogSettings.username || !blogSettings.appPassword)) {
      if (!isBulk) setNotification({ message: "WordPressのユーザー名とアプリケーションパスワードを設定してください。", type: 'error' });
      return false;
    }

      // Set individual posting state
      setCurrentlyPostingId(post.id);
      setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, isPosting: true, postingMessage: isImmediate ? '送信中...' : '予約中...' } : p));
      
      if (!isBulk) {
        setState({ status: 'generating', progressMessage: isImmediate ? '送信中...' : '予約中...' });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 seconds timeout

      try {
        // ── 予約投稿: WP・Instagram・Threads 全てSupabaseに保存してサーバー任せ ──
        if (!isImmediate) {
          const wpSite = blogSettings.wpSites?.find((s: WpSite) => s.id === blogSettings.selectedWpSiteId);
          const instaAcc = blogSettings.socialAccounts.find((a: SocialAccount) => a.platform === 'instagram');
          const threadsAcc = blogSettings.socialAccounts.find((a: SocialAccount) => a.platform === 'threads');
          const bottomContent = blogSettings.commonContents.find((c: CommonContent) => c.id === blogSettings.selectedBottomContentId);
          const bottomHtml = bottomContent
            ? (bottomContent.type === 'plain'
                ? `<div style="margin:30px 0;padding:20px;background:#f9f9f9;border-radius:10px;border:1px solid #eee;text-align:center;color:#666;font-size:14px;line-height:1.8;">${bottomContent.content.replace(/\n/g, '<br>')}</div>`
                : bottomContent.content)
            : '';
          const instaCaption = (() => {
            let c = post.instaCaption || `${post.title}\n\n${post.metaDescription}`;
            const ic = blogSettings.commonContents.find((cc: CommonContent) => cc.id === blogSettings.selectedInstaBottomContentId);
            if (ic) c += '\n\n' + ic.content.replace(/<[^>]*>/g, '').trim();
            return c;
          })();

          const payload = {
            scheduled_at: post.scheduledAt,
            title: post.title,
            content: post.content,
            meta_description: post.metaDescription,
            image_url: (post.imageUrl && !post.imageUrl.startsWith('data:')) ? post.imageUrl : null,
            image_base64: (post.imageUrl && post.imageUrl.startsWith('data:')) ? post.imageUrl.split(',')[1] : null,
            keywords: post.keywords || [],
            insta_caption: instaCaption,
            insta_hashtags: typeof post.instaHashtags === 'string' ? post.instaHashtags : (post.instaHashtags as string[] | undefined)?.join(' ') || null,
            threads_caption: post.threadsCaption || null,
            bottom_content_html: bottomHtml || null,
            post_to_wp: hasWpDestination,
            post_to_instagram: hasInstaDestination,
            post_to_instagram_story: hasStoryDestination,
            post_to_threads: hasThreadsDestination,
            wp_url: wpSite?.url || blogSettings.targetUrl || null,
            wp_username: wpSite?.username || blogSettings.username || null,
            wp_app_password: wpSite?.appPassword || blogSettings.appPassword || null,
            wp_news_slug: wpSite?.newsSlug || blogSettings.newsSlug || 'news',
            wp_category_id: blogSettings.categoryId || null,
            wp_destinations: blogSettings.destinations.filter((d: string) => ['blog', 'news'].includes(d)),
            instagram_account_id: instaAcc?.pageId || blogSettings.instagramBusinessId || null,
            instagram_access_token: instaAcc?.accessToken || blogSettings.instagramAccessToken || null,
            threads_user_id: threadsAcc?.pageId || null,
            threads_access_token: threadsAcc?.accessToken || null,
            loop_enabled: false,
            loop_interval_days: 0,
          };

          const res = await fetch('/api/schedule-post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);

          clearTimeout(timeoutId);
          setCurrentlyPostingId(null);
          if (!isBulk) setState({ status: 'idle' });
          setBlogPosts(prev => prev.map(p => p.id === post.id ? {
            ...p, isPosting: false, status: 'scheduled',
            postingMessage: `予約完了（${new Date(post.scheduledAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）`
          } : p));
          return true;
        }

        let wpResult = null;
        let uploadedImageUrl = post.imageUrl;
        let featuredMediaId = 0;

        if ((hasInstaDestination || hasThreadsDestination) && (!blogSettings.username || !blogSettings.appPassword || !blogSettings.targetUrl)) {
           throw new Error("Instagram/Threads投稿には画像を公開するためのサーバー(WordPress)が必要です。設定画面でWordPress情報を正しく入力してください。");
        }

        // Upload image if either WordPress, Instagram, or Threads is a destination
        // Social media REQUIRES a public URL, so we use WordPress as the host
        if (hasWpDestination || hasInstaDestination || hasThreadsDestination) {
          const baseUrl = blogSettings.targetUrl.trim();
          
          // Only attempt upload/WP post if we have credentials
          if (blogSettings.username && blogSettings.appPassword) {
          const credentials = btoa(`${blogSettings.username.trim()}:${blogSettings.appPassword.replace(/\s+/g, '')}`);
          let apiUrl = getWpApiUrl(baseUrl);

          // 1. Upload Image to Media Library
          const imageBase64ForUpload = post.imageUrl?.startsWith('data:') ? post.imageUrl.split(',')[1] : null;
          if (imageBase64ForUpload) {
            try {
              const { response: mediaResponse, apiBase: mediaApiBase } = await wpFetchAuto('/media', {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${credentials}`,
                  'Content-Disposition': `attachment; filename="blog-image-${post.id}.png"`,
                  'Content-Type': 'image/png'
                },
                body: imageBase64ForUpload,
                isBase64: true,
                signal: controller.signal
              });

              if (mediaResponse.ok) {
                const mediaData = await mediaResponse.json();
                featuredMediaId = mediaData.id;
                if (mediaData.source_url) {
                  uploadedImageUrl = mediaData.source_url;
                }
                if (mediaApiBase) apiUrl = mediaApiBase;

                await wpProxyFetch(`${apiUrl}/media/${featuredMediaId}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${credentials}`
                  },
                  body: {
                    alt_text: post.keywords.join(', '),
                    description: post.title
                  },
                  signal: controller.signal
                });
              } else {
                let errorText = "Unknown Error";
                try { errorText = await mediaResponse.text(); } catch(e) {}
                const statusStr = mediaResponse.status || "No Status";
                throw new Error(`[Status ${statusStr}] ${errorText.substring(0, 500)}`);
              }
            } catch (imgErr: any) {
              console.error("Image upload failed:", imgErr);
              throw new Error(`WordPress画像アップロード失敗: ${imgErr.message || imgErr}`);
            }
          } else {
            console.log("No imageBase64 found to upload.");
            if (!uploadedImageUrl || uploadedImageUrl.startsWith('data:')) {
               throw new Error("画像のBase64データがありませんでした。一度編集画面で画像を選び直して再度保存してください。");
            }
          }
          
          // 2. WordPress Post Creation (Only if Blog/News is selected)
          if (hasWpDestination) {
            // Get common contents
            const getCommonHtml = (id: string) => {
              const content = blogSettings.commonContents.find(c => c.id === id);
              if (!content) return '';
              if (content.type === 'plain') {
                return `<div style="margin: 30px 0; padding: 20px; background: #f9f9f9; border-radius: 10px; border: 1px solid #eee; text-align: center; color: #666; font-size: 14px; line-height: 1.8;">${content.content.replace(/\n/g, '<br>')}</div>`;
              }
              return content.content;
            };

            const aboveImageHtml = getCommonHtml(blogSettings.selectedAboveImageContentId);
            const bottomHtml = getCommonHtml(blogSettings.selectedBottomContentId);

            const imageHtml = `<div style="margin: 40px 0;">
      <img src="${uploadedImageUrl}" alt="${post.keywords.join(', ')}" style="width:100%; height:auto; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
    </div>`;

            const finalContent = `${post.content.trim()}
    ${aboveImageHtml}
    ${imageHtml}
    ${bottomHtml}`;
            
            const postStatus = isImmediate ? 'publish' : 'future';
            const formatWPDate = (isoString: string) => isoString.split('.')[0].replace('Z', '');
            let postDate = isImmediate ? formatWPDate(new Date().toISOString()) : formatWPDate(post.scheduledAt);

            if (!isImmediate) {
              const scheduledTime = new Date(post.scheduledAt).getTime();
              const currentTime = Date.now();
              if (scheduledTime <= currentTime + 60000) {
                const safeDate = new Date(currentTime + 1000 * 60 * 5);
                postDate = formatWPDate(safeDate.toISOString());
                setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, scheduledAt: safeDate.toISOString() } : p));
              }
            }

            const postBody: any = {
              title: post.title,
              content: finalContent,
              excerpt: post.metaDescription,
              status: postStatus,
              categories: blogSettings.categoryId ? [parseInt(blogSettings.categoryId)] : [],
              featured_media: featuredMediaId > 0 ? featuredMediaId : undefined,
              date_gmt: postDate, // Use GMT date for accurate scheduling
              meta: {
                _aioseo_title: post.title,
                _aioseo_description: '#post_excerpt',
                _aioseo_focus_keyphrase: post.keywords[0] || "",
                _aioseo_keywords: post.keywords.join(','),
                _aioseo_score: "100",
                _aioseo_status: "published",
                description: post.metaDescription,
                _yoast_wpseo_metadesc: post.metaDescription,
                _yoast_wpseo_focuskw: post.keywords[0] || "",
                rank_math_focus_keyword: post.keywords[0] || "",
                rank_math_description: post.metaDescription
              }
            };

            const types = [];
            if (blogSettings.destinations.includes('blog')) types.push('posts');
            if (blogSettings.destinations.includes('news')) types.push(blogSettings.newsSlug);

            for (const type of types) {
              const { response: postResponse, apiBase: postApiBase } = await wpFetchAuto(`/${type}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Basic ${credentials}`
                },
                body: postBody,
                signal: controller.signal
              });

              let response = postResponse;
              if (postApiBase) apiUrl = postApiBase;

              // metaフィールド非対応のWPの場合、metaなしで再試行
              if (!response.ok && response.status === 400) {
                const { meta, ...bodyWithoutMeta } = postBody;
                response = await wpProxyFetch(`${postApiBase || apiUrl}/${type}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${credentials}`
                  },
                  body: bodyWithoutMeta,
                  signal: controller.signal
                });
              }

              if (response.ok) {
                wpResult = await response.json();
              } else {
                let errData;
                try {
                  errData = await response.json();
                } catch (e) {
                  errData = { message: `HTTP Error ${response.status}` };
                }
                
                // Format error message to be more readable, especially if it's HTML
                let errorMsg = typeof errData === 'string' 
                  ? (errData.length > 150 ? errData.substring(0, 150) + '...' : errData)
                  : (errData.message || JSON.stringify(errData));
                
                if (typeof errData === 'string' && errData.includes('<!DOCTYPE html>')) {
                  errorMsg = `WordPressからHTMLエラーが返されました (404 Not Foundなど)。URL設定を確認してください。`;
                }
                
                throw new Error(`[${type}] ${errorMsg}`);
              }
            }
          }
        }
      }

      clearTimeout(timeoutId);

      // Social Media Posting (即時投稿のみ。予約は上のSupabaseブロックで処理済み)
      let instaResult: any = null;
      let storyResult: any = null;
      let threadsResult: any = null;

      if (hasInstaDestination || hasStoryDestination || hasThreadsDestination) {
        if ((hasInstaDestination || hasStoryDestination) && !uploadedImageUrl) {
          throw new Error("Instagram/ストーリーズへの投稿には画像が必須です。画像を設定してください。");
        }

        const getCommonText = (id: string) => {
          const content = blogSettings.commonContents.find(c => c.id === id);
          if (!content) return '';
          return '\n\n' + content.content.replace(/<[^>]*>/g, '').trim();
        };

        // Instagram（即時）
        if (hasInstaDestination && uploadedImageUrl) {
          setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, postingMessage: 'Instagramに投稿中...' } : p));
          let instaCaption = post.instaCaption || `${post.title}\n\n${post.metaDescription}`;
          instaCaption += getCommonText(blogSettings.selectedInstaBottomContentId);

          const instaAccounts = blogSettings.socialAccounts.filter((a: SocialAccount) => a.platform === 'instagram');
          if (instaAccounts.length > 0) {
            for (const acc of instaAccounts) {
              const r = await postToInstagram(uploadedImageUrl, instaCaption, acc);
              if (!instaResult) instaResult = r;
            }
          } else if (blogSettings.instagramBusinessId && blogSettings.instagramAccessToken) {
            instaResult = await postToInstagram(uploadedImageUrl, instaCaption, undefined);
          } else {
            instaResult = { success: false, error: 'Instagram設定が未完了です。「ソーシャルアカウント」でアカウントを登録してください。' };
          }
        }

        // Instagram ストーリーズ（即時）
        if (hasStoryDestination && uploadedImageUrl) {
          setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, postingMessage: 'Instagramストーリーズに投稿中...' } : p));
          const instaAccounts = blogSettings.socialAccounts.filter((a: SocialAccount) => a.platform === 'instagram');
          if (instaAccounts.length > 0) {
            for (const acc of instaAccounts) {
              const r = await postToInstagramStory(uploadedImageUrl, acc);
              if (!storyResult) storyResult = r;
            }
          } else if (blogSettings.instagramBusinessId && blogSettings.instagramAccessToken) {
            storyResult = await postToInstagramStory(uploadedImageUrl, undefined);
          } else {
            storyResult = { success: false, error: 'Instagram設定が未完了です。' };
          }
        }

        // Threads（即時）
        if (hasThreadsDestination) {
          setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, postingMessage: 'Threadsに投稿中...' } : p));
          let threadsCaption = post.threadsCaption || `${post.title}\n\n${post.metaDescription}`;
          threadsCaption += getCommonText(blogSettings.selectedThreadsBottomContentId);

          const threadsAccounts = blogSettings.socialAccounts.filter((a: SocialAccount) => a.platform === 'threads');
          for (const acc of threadsAccounts) {
            threadsResult = await postToThreads(uploadedImageUrl, threadsCaption, acc);
          }
        }
      }

      // Cleanup: Delete relay image if WordPress was NOT a destination
      if (!hasWpDestination && featuredMediaId > 0) {
        console.log("Deleting relay image as WordPress was not a destination.");
        await deleteWpMedia(featuredMediaId);
      }

      // Update state based on results
      setBlogPosts(prev => prev.map(p => {
        if (p.id !== post.id) return p;
        
        let msg = '';
        if (hasWpDestination && wpResult) {
          msg = isImmediate ? 'WP公開完了' : `WP予約完了 (${wpResult.status})`;
        }
        
        if (hasInstaDestination) {
          if (instaResult?.success) {
            const label = instaResult.scheduled ? 'Insta予約完了' : 'Insta完了';
            msg = msg ? `${msg} / ${label}` : label;
          } else if (instaResult) {
            msg = msg ? `${msg} / Insta失敗: ${instaResult.error}` : `Insta失敗: ${instaResult.error}`;
          }
        }

        if (hasStoryDestination) {
          if (storyResult?.success) {
            msg = msg ? `${msg} / ストーリーズ完了` : 'ストーリーズ完了';
          } else if (storyResult) {
            msg = msg ? `${msg} / ストーリーズ失敗: ${storyResult.error}` : `ストーリーズ失敗: ${storyResult.error}`;
          }
        }

        if (hasThreadsDestination) {
          if (threadsResult?.success) {
            const label = threadsResult.scheduled ? 'Threads予約完了' : 'Threads完了';
            msg = msg ? `${msg} / ${label}` : label;
          } else if (threadsResult) {
            msg = msg ? `${msg} / Threads失敗: ${threadsResult.error}` : `Threads失敗: ${threadsResult.error}`;
          }
        }

        return {
          ...p,
          status: isImmediate ? 'posted' : 'scheduled',
          isPosting: false,
          wpId: wpResult?.id,
          wpStatus: wpResult?.status,
          wpLink: wpResult?.link,
          postingMessage: msg || '投稿完了'
        };
      }));

      return true;
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error("Post error:", error);
      let msg = error.message;
      if (error.name === 'AbortError') msg = "送信タイムアウト";
      setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, isPosting: false, postingMessage: `エラー: ${msg}` } : p));
      if (!isBulk) setNotification({ message: `投稿エラー: ${msg}`, type: 'error' });
      return false;
    } finally {
      setCurrentlyPostingId(null);
      if (!isBulk) {
        setState(prev => prev.status === 'error' ? prev : { status: 'completed' });
      }
    }
  };

  const bulkPostToBlog = async (isImmediate: boolean) => {
    console.log(`Starting bulk post: isImmediate=${isImmediate}`);
    const draftPosts = blogPosts.filter(p => p.status === 'draft');
    console.log(`Found ${draftPosts.length} draft posts`);
    
    if (draftPosts.length === 0) {
      setNotification({ message: "投稿待ちの記事がありません。", type: 'info' });
      return;
    }

    // Removing blocking confirm for better iframe compatibility
    const count = draftPosts.length;
    setState({ status: 'generating', progressMessage: `${count}件の記事を一括処理中...` });

    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < count; i++) {
        const post = draftPosts[i];
        setState(prev => ({ ...prev, progressMessage: `一括処理中 (${i + 1}/${count}): ${post.title}` }));
        try {
          const success = await postToBlog(post, isImmediate, true);
          if (success) successCount++;
          else failCount++;
        } catch (e) {
          console.error(`Bulk post failed for ${post.id}:`, e);
          failCount++;
        }
        
        if (i < count - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      setNotification({ 
        message: `一括処理が完了しました。成功: ${successCount}件, 失敗: ${failCount}件`,
        type: successCount > 0 ? 'success' : 'error' 
      });
    } finally {
      setState({ status: 'completed' });
    }
  };

  const fetchSupabasePosts = async () => {
    setIsFetchingSupabase(true);
    try {
      const res = await fetch('/api/scheduled-posts');
      const data = await res.json();
      setSupabasePosts(Array.isArray(data) ? data : []);
    } catch {
      setNotification({ message: 'Supabase取得エラー', type: 'error' });
    } finally {
      setIsFetchingSupabase(false);
    }
  };

  const deleteSupabasePost = async (id: string) => {
    try {
      await fetch(`/api/scheduled-post/${id}`, { method: 'DELETE' });
      setSupabasePosts(prev => prev.filter(p => p.id !== id));
      setNotification({ message: '予約を削除しました', type: 'success' });
    } catch {
      setNotification({ message: '削除エラー', type: 'error' });
    }
  };

  const publishSupabasePostNow = async (id: string) => {
    try {
      await fetch(`/api/scheduled-post/${id}/publish`, { method: 'POST' });
      setNotification({ message: '投稿処理を開始しました（バックグラウンドで実行中）', type: 'success' });
      setTimeout(fetchSupabasePosts, 5000);
    } catch {
      setNotification({ message: '投稿エラー', type: 'error' });
    }
  };

  const saveToSupabase = async (post: BlogPost, loopEnabled: boolean, loopIntervalDays: number, loopTime: string = '') => {
    setLoopModal(prev => ({ ...prev, saving: true }));
    try {
      const wpSite = blogSettings.wpSites?.find((s: WpSite) => s.id === blogSettings.selectedWpSiteId);
      const instaAccount = blogSettings.socialAccounts.find((a: SocialAccount) => a.platform === 'instagram' && (post.selectedSocialAccounts?.includes(a.id) || blogSettings.destinations.includes('instagram')));
      const threadsAccount = blogSettings.socialAccounts.find((a: SocialAccount) => a.platform === 'threads' && (post.selectedSocialAccounts?.includes(a.id) || blogSettings.destinations.includes('threads')));
      const hasWp = blogSettings.destinations.includes('blog') || blogSettings.destinations.includes('news');
      const hasInsta = !!(instaAccount || (blogSettings.instagramBusinessId && blogSettings.instagramAccessToken));
      const hasStory = blogSettings.destinations.includes('instagram_story');
      const hasThreads = !!threadsAccount;

      const bottomContent = blogSettings.commonContents.find((c: CommonContent) => c.id === blogSettings.selectedBottomContentId);
      const bottomHtml = bottomContent
        ? (bottomContent.type === 'plain'
            ? `<div style="margin: 30px 0; padding: 20px; background: #f9f9f9; border-radius: 10px; border: 1px solid #eee; text-align: center; color: #666; font-size: 14px; line-height: 1.8;">${bottomContent.content.replace(/\n/g, '<br>')}</div>`
            : bottomContent.content)
        : '';

      // ループ初回時刻の計算
      let firstScheduledAt = post.scheduledAt;
      if (loopEnabled) {
        if (loopTime) {
          // 時刻指定あり: 今日または明日の指定時刻を初回にする
          const [hh, mm] = loopTime.split(':').map(Number);
          const candidate = new Date();
          candidate.setHours(hh, mm, 0, 0);
          if (candidate.getTime() <= Date.now()) {
            candidate.setDate(candidate.getDate() + 1); // 今日の時刻が過去なら明日
          }
          firstScheduledAt = candidate.toISOString();
        } else if (new Date(post.scheduledAt).getTime() <= Date.now()) {
          // 時刻指定なし・元の予約が過去 → 今 + 1インターバル
          firstScheduledAt = new Date(Date.now() + loopIntervalDays * 60 * 1000).toISOString();
        }
      }

      const payload = {
        scheduled_at: firstScheduledAt,
        title: post.title,
        content: post.content,
        meta_description: post.metaDescription,
        image_url: (post.imageUrl && !post.imageUrl.startsWith('data:')) ? post.imageUrl : null,
        image_base64: (post.imageUrl && post.imageUrl.startsWith('data:')) ? post.imageUrl.split(',')[1] : null,
        keywords: post.keywords || [],
        insta_caption: post.instaCaption || null,
        insta_hashtags: typeof post.instaHashtags === 'string' ? post.instaHashtags : (post.instaHashtags as string[] | undefined)?.join(' ') || null,
        threads_caption: post.threadsCaption || null,
        bottom_content_html: bottomHtml || null,
        post_to_wp: hasWp,
        post_to_instagram: hasInsta,
        post_to_instagram_story: hasStory,
        post_to_threads: hasThreads,
        wp_url: wpSite?.url || blogSettings.targetUrl || null,
        wp_username: wpSite?.username || blogSettings.username || null,
        wp_app_password: wpSite?.appPassword || blogSettings.appPassword || null,
        wp_news_slug: wpSite?.newsSlug || blogSettings.newsSlug || 'news',
        wp_category_id: blogSettings.categoryId || null,
        wp_destinations: blogSettings.destinations.filter((d: string) => ['blog', 'news'].includes(d)),
        instagram_account_id: instaAccount?.pageId || blogSettings.instagramBusinessId || null,
        instagram_access_token: instaAccount?.accessToken || blogSettings.instagramAccessToken || null,
        threads_user_id: threadsAccount?.pageId || null,
        threads_access_token: threadsAccount?.accessToken || null,
        loop_enabled: loopEnabled,
        loop_interval_days: loopIntervalDays,
      };

      const res = await fetch('/api/schedule-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setNotification({ message: `「${post.title}」をSupabaseに予約しました！${loopEnabled ? `（${formatLoopInterval(loopIntervalDays)}ごとにループ）` : ''}`, type: 'success' });
      setLoopModal({ post: null, loopEnabled: true, loopIntervalDays: 43200, loopTime: '', saving: false });
      setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'scheduled' } : p));
      if (showSupabasePanel) fetchSupabasePosts();
    } catch (e: any) {
      setNotification({ message: `Supabase保存エラー: ${e.message}`, type: 'error' });
      setLoopModal(prev => ({ ...prev, saving: false }));
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 md:p-12 relative">
      <AnimatePresence>
        {state.status === 'generating' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center space-y-6 bg-black/80 backdrop-blur-md"
          >
            <div className="relative">
              <Loader2 size={48} className="text-gold animate-spin" />
              <div className="absolute inset-0 blur-xl bg-gold/20 animate-pulse" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-gold font-medium tracking-widest text-sm uppercase animate-pulse px-4">
                {state.progressMessage}
              </p>
              <p className="text-black/40 text-[10px]">しばらくお待ちください...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[10000] w-full max-w-md px-4"
          >
            <div className={`p-4 rounded-2xl shadow-2xl flex items-center justify-between border ${
              notification.type === 'success' ? 'bg-emerald-500 border-emerald-400 text-white' :
              notification.type === 'error' ? 'bg-red-500 border-red-400 text-white' :
              'bg-gold border-gold/50 text-black'
            }`}>
              <div className="flex items-center space-x-3">
                {notification.type === 'success' ? <CheckCircle size={18} /> : 
                 notification.type === 'error' ? <AlertCircle size={18} /> : 
                 <Sparkles size={18} />}
                <span className="text-sm font-bold">{notification.message}</span>
              </div>
              <button 
                onClick={() => setNotification(null)}
                className="p-1 hover:bg-white/20 rounded-full transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-gold/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      <main className="w-full max-w-5xl space-y-12">
        {}
        <header className="text-center space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center space-x-2 text-gold tracking-[0.3em] text-xs font-semibold uppercase"
          >
            <Sparkles size={14} />
            <span>Salon SEO Automation Engine</span>
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="serif text-5xl md:text-7xl font-light tracking-tight"
          >
            自動くん
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-black/50 max-w-xl mx-auto text-sm md:text-base font-light leading-relaxed"
          >
            美容サロンの集客とブランド価値を高める、SEO特化型自動投稿エンジン。<br />
            ホットペッパービューティー、自社HP、SNSへの戦略的配信を実現します。
          </motion.p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {}
          <div className="lg:col-span-5 space-y-6">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass rounded-2xl p-6 space-y-6"
            >
              <div className="space-y-6">

                  {/* サロン選択 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-widest text-black/40 flex items-center space-x-2">
                        <Globe size={14} className="text-gold" />
                        <span>サロン選択</span>
                      </label>
                      <button
                        onClick={() => setShowSalonManager(true)}
                        className="text-[10px] text-gold hover:underline flex items-center space-x-1"
                      >
                        <Settings size={10} />
                        <span>サロンを管理</span>
                      </button>
                    </div>
                    <div className="flex space-x-2">
                      <select
                        value={blogSettings.selectedSalonId}
                        onChange={(e) => setBlogSettings({ ...blogSettings, selectedSalonId: e.target.value })}
                        className="flex-1 bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 appearance-none"
                      >
                        <option value="">-- サロンを選択しない --</option>
                        {blogSettings.salonProfiles.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {blogSettings.selectedSalonId && (
                        <button
                          onClick={() => setBlogSettings({ ...blogSettings, selectedSalonId: '' })}
                          className="p-2 text-black/30 hover:text-red-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {blogSettings.selectedSalonId && (() => {
                      const s = blogSettings.salonProfiles.find(p => p.id === blogSettings.selectedSalonId);
                      if (!s) return null;
                      return (
                        <div className="bg-gold/5 border border-gold/20 rounded-xl px-3 py-2 space-y-1">
                          {[s.hpUrl, s.hotpepperUrl, s.instagramUrl, ...s.otherUrls].filter(Boolean).map((url, i) => (
                            <p key={i} className="text-[9px] text-black/40 truncate">🔗 {url}</p>
                          ))}
                          {isFetchingUrls && <p className="text-[9px] text-gold animate-pulse">URL情報を読み込み中...</p>}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-widest text-black/40 flex items-center space-x-2">
                        <Sparkles size={14} />
                        <span>SEO Keywords (優先順位順)</span>
                      </label>
                      <button 
                        onClick={() => setShowPresetManager(true)}
                        className="text-[10px] text-gold hover:underline flex items-center space-x-1"
                      >
                        <Settings size={10} />
                        <span>項目を管理</span>
                      </button>
                    </div>
                    <div className="space-y-2">
                      {blogKeywords.map((keyword, index) => (
                        <div key={index} className="flex items-center space-x-2">
                          <span className="text-[10px] font-bold text-gold w-4">{index + 1}</span>
                          <div className="flex-1 relative group/keyword">
                            <input 
                              type="text"
                              value={keyword}
                              onChange={(e) => {
                                const newKeywords = [...blogKeywords];
                                newKeywords[index] = e.target.value;
                                setBlogKeywords(newKeywords);
                              }}
                              className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 pr-8"
                              placeholder={index === 0 ? "最優先キーワード（例: エステサロン 事務代行）" : `キーワード ${index + 1}`}
                            />
                            <div className="absolute right-0 top-0 h-full flex items-center pr-2">
                              <div className="relative group/dropdown">
                                <button className="text-black/20 hover:text-gold transition-colors">
                                  <ChevronDown size={14} />
                                </button>
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-black/10 rounded-xl shadow-xl opacity-0 invisible group-hover/dropdown:opacity-100 group-hover/dropdown:visible transition-all z-50 py-1 max-h-40 overflow-y-auto">
                                  {policyPresets.keywords.map((preset: string, idx: number) => (
                                    <button
                                      key={idx}
                                      onClick={() => {
                                        const newKeywords = [...blogKeywords];
                                        newKeywords[index] = preset;
                                        setBlogKeywords(newKeywords);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-[10px] text-black/60 hover:bg-gold/5 hover:text-gold transition-colors"
                                    >
                                      {preset}
                                    </button>
                                  ))}
                                  {policyPresets.keywords.length === 0 && (
                                    <div className="px-3 py-2 text-[9px] text-black/30 italic">登録された項目がありません</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-black/30 leading-tight">
                      ※上から順に重要なキーワードを入力してください。上位のキーワードほど記事内での出現頻度が高まります。
                    </p>
                  </div>

                  <div className="pt-4 border-t border-black/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-widest text-black/40 flex items-center space-x-2">
                        <Sparkles size={14} className="text-gold" />
                        <span>一括生成設定</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-black/30 uppercase font-bold">1キーワードあたりの生成数</label>
                        <div className="flex gap-2">
                          {[1, 5, 10, 20].map(count => (
                            <button
                              key={count}
                              onClick={() => setBlogSettings({...blogSettings, articleCount: count})}
                              className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                                blogSettings.articleCount === count
                                  ? 'bg-gold/10 border-gold text-gold'
                                  : 'bg-white border-black/10 text-black/40 hover:border-black/30 hover:text-black/60'
                              }`}
                            >
                              {count}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-[10px] text-black/30 uppercase font-bold">スケジュール間隔</label>
                        <select 
                          value={blogSettings.scheduleStrategy}
                          onChange={(e) => setBlogSettings({...blogSettings, scheduleStrategy: e.target.value as any})}
                          className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                        >
                          <option value="simultaneous">同時（間隔なし）</option>
                          <option value="10mins">10分間隔</option>
                          <option value="1hour">1時間間隔</option>
                          <option value="1day">1日間隔</option>
                          <option value="custom">カスタム (AIに任せる)</option>
                        </select>
                      </div>
                    </div>
                    
                  </div>

                  <div className="pt-4 border-t border-black/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-widest text-black/40 flex items-center space-x-2">
                        <Sparkles size={14} className="text-gold" />
                        <span>記事の執筆方針</span>
                      </label>
                      <button 
                        onClick={() => setShowPresetManager(true)}
                        className="text-[10px] text-gold hover:underline flex items-center space-x-1"
                      >
                        <Settings size={10} />
                        <span>項目を管理</span>
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      {/* 誰に・何を：テキスト入力＋プリセットドロップダウン */}
                      {[
                        { label: '誰に (ターゲット読者)', key: 'toWhom' as const, placeholder: '例: エステサロンのオーナー' },
                        { label: '何を (テーマ・訴求点)', key: 'what' as const, placeholder: '例: スレンジュールの導入メリット' },
                      ].map((field) => (
                        <div key={field.key} className="space-y-1">
                          <label className="text-[10px] text-black/30 uppercase font-bold">{field.label}</label>
                          <div className="relative group">
                            <input
                              type="text"
                              value={(blogSettings as any)[field.key]}
                              onChange={(e) => setBlogSettings({...blogSettings, [field.key]: e.target.value})}
                              className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 pr-8"
                              placeholder={field.placeholder}
                            />
                            <div className="absolute right-0 top-0 h-full flex items-center pr-2">
                              <div className="relative group/dropdown">
                                <button className="text-black/20 hover:text-gold transition-colors">
                                  <ChevronDown size={14} />
                                </button>
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-black/10 rounded-xl shadow-xl opacity-0 invisible group-hover/dropdown:opacity-100 group-hover/dropdown:visible transition-all z-50 py-1 max-h-40 overflow-y-auto">
                                  {policyPresets[field.key].map((preset: string, idx: number) => (
                                    <button
                                      key={idx}
                                      onClick={() => setBlogSettings({...blogSettings, [field.key]: preset})}
                                      className="w-full text-left px-3 py-1.5 text-[10px] text-black/60 hover:bg-gold/5 hover:text-gold transition-colors"
                                    >
                                      {preset}
                                    </button>
                                  ))}
                                  {policyPresets[field.key].length === 0 && (
                                    <div className="px-3 py-2 text-[9px] text-black/30 italic">登録された項目がありません</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* どんなトーンで：固定ドロップダウン */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-black/30 uppercase font-bold">どんなトーンで (文体)</label>
                        <select
                          value={blogSettings.tone}
                          onChange={(e) => setBlogSettings({...blogSettings, tone: e.target.value})}
                          className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 appearance-none"
                        >
                          <option value="専門的・信頼感重視">専門的・信頼感重視</option>
                          <option value="親しみやすく・カジュアル">親しみやすく・カジュアル</option>
                          <option value="比較・データ重視">比較・データ重視</option>
                          <option value="体験談・感情訴求">体験談・感情訴求</option>
                        </select>
                      </div>

                      {/* どうしたい：固定ドロップダウン */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-black/30 uppercase font-bold">どうしたい (目的)</label>
                        <select
                          value={blogSettings.how}
                          onChange={(e) => setBlogSettings({...blogSettings, how: e.target.value})}
                          className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 appearance-none"
                        >
                          <option value="理解してもらう">理解してもらう</option>
                          <option value="購買意欲を高める">購買意欲を高める</option>
                          <option value="問い合わせにつなげる">問い合わせにつなげる</option>
                          <option value="来店予約を促す">来店予約を促す</option>
                          <option value="SNS拡散を狙う">SNS拡散を狙う</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-black/5">
                      <label className="text-xs font-semibold uppercase tracking-widest text-gold flex items-center space-x-2">
                        <Sparkles size={14} />
                        <span>情報ソースの組み合わせ</span>
                      </label>

                      <div className="space-y-4 bg-black/5 p-4 rounded-2xl border border-black/5">
                        {}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-black/40 uppercase font-bold flex items-center space-x-2">
                              <ImageIcon size={12} />
                              <span>1. 参考資料 (PDF/TXT/画像)</span>
                            </label>
                            {blogSettings.sourceFiles.length > 0 && (
                              <button 
                                onClick={() => setBlogSettings(prev => ({...prev, sourceFiles: []}))}
                                className="text-[9px] text-red-500 hover:underline"
                              >
                                全て削除
                              </button>
                            )}
                          </div>
                          
                          <div
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFileUpload(e as any); }}
                            className="relative group"
                          >
                            <label className="block cursor-pointer bg-white border border-black/10 border-dashed rounded-xl p-4 hover:bg-gold/5 hover:border-gold/30 transition-all text-center">
                              <div className="flex flex-col items-center space-y-2">
                                <Plus size={20} className="text-black/20 group-hover:text-gold transition-colors" />
                                <span className="text-[10px] text-black/40 font-bold uppercase tracking-widest">
                                  ファイルをドロップ または クリック
                                </span>
                                <span className="text-[8px] text-black/20">
                                  PDF, TXT, JPG, PNG (複数可)
                                </span>
                              </div>
                              <input
                                type="file"
                                accept=".pdf,.txt,image/*"
                                multiple
                                onChange={handleFileUpload}
                                className="hidden"
                              />
                            </label>
                          </div>

                          {/* アップロード済みファイル一覧 */}
                          {blogSettings.sourceFiles.length > 0 && (
                            <div className="space-y-1 mt-2">
                              {blogSettings.sourceFiles.map((file, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-gold/10 border border-gold/20 rounded-lg px-3 py-1.5">
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${file.extractedText === '解析中...' ? 'bg-yellow-400 animate-pulse' : 'bg-gold'}`} />
                                    <span className="text-[10px] text-black/70 truncate">{file.name}</span>
                                    {file.extractedText === '解析中...' && <span className="text-[9px] text-yellow-500 flex-shrink-0">解析中...</span>}
                                  </div>
                                  <button
                                    onClick={() => setBlogSettings(prev => ({ ...prev, sourceFiles: prev.sourceFiles.filter((_, i) => i !== idx) }))}
                                    className="text-black/30 hover:text-red-500 transition-colors flex-shrink-0 ml-2"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 2. 特定の参考URL */}
                        <div className="space-y-2">
                          <label className="text-[10px] text-black/40 uppercase font-bold flex items-center space-x-2">
                            <Share2 size={12} />
                            <span>2. 特定の参考URL</span>
                          </label>
                          <input 
                            type="text"
                            value={blogSettings.sourceUrl}
                            onChange={(e) => setBlogSettings({...blogSettings, sourceUrl: e.target.value})}
                            className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                            placeholder="https://example.com/article"
                          />
                        </div>

                        {}
                        <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-black/5 shadow-sm">
                          <div className="flex items-center space-x-2">
                            <Play size={12} className="text-gold rotate-90" />
                            <span className="text-[10px] font-bold text-black/60">3. 最新ネット情報を検索</span>
                          </div>
                          <button 
                            onClick={() => setBlogSettings({...blogSettings, useGoogleSearch: !blogSettings.useGoogleSearch})}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${blogSettings.useGoogleSearch ? 'bg-black' : 'bg-black/10'} border border-black/5`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform shadow-sm ${blogSettings.useGoogleSearch ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                        </div>

                        {}
                        <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-black/5 shadow-sm">
                          <div className="flex items-center space-x-2">
                            <Zap size={12} className="text-gold" />
                            <span className="text-[10px] font-bold text-black/60">4. AI検索最適化 (GEO)</span>
                          </div>
                          <button 
                            onClick={() => setBlogSettings({...blogSettings, enableGeoOptimization: !blogSettings.enableGeoOptimization})}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${blogSettings.enableGeoOptimization ? 'bg-black' : 'bg-black/10'} border border-black/5`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform shadow-sm ${blogSettings.enableGeoOptimization ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                        </div>
                        <p className="text-[8px] text-black/40 leading-tight px-1">
                          ※GoogleのAI検索に選ばれやすくするための「構造化データ」を自動で埋め込みます。
                        </p>

                        {}
                        <div className="space-y-3 p-3 bg-gold/5 rounded-xl border border-gold/20">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-gold uppercase font-bold flex items-center space-x-2">
                              <Plus size={12} />
                              <span>5. 共通コンテンツ設定</span>
                            </label>
                            <button 
                              onClick={() => setShowCommonContentManager(!showCommonContentManager)}
                              className="text-[9px] text-gold hover:underline font-bold"
                            >
                              {showCommonContentManager ? '閉じる' : '管理・追加'}
                            </button>
                          </div>

                          <div className="space-y-3">
                            <div className="space-y-1">
                              <label className="text-[9px] text-black/40 font-bold">画像の上 (本文との間)</label>
                              <select 
                                value={blogSettings.selectedAboveImageContentId}
                                onChange={(e) => setBlogSettings({...blogSettings, selectedAboveImageContentId: e.target.value})}
                                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                              >
                                <option value="">なし</option>
                                {blogSettings.commonContents.map(content => (
                                  <option key={content.id} value={content.id}>{content.name}</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-black/40 font-bold">記事の最下部 (WordPress)</label>
                              <select 
                                value={blogSettings.selectedBottomContentId}
                                onChange={(e) => setBlogSettings({...blogSettings, selectedBottomContentId: e.target.value})}
                                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                              >
                                <option value="">なし</option>
                                {blogSettings.commonContents.map(content => (
                                  <option key={content.id} value={content.id}>{content.name}</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-black/40 font-bold">記事の最下部 (Instagram)</label>
                              <select 
                                value={blogSettings.selectedInstaBottomContentId}
                                onChange={(e) => setBlogSettings({...blogSettings, selectedInstaBottomContentId: e.target.value})}
                                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                              >
                                <option value="">なし</option>
                                {blogSettings.commonContents.map(content => (
                                  <option key={content.id} value={content.id}>{content.name}</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[9px] text-black/40 font-bold">記事の最下部 (Threads)</label>
                              <select 
                                value={blogSettings.selectedThreadsBottomContentId}
                                onChange={(e) => setBlogSettings({...blogSettings, selectedThreadsBottomContentId: e.target.value})}
                                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                              >
                                <option value="">なし</option>
                                {blogSettings.commonContents.map(content => (
                                  <option key={content.id} value={content.id}>{content.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <AnimatePresence>
                            {showCommonContentManager && (
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden space-y-3 pt-2 border-t border-gold/10"
                              >
                                <div className="space-y-2">
                                  {blogSettings.commonContents.map((content, idx) => (
                                    <div key={content.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-black/5 shadow-sm group">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] font-bold text-black/70">{content.name}</span>
                                        <span className="text-[8px] text-black/30 uppercase">{content.type === 'code' ? 'HTMLコード' : 'プレーンテキスト'}</span>
                                      </div>
                                      <button 
                                        onClick={() => setBlogSettings(prev => ({...prev, commonContents: prev.commonContents.filter((_, i) => i !== idx)}))}
                                        className="text-black/20 hover:text-red-500 transition-colors p-1"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  ))}
                                </div>

                                <div className="space-y-2 p-2 bg-white rounded-lg border border-gold/20">
                                  <input 
                                    type="text"
                                    id="new-common-name"
                                    placeholder="コンテンツ名 (例: LINE誘導)"
                                    className="w-full bg-black/5 border border-black/10 rounded-md px-2 py-1.5 text-[10px] focus:outline-none"
                                  />
                                  <select 
                                    id="new-common-type"
                                    className="w-full bg-black/5 border border-black/10 rounded-md px-2 py-1.5 text-[10px] focus:outline-none"
                                  >
                                    <option value="code">HTMLコード</option>
                                    <option value="plain">プレーンテキスト</option>
                                  </select>
                                  <textarea 
                                    id="new-common-content"
                                    placeholder="内容を入力..."
                                    className="w-full bg-black/5 border border-black/10 rounded-md px-2 py-1.5 text-[10px] focus:outline-none h-20 resize-none"
                                  />
                                  <button 
                                    onClick={() => {
                                      const nameInput = document.getElementById('new-common-name') as HTMLInputElement;
                                      const typeInput = document.getElementById('new-common-type') as HTMLSelectElement;
                                      const contentInput = document.getElementById('new-common-content') as HTMLTextAreaElement;
                                      
                                      if (nameInput.value && contentInput.value) {
                                        const newContent: CommonContent = {
                                          id: Date.now().toString(),
                                          name: nameInput.value,
                                          type: typeInput.value as 'code' | 'plain',
                                          content: contentInput.value
                                        };
                                        setBlogSettings(prev => ({
                                          ...prev,
                                          commonContents: [...prev.commonContents, newContent],
                                          selectedCommonContentId: newContent.id
                                        }));
                                        nameInput.value = '';
                                        contentInput.value = '';
                                      }
                                    }}
                                    className="w-full py-1.5 bg-gold text-black text-[10px] font-bold rounded-md hover:bg-gold/80 transition-all"
                                  >
                                    新規追加
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] text-black/30 uppercase font-bold">執筆モード</label>
                        <div className="flex p-1 bg-black/5 rounded-xl border border-black/10">
                          <button 
                            onClick={() => setBlogSettings({...blogSettings, sourceStrategy: 'mixed'})}
                            className={`flex-1 py-2 text-[9px] font-bold rounded-lg transition-all ${blogSettings.sourceStrategy === 'mixed' ? 'bg-white text-gold shadow-sm' : 'text-black/40 hover:text-black/60'}`}
                          >
                            ネット情報も活用 (混合)
                          </button>
                          <button 
                            onClick={() => setBlogSettings({...blogSettings, sourceStrategy: 'strict'})}
                            className={`flex-1 py-2 text-[9px] font-bold rounded-lg transition-all ${blogSettings.sourceStrategy === 'strict' ? 'bg-white text-gold shadow-sm' : 'text-black/40 hover:text-black/60'}`}
                          >
                            提供資料 (資料、特定URL) のみ
                          </button>
                        </div>
                        <p className="text-[8px] text-black/40 leading-tight">
                          {blogSettings.sourceStrategy === 'strict' 
                            ? '※提供された資料とURL以外の情報は一切使いません。正確な商品紹介に最適です。' 
                            : '※提供情報をベースに、AIの知識や最新トレンドを交えて深みのある記事を書きます。'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-black/30 uppercase font-bold">詳細な指示 (自由入力)</label>
                      <textarea 
                        value={blogSettings.detailedInstructions}
                        onChange={(e) => setBlogSettings({...blogSettings, detailedInstructions: e.target.value})}
                        className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 h-20 resize-none"
                        placeholder="例: 親しみやすい口調で、専門用語は分かりやすく解説してください。最後にキャンペーン情報を入れてください。"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-black/5 space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-widest text-black/40 flex items-center space-x-2">
                      <ImageIcon size={14} className="text-gold" />
                      <span>画像の生成方針</span>
                    </label>

                    <div className="flex p-1 bg-black/5 rounded-xl border border-black/10">
                      <button 
                        onClick={() => setBlogSettings({...blogSettings, imageMode: 'ai'})}
                        className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${blogSettings.imageMode === 'ai' ? 'bg-white text-gold shadow-sm' : 'text-black/40 hover:text-black/60'}`}
                      >
                        AI生成
                      </button>
                      <button 
                        onClick={() => setBlogSettings({...blogSettings, imageMode: 'upload'})}
                        className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${blogSettings.imageMode === 'upload' ? 'bg-white text-gold shadow-sm' : 'text-black/40 hover:text-black/60'}`}
                      >
                        自前画像
                      </button>
                      <button 
                        onClick={() => setBlogSettings({...blogSettings, imageMode: 'edit'})}
                        className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${blogSettings.imageMode === 'edit' ? 'bg-white text-gold shadow-sm' : 'text-black/40 hover:text-black/60'}`}
                      >
                        自前ベース生成
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-black/30 uppercase font-bold">画像に載せる文字 (バナーテキスト)</label>
                      <input 
                        type="text"
                        value={blogSettings.bannerText}
                        onChange={(e) => setBlogSettings({...blogSettings, bannerText: e.target.value})}
                        className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50"
                        placeholder="例: キャンペーン実施中！"
                      />
                      <p className="text-[9px] text-black/40">※AIによる誤字を防ぐため、アプリ側で文字を合成します。</p>
                    </div>

                    {(blogSettings.imageMode === 'ai' || blogSettings.imageMode === 'edit') && (
                      <div className="space-y-1">
                        <label className="text-[10px] text-black/30 uppercase font-bold">
                          {blogSettings.imageMode === 'edit' ? '画像編集の指示' : '画像生成の指示'}
                        </label>
                        <textarea 
                          value={blogSettings.customImagePrompt}
                          onChange={(e) => setBlogSettings({...blogSettings, customImagePrompt: e.target.value})}
                          className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/80 focus:outline-none focus:border-gold/50 h-16 resize-none"
                          placeholder={blogSettings.imageMode === 'edit' ? "例: 背景を明るくして、人物を笑顔にしてください" : "例: 明るい店内でカウンセリングをしている清潔感のあるシーン..."}
                        />
                      </div>
                    )}

                    {(blogSettings.imageMode === 'upload' || blogSettings.imageMode === 'edit') && (
                      <div className="space-y-2">
                        <label className="text-[10px] text-black/30 uppercase font-bold">使用する画像（複数選択可）</label>
                        <div className="space-y-3">
                          <label className="block cursor-pointer bg-black/5 border border-black/10 border-dashed rounded-lg p-4 hover:bg-black/10 transition-all text-center">
                            <span className="text-[9px] text-black/40 font-bold uppercase tracking-widest">
                              画像を追加
                            </span>
                            <input 
                              type="file" 
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                const files = e.target.files;
                                if (!files) return;
                                Array.from(files).forEach((file: File) => {
                                  const reader = new FileReader();
                                  reader.onload = (ev) => {
                                    if (ev.target?.result) {
                                      setBlogSettings(prev => ({
                                        ...prev,
                                        uploadedImages: [...prev.uploadedImages, ev.target!.result as string]
                                      }));
                                    }
                                  };
                                  reader.readAsDataURL(file);
                                });
                              }}
                            />
                          </label>
                          {blogSettings.uploadedImages.length > 0 && (
                            <div className="grid grid-cols-4 gap-2">
                              {blogSettings.uploadedImages.map((img, i) => (
                                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-black/10 group">
                                  <img src={img} alt={`Uploaded ${i}`} className="w-full h-full object-cover" />
                                  <button
                                    onClick={() => setBlogSettings(prev => ({
                                      ...prev,
                                      uploadedImages: prev.uploadedImages.filter((_, idx) => idx !== i)
                                    }))}
                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Social Info */}
                    {(blogSettings.destinations.includes('instagram') || blogSettings.destinations.includes('threads')) && (
                        <div className="mt-6 space-y-4 p-5 bg-white rounded-2xl border border-black/10 shadow-sm">
                          <div className="flex items-center justify-between border-b border-black/5 pb-3">
                            <div className="flex items-center space-x-2">
                              <div className="w-8 h-8 bg-gold/10 rounded-full flex items-center justify-center text-gold">
                                <Share2 size={16} />
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-black/80">SNSアカウント管理</h4>
                                <p className="text-[9px] text-black/40">InstagramとThreadsの投稿設定</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => setShowAddAccountForm(!showAddAccountForm)}
                              className={`text-[10px] px-3 py-1.5 rounded-lg font-bold transition-all flex items-center space-x-1 ${
                                showAddAccountForm 
                                ? 'bg-black/5 text-black/60 hover:bg-black/10' 
                                : 'bg-gold text-black hover:bg-gold/80 shadow-lg shadow-gold/10'
                              }`}
                            >
                              {showAddAccountForm ? <X size={12} /> : <Plus size={12} />}
                              <span>{showAddAccountForm ? '閉じる' : 'アカウントを追加'}</span>
                            </button>
                          </div>

                          {showAddAccountForm && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="p-4 bg-black/5 rounded-xl space-y-4 overflow-hidden"
                            >
                              <div className="grid grid-cols-2 gap-2">
                                <button 
                                  onClick={() => setNewAccountData({...newAccountData, platform: 'instagram'})}
                                  className={`py-2 rounded-lg text-[10px] font-bold border transition-all flex items-center justify-center space-x-2 ${
                                    newAccountData.platform === 'instagram' 
                                    ? 'bg-pink-500 border-pink-600 text-white shadow-md shadow-pink-500/20' 
                                    : 'bg-white border-black/10 text-black/40 hover:border-black/20'
                                  }`}
                                >
                                  <Instagram size={12} />
                                  <span>Instagram</span>
                                </button>
                                <button 
                                  onClick={() => setNewAccountData({...newAccountData, platform: 'threads'})}
                                  className={`py-2 rounded-lg text-[10px] font-bold border transition-all flex items-center justify-center space-x-2 ${
                                    newAccountData.platform === 'threads' 
                                    ? 'bg-black border-black text-white shadow-md shadow-black/20' 
                                    : 'bg-white border-black/10 text-black/40 hover:border-black/20'
                                  }`}
                                >
                                  <Share2 size={12} />
                                  <span>Threads</span>
                                </button>
                              </div>

                              <div className="space-y-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] text-black/60 font-bold flex items-center justify-between">
                                    <span>アカウント表示名</span>
                                    <span className="text-[8px] text-black/30 font-normal">※管理用の名前です</span>
                                  </label>
                                  <input 
                                    type="text"
                                    placeholder="例: サロン公式Instagram"
                                    value={newAccountData.name}
                                    onChange={(e) => setNewAccountData({...newAccountData, name: e.target.value})}
                                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50"
                                  />
                                </div>
                                
                                <div className="space-y-1">
                                  <label className="text-[9px] text-black/60 font-bold flex items-center justify-between">
                                    <span>{newAccountData.platform === 'instagram' ? 'Instagram ビジネスID' : 'Threads ユーザーID'}</span>
                                    {newAccountData.platform === 'instagram' && (
                                      <button 
                                        onClick={checkInstagramId}
                                        disabled={isCheckingIg}
                                        className="text-[8px] text-gold hover:underline font-bold disabled:opacity-50"
                                      >
                                        {isCheckingIg ? '取得中...' : 'IDを自動取得'}
                                      </button>
                                    )}
                                  </label>
                                  <p className="text-[8px] text-black/40 mb-1 leading-relaxed">
                                    {newAccountData.platform === 'instagram' 
                                      ? 'Meta for Developersのアプリ設定、またはFacebookページの「設定 > リンク済みのアカウント」で確認できる15〜17桁の数字です。' 
                                      : 'Threads APIの設定画面、またはプロフィール設定で確認できるユーザー固有のIDです。'}
                                  </p>
                                  <input 
                                    type="text"
                                    placeholder="IDを入力"
                                    value={newAccountData.pageId}
                                    onChange={(e) => setNewAccountData({...newAccountData, pageId: e.target.value})}
                                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[9px] text-black/60 font-bold flex items-center justify-between">
                                    <span>アクセストークンの種類</span>
                                  </label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <button 
                                      onClick={() => setBlogSettings({...blogSettings, isShortLivedToken: false})}
                                      className={`py-1.5 rounded-lg text-[9px] font-bold border transition-all ${
                                        !blogSettings.isShortLivedToken 
                                        ? 'bg-gold/10 border-gold text-gold' 
                                        : 'bg-white border-black/10 text-black/40'
                                      }`}
                                    >
                                      長期 (60日間)
                                    </button>
                                    <button 
                                      onClick={() => setBlogSettings({...blogSettings, isShortLivedToken: true})}
                                      className={`py-1.5 rounded-lg text-[9px] font-bold border transition-all ${
                                        blogSettings.isShortLivedToken 
                                        ? 'bg-gold/10 border-gold text-gold' 
                                        : 'bg-white border-black/10 text-black/40'
                                      }`}
                                    >
                                      短期 (2時間)
                                    </button>
                                  </div>
                                  <p className="text-[7px] text-black/40 mt-1">
                                    {blogSettings.isShortLivedToken 
                                      ? '※短期トークンの場合、延長のためにアプリIDとSecretが必要です。' 
                                      : '※すでに延長済みのトークンをお持ちの場合はこちらを選択してください。'}
                                  </p>
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[9px] text-black/60 font-bold flex items-center justify-between">
                                    <span>アクセストークン</span>
                                    {newAccountData.platform === 'instagram' && blogSettings.isShortLivedToken && (
                                      <button 
                                        onClick={extendInstagramToken}
                                        disabled={isExtendingToken}
                                        className="text-[8px] text-gold hover:underline font-bold disabled:opacity-50"
                                      >
                                        {isExtendingToken ? '延長中...' : 'トークンを延長(60日)'}
                                      </button>
                                    )}
                                  </label>
                                  <p className="text-[8px] text-black/40 mb-1 leading-relaxed">
                                    Meta for Developersの「グラフAPIエクスプローラ」で発行したトークンを入力してください。
                                  </p>
                                  <input 
                                    type="password"
                                    placeholder="EAA..."
                                    value={newAccountData.accessToken}
                                    onChange={(e) => setNewAccountData({...newAccountData, accessToken: e.target.value})}
                                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50"
                                  />
                                </div>

                                {newAccountData.platform === 'instagram' && blogSettings.isShortLivedToken && (
                                  <div className="space-y-2 pt-1">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <label className="text-[9px] text-black/60 font-bold flex flex-col">
                                          <span>アプリID</span>
                                          <span className="text-[7px] text-black/30 font-normal leading-tight">※必須（延長用）</span>
                                        </label>
                                        <input 
                                          type="text"
                                          placeholder="App ID"
                                          value={blogSettings.instagramAppId}
                                          onChange={(e) => setBlogSettings({...blogSettings, instagramAppId: e.target.value})}
                                          className="w-full bg-white border border-black/10 rounded-lg px-2 py-1.5 text-[10px] focus:outline-none"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[9px] text-black/60 font-bold flex flex-col">
                                          <span>App Secret</span>
                                          <span className="text-[7px] text-black/30 font-normal leading-tight">※必須（延長用）</span>
                                        </label>
                                        <input 
                                          type="password"
                                          placeholder="Secret"
                                          value={blogSettings.instagramAppSecret}
                                          onChange={(e) => setBlogSettings({...blogSettings, instagramAppSecret: e.target.value})}
                                          className="w-full bg-white border border-black/10 rounded-lg px-2 py-1.5 text-[10px] focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    <p className="text-[7px] text-black/30 leading-tight">
                                      ※Meta for Developersの「アプリ設定 &gt; ベーシック」で確認できます。
                                    </p>
                                  </div>
                                )}
                              </div>

                              <button 
                                onClick={() => {
                                  if (!newAccountData.name || !newAccountData.accessToken) {
                                    setNotification({ message: '名前とトークンは必須です', type: 'error' });
                                    return;
                                  }
                                  const newAccount: SocialAccount = {
                                    id: Date.now().toString(),
                                    name: newAccountData.name,
                                    platform: newAccountData.platform,
                                    accessToken: newAccountData.accessToken.trim(),
                                    pageId: newAccountData.platform === 'instagram' ? newAccountData.pageId.trim() : undefined,
                                    userId: newAccountData.platform === 'threads' ? newAccountData.pageId.trim() : undefined,
                                    appId: newAccountData.platform === 'instagram' ? blogSettings.instagramAppId.trim() : undefined,
                                    appSecret: newAccountData.platform === 'instagram' ? blogSettings.instagramAppSecret.trim() : undefined
                                  };
                                  setBlogSettings({
                                    ...blogSettings,
                                    socialAccounts: [...blogSettings.socialAccounts, newAccount]
                                  });
                                  setNewAccountData({ name: '', platform: 'instagram', pageId: '', accessToken: '' });
                                  setShowAddAccountForm(false);
                                }}
                                className="w-full bg-gold text-black py-2.5 rounded-xl text-xs font-bold hover:bg-gold/80 transition-all shadow-lg shadow-gold/20"
                              >
                                アカウントを登録
                              </button>
                            </motion.div>
                          )}

                          <div className="space-y-2">
                            {blogSettings.socialAccounts.length === 0 ? (
                              <div className="text-center py-6 bg-black/5 rounded-xl border border-dashed border-black/10">
                                <p className="text-[10px] text-black/40 italic">
                                  登録済みのアカウントはありません。<br />「アカウントを追加」から設定してください。
                                </p>
                              </div>
                            ) : (
                              blogSettings.socialAccounts.map(account => (
                                <div key={account.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-black/5 shadow-sm hover:border-gold/30 transition-all group">
                                  <div className="flex items-center space-x-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                      account.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-black/10 text-black'
                                    }`}>
                                      {account.platform === 'instagram' ? <Instagram size={18} /> : <Share2 size={18} />}
                                    </div>
                                    <div>
                                      <p className="text-xs font-bold text-black">{account.name}</p>
                                      <div className="flex items-center space-x-2">
                                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest ${
                                          account.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-black/10 text-black'
                                        }`}>
                                          {account.platform}
                                        </span>
                                        <span className="text-[8px] text-black/30 font-mono">ID: {account.pageId || account.userId || '未設定'}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1">
                                    <button 
                                      onClick={() => setEditingAccount(account)}
                                      className="p-2 text-black/10 hover:text-gold hover:bg-gold/5 rounded-lg transition-all"
                                      title="詳細を表示"
                                    >
                                      <Eye size={16} />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setBlogSettings({
                                          ...blogSettings,
                                          socialAccounts: blogSettings.socialAccounts.filter(a => a.id !== account.id)
                                        });
                                        setNotification({ message: `${account.name}を削除しました。`, type: 'success' });
                                      }}
                                      className="p-2 text-black/10 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          {}
                          <AnimatePresence>
                            {editingAccount && (
                              <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                              >
                                <motion.div 
                                  initial={{ scale: 0.9, y: 20 }}
                                  animate={{ scale: 1, y: 0 }}
                                  exit={{ scale: 0.9, y: 20 }}
                                  className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
                                >
                                  <div className="p-6 border-b border-black/5 flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                        editingAccount.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-black/10 text-black'
                                      }`}>
                                        {editingAccount.platform === 'instagram' ? <Instagram size={20} /> : <Share2 size={20} />}
                                      </div>
                                      <div>
                                        <h3 className="text-sm font-bold text-black">アカウント詳細</h3>
                                        <p className="text-[10px] text-black/40 uppercase tracking-widest font-bold">{editingAccount.platform}</p>
                                      </div>
                                    </div>
                                    <button 
                                      onClick={() => setEditingAccount(null)}
                                      className="p-2 hover:bg-black/5 rounded-full transition-colors"
                                    >
                                      <X size={20} />
                                    </button>
                                  </div>

                                  <div className="p-6 space-y-4">
                                    <div className="space-y-1">
                                      <label className="text-[10px] text-black/40 font-bold uppercase">アカウント名</label>
                                      <input 
                                        type="text"
                                        value={editingAccount.name}
                                        onChange={(e) => setEditingAccount({...editingAccount, name: e.target.value})}
                                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-gold/50"
                                      />
                                    </div>

                                    <div className="space-y-1">
                                      <label className="text-[10px] text-black/40 font-bold uppercase">
                                        {editingAccount.platform === 'instagram' ? 'Instagram ビジネスID' : 'Threads ユーザーID'}
                                      </label>
                                      <input 
                                        type="text"
                                        value={editingAccount.pageId || editingAccount.userId || ''}
                                        onChange={(e) => {
                                          if (editingAccount.platform === 'instagram') {
                                            setEditingAccount({...editingAccount, pageId: e.target.value});
                                          } else {
                                            setEditingAccount({...editingAccount, userId: e.target.value});
                                          }
                                        }}
                                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-gold/50"
                                      />
                                    </div>

                                    <div className="space-y-1">
                                      <label className="text-[10px] text-black/40 font-bold uppercase">アクセストークン</label>
                                      <div className="relative">
                                        <input 
                                          type="password"
                                          value={editingAccount.accessToken}
                                          onChange={(e) => setEditingAccount({...editingAccount, accessToken: e.target.value})}
                                          className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-gold/50 pr-10"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-black/20">
                                          <Zap size={14} />
                                        </div>
                                      </div>
                                    </div>

                                    {editingAccount.platform === 'instagram' && (
                                      <div className="space-y-2">
                                        <div className="grid grid-cols-2 gap-3">
                                          <div className="space-y-1">
                                            <label className="text-[10px] text-black/40 font-bold uppercase flex flex-col">
                                              <span>アプリID</span>
                                              <span className="text-[7px] lowercase font-normal">※60日延長機能を使う場合のみ必要</span>
                                            </label>
                                            <input 
                                              type="text"
                                              value={editingAccount.appId || ''}
                                              onChange={(e) => setEditingAccount({...editingAccount, appId: e.target.value})}
                                              className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-gold/50"
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <label className="text-[10px] text-black/40 font-bold uppercase flex flex-col">
                                              <span>App Secret</span>
                                              <span className="text-[7px] lowercase font-normal">※60日延長機能を使う場合のみ必要</span>
                                            </label>
                                            <input 
                                              type="password"
                                              value={editingAccount.appSecret || ''}
                                              onChange={(e) => setEditingAccount({...editingAccount, appSecret: e.target.value})}
                                              className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-gold/50"
                                            />
                                          </div>
                                        </div>
                                        <p className="text-[8px] text-black/30 leading-tight">
                                          ※Meta for Developersの「アプリ設定 &gt; ベーシック」で確認できます。
                                        </p>
                                        
                                        <button
                                          onClick={async () => {
                                            if (!editingAccount.appId || !editingAccount.appSecret || !editingAccount.accessToken) {
                                              setNotification({ message: 'アプリID、App Secret、現在のアクセストークンを入力してください', type: 'error' });
                                              return;
                                            }
                                            setState({ status: 'generating', progressMessage: 'トークンを延長中...' });
                                            try {
                                              const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${editingAccount.appId}&client_secret=${editingAccount.appSecret}&fb_exchange_token=${editingAccount.accessToken}`);
                                              const data = await res.json();
                                              if (data.access_token) {
                                                setEditingAccount({...editingAccount, accessToken: data.access_token});
                                                setNotification({ message: '60日用のロングトークンに更新しました！設定を保存してください。', type: 'success' });
                                              } else {
                                                throw new Error(data.error?.message || 'トークンの延長に失敗しました');
                                              }
                                            } catch (e: any) {
                                              setNotification({ message: e.message || 'エラーが発生しました', type: 'error' });
                                            } finally {
                                              setState({ status: 'idle' });
                                            }
                                          }}
                                          className="w-full mt-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold text-[10px] py-2 rounded-xl flex items-center justify-center space-x-2 opacity-90 hover:opacity-100 transition-opacity"
                                        >
                                          <Zap size={12} />
                                          <span>アクセストークンを60日延長する</span>
                                        </button>
                                      </div>
                                    )}

                                    <div className="pt-4 flex gap-3">
                                      <button 
                                        onClick={() => setEditingAccount(null)}
                                        className="flex-1 px-4 py-3 rounded-xl text-xs font-bold text-black/60 bg-black/5 hover:bg-black/10 transition-all"
                                      >
                                        キャンセル
                                      </button>
                                      <button 
                                        onClick={() => {
                                          const trimmedAccount = {
                                            ...editingAccount,
                                            name: editingAccount.name.trim(),
                                            pageId: editingAccount.pageId?.trim(),
                                            userId: editingAccount.userId?.trim(),
                                            accessToken: editingAccount.accessToken?.trim(),
                                            appId: editingAccount.appId?.trim(),
                                            appSecret: editingAccount.appSecret?.trim()
                                          };
                                          setBlogSettings({
                                            ...blogSettings,
                                            socialAccounts: blogSettings.socialAccounts.map(a => 
                                              a.id === editingAccount.id ? trimmedAccount : a
                                            )
                                          });
                                          setEditingAccount(null);
                                          setNotification({ message: 'アカウント情報を更新しました', type: 'success' });
                                        }}
                                        className="flex-2 bg-gold text-black px-8 py-3 rounded-xl text-xs font-bold hover:bg-gold/80 transition-all shadow-lg shadow-gold/20"
                                      >
                                        変更を保存
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                      </div>

                      {blogSettings.destinations.includes('news') && (
                          <div className="mt-2 p-3 bg-emerald-50 border border-emerald-100 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-emerald-800 font-bold uppercase tracking-widest">
                                お知らせのスラッグ設定
                              </label>
                              <button 
                                onClick={scanPostTypes}
                                disabled={isScanningTypes || !blogSettings.username || !blogSettings.appPassword}
                                className="text-[9px] text-emerald-600 hover:underline flex items-center space-x-1"
                              >
                                {isScanningTypes ? <Loader2 size={8} className="animate-spin" /> : <Sparkles size={8} />}
                                <span>投稿タイプをスキャン</span>
                              </button>
                            </div>
                            <input 
                              type="text"
                              value={blogSettings.newsSlug}
                              onChange={(e) => {
                                const newSlug = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
                                setBlogSettings({...blogSettings, newsSlug: newSlug, postTypes: [newSlug]});
                              }}
                              className="w-full bg-white border border-emerald-200 rounded px-2 py-1 text-xs text-emerald-900 focus:outline-none focus:border-emerald-400"
                              placeholder="例: news, info, topics"
                            />
                            {availablePostTypes.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {availablePostTypes.map(t => (
                                  <button
                                    key={t.slug}
                                    onClick={() => setBlogSettings({...blogSettings, newsSlug: t.slug, postTypes: [t.slug]})}
                                    className={`text-[8px] px-1.5 py-0.5 rounded border transition-all ${
                                      blogSettings.newsSlug === t.slug 
                                      ? 'bg-emerald-500 text-white border-emerald-600' 
                                      : 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                                    }`}
                                  >
                                    {t.name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <p className="text-[8px] text-emerald-700/60 leading-tight">
                              ※WordPress側で設定されている「投稿タイプのスラッグ」を入力してください。
                            </p>
                          </div>
                      )}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] text-black/40 font-bold uppercase tracking-widest">
                          投稿先の選択
                        </label>

                        {/* 3カラム: HP / Instagram / Threads */}
                        <div className="grid grid-cols-3 gap-2">

                          {/* HP カラム */}
                          <div className="rounded-xl border border-black/10 overflow-hidden">
                            <div className="flex items-center space-x-1.5 px-3 py-2 bg-black/5">
                              <Globe size={12} className="text-black/40" />
                              <span className="text-[10px] font-bold text-black/50 uppercase tracking-widest">HP</span>
                            </div>

                            {/* サイト一覧（アコーディオン） */}
                            <div className="divide-y divide-black/5">
                              {blogSettings.wpSites.map(site => {
                                const isExpanded = expandedWpSiteId === site.id;
                                const isActive = blogSettings.selectedWpSiteId === site.id;
                                return (
                                  <div key={site.id}>
                                    {/* サイト名ヘッダー */}
                                    <button
                                      onClick={() => {
                                        const next = isExpanded ? '' : site.id;
                                        setExpandedWpSiteId(next);
                                        if (!isExpanded) {
                                          setBlogSettings({
                                            ...blogSettings,
                                            selectedWpSiteId: site.id,
                                            targetUrl: site.url,
                                            username: site.username,
                                            appPassword: site.appPassword,
                                            newsSlug: site.newsSlug || 'news'
                                          });
                                        }
                                      }}
                                      className={`w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold transition-all ${
                                        isActive ? 'text-gold' : 'text-black/50 hover:text-black/70'
                                      }`}
                                    >
                                      <span className="truncate">{site.name}</span>
                                      <ChevronDown size={10} className={`flex-shrink-0 ml-1 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>

                                    {/* 展開時：投稿種別チェック */}
                                    {isExpanded && (
                                      <div className="px-3 pb-3 space-y-1.5 bg-gold/3">
                                        {[
                                          { id: 'blog', label: 'WP 投稿' },
                                          { id: 'news', label: 'WP お知らせ' },
                                        ].map(dest => {
                                          const isSelected = blogSettings.destinations.includes(dest.id);
                                          return (
                                            <button
                                              key={dest.id}
                                              onClick={() => {
                                                const newDest = isSelected
                                                  ? blogSettings.destinations.filter(d => d !== dest.id)
                                                  : [...blogSettings.destinations, dest.id];
                                                setBlogSettings({ ...blogSettings, destinations: newDest });
                                              }}
                                              className={`w-full flex items-center space-x-2 px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                                                isSelected
                                                  ? 'bg-gold/10 border-gold/40 text-gold'
                                                  : 'bg-white border-black/10 text-black/40 hover:bg-black/5'
                                              }`}
                                            >
                                              <div className={`w-3 h-3 rounded flex items-center justify-center flex-shrink-0 border ${isSelected ? 'bg-gold border-gold' : 'border-black/20 bg-white'}`}>
                                                {isSelected && <span className="text-white text-[7px] font-black">✓</span>}
                                              </div>
                                              <span>{dest.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* サイトを追加ボタン */}
                            <button
                              onClick={() => setShowAddWpSiteForm(true)}
                              className="w-full flex items-center justify-center space-x-1 py-2 text-[9px] text-black/30 hover:text-gold transition-colors border-t border-black/5"
                            >
                              <Plus size={9} />
                              <span>サイトを追加</span>
                            </button>
                          </div>

                          {/* Instagram カラム */}
                          {(() => {
                            const isSelected = blogSettings.destinations.includes('instagram');
                            return (
                              <button
                                onClick={() => {
                                  const newDest = isSelected
                                    ? blogSettings.destinations.filter(d => d !== 'instagram')
                                    : [...blogSettings.destinations, 'instagram'];
                                  setBlogSettings({ ...blogSettings, destinations: newDest });
                                }}
                                className={`rounded-xl border flex flex-col items-center justify-center py-4 space-y-2 transition-all ${
                                  isSelected
                                    ? 'bg-gold/10 border-gold/40 text-gold'
                                    : 'bg-black/5 border-black/10 text-black/40 hover:bg-black/10'
                                }`}
                              >
                                <Instagram size={18} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Instagram</span>
                                <div className={`w-4 h-4 rounded flex items-center justify-center border ${isSelected ? 'bg-gold border-gold' : 'border-black/20 bg-white'}`}>
                                  {isSelected && <span className="text-white text-[8px] font-black">✓</span>}
                                </div>
                              </button>
                            );
                          })()}

                          {/* Instagram ストーリーズ カラム */}
                          {(() => {
                            const isSelected = blogSettings.destinations.includes('instagram_story');
                            return (
                              <button
                                onClick={() => {
                                  const newDest = isSelected
                                    ? blogSettings.destinations.filter(d => d !== 'instagram_story')
                                    : [...blogSettings.destinations, 'instagram_story'];
                                  setBlogSettings({ ...blogSettings, destinations: newDest });
                                }}
                                className={`rounded-xl border flex flex-col items-center justify-center py-4 space-y-2 transition-all ${
                                  isSelected
                                    ? 'bg-pink-500/10 border-pink-400/40 text-pink-500'
                                    : 'bg-black/5 border-black/10 text-black/40 hover:bg-black/10'
                                }`}
                              >
                                <Instagram size={18} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Story</span>
                                <div className={`w-4 h-4 rounded flex items-center justify-center border ${isSelected ? 'bg-pink-500 border-pink-500' : 'border-black/20 bg-white'}`}>
                                  {isSelected && <span className="text-white text-[8px] font-black">✓</span>}
                                </div>
                              </button>
                            );
                          })()}

                          {/* Threads カラム */}
                          {(() => {
                            const isSelected = blogSettings.destinations.includes('threads');
                            return (
                              <button
                                onClick={() => {
                                  const newDest = isSelected
                                    ? blogSettings.destinations.filter(d => d !== 'threads')
                                    : [...blogSettings.destinations, 'threads'];
                                  setBlogSettings({ ...blogSettings, destinations: newDest });
                                }}
                                className={`rounded-xl border flex flex-col items-center justify-center py-4 space-y-2 transition-all ${
                                  isSelected
                                    ? 'bg-gold/10 border-gold/40 text-gold'
                                    : 'bg-black/5 border-black/10 text-black/40 hover:bg-black/10'
                                }`}
                              >
                                <Share2 size={18} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Threads</span>
                                <div className={`w-4 h-4 rounded flex items-center justify-center border ${isSelected ? 'bg-gold border-gold' : 'border-black/20 bg-white'}`}>
                                  {isSelected && <span className="text-white text-[8px] font-black">✓</span>}
                                </div>
                              </button>
                            );
                          })()}

                        </div>
                      </div>

                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/40 pt-4 border-t border-black/5">
                        WordPress 接続設定
                        {blogSettings.wpSites.find(s => s.id === blogSettings.selectedWpSiteId) && (
                          <span className="ml-2 normal-case text-gold font-normal">
                            — {blogSettings.wpSites.find(s => s.id === blogSettings.selectedWpSiteId)?.name}
                          </span>
                        )}
                      </h4>
                      <div className="space-y-1">
                        <label className="text-[10px] text-black/30 uppercase font-bold">WordPress サイトURL</label>
                          <p className="text-[9px] text-black/40 mb-1">WordPressのサイトURLを入力してください（例: https://do-date.com/web/）</p>
                          <input
                            type="text"
                            value={blogSettings.targetUrl}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBlogSettings({
                                ...blogSettings,
                                targetUrl: val,
                                wpSites: blogSettings.wpSites.map(s =>
                                  s.id === blogSettings.selectedWpSiteId ? { ...s, url: val } : s
                                )
                              });
                            }}
                            className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/60 focus:outline-none"
                            placeholder="https://example.com/"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] text-black/30 uppercase font-bold">ユーザー名</label>
                            <p className="text-[9px] text-black/40 mb-1">WPログイン時のユーザー名</p>
                            <input
                              type="text"
                              value={blogSettings.username}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBlogSettings({
                                  ...blogSettings,
                                  username: val,
                                  wpSites: blogSettings.wpSites.map(s =>
                                    s.id === blogSettings.selectedWpSiteId ? { ...s, username: val } : s
                                  )
                                });
                              }}
                              className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/60 focus:outline-none"
                              placeholder="admin"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-black/30 uppercase font-bold">アプリパスワード</label>
                            <p className="text-[9px] text-black/40 mb-1">WP管理画面で発行したパスワード</p>
                            <input
                              type="password"
                              value={blogSettings.appPassword}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBlogSettings({
                                  ...blogSettings,
                                  appPassword: val,
                                  wpSites: blogSettings.wpSites.map(s =>
                                    s.id === blogSettings.selectedWpSiteId ? { ...s, appPassword: val } : s
                                  )
                                });
                              }}
                              className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/60 focus:outline-none"
                              placeholder="xxxx xxxx xxxx xxxx"
                            />
                          </div>
                        </div>
                        
                        <div className="space-y-1">
                          <label className="text-[10px] text-black/30 uppercase font-bold flex items-center justify-between">
                            <span>投稿カテゴリー</span>
                            <button 
                              onClick={fetchWordPressCategories}
                              disabled={isFetchingCategories || !blogSettings.username || !blogSettings.appPassword}
                              className="text-[9px] text-gold hover:underline flex items-center space-x-1"
                            >
                              {isFetchingCategories ? <Loader2 size={8} className="animate-spin" /> : <Play size={8} className="rotate-90" />}
                              <span>一覧を更新</span>
                            </button>
                          </label>
                          <p className="text-[9px] text-black/40 mb-1">
                            投稿先のカテゴリーを選択、またはIDを直接入力してください
                          </p>
                          
                          <div className="flex space-x-2">
                            <div className="relative flex-1">
                              <select 
                                value={blogSettings.categoryId}
                                onChange={(e) => setBlogSettings({...blogSettings, categoryId: e.target.value})}
                                className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs text-black/60 focus:outline-none appearance-none cursor-pointer pr-8"
                              >
                                <option value="">未選択（デフォルト）</option>
                                {wpCategories.map(cat => (
                                  <option key={cat.id} value={cat.id.toString()}>
                                    {cat.name} (ID: {cat.id})
                                  </option>
                                ))}
                              </select>
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-black/20">
                                <Play size={10} className="rotate-90" />
                              </div>
                            </div>
                            <div className="w-20">
                              <input 
                                type="text"
                                value={blogSettings.categoryId}
                                onChange={(e) => setBlogSettings({...blogSettings, categoryId: e.target.value.replace(/[^0-9]/g, '')})}
                                className="w-full bg-black/5 border border-black/10 rounded-lg px-2 py-2 text-xs text-black/60 focus:outline-none"
                                placeholder="ID入力"
                              />
                            </div>
                          </div>

                          {wpCategories.length === 0 && !isFetchingCategories && blogSettings.username && (
                            <p className="text-[8px] text-amber-600 mt-1">
                              ※「一覧を更新」をクリックしてカテゴリーを取得してください
                            </p>
                          )}
                        </div>

                        <div className="pt-6 border-t border-black/10 space-y-4">
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-gold flex items-center space-x-2">
                            <Sparkles size={12} />
                            <span>生成オプション（高度な設定）</span>
                          </h4>
                          
                          <p className="text-[9px] text-black/40 italic">
                            ※執筆方針や画像生成方針は、上部のメイン設定パネルで調整可能です。
                          </p>

                          <div className="space-y-2 pt-2">
                            <label className="text-[10px] text-black/30 uppercase font-bold tracking-widest">使用するAIモデル</label>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setBlogSettings({...blogSettings, modelSelection: 'pro'})}
                                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                  blogSettings.modelSelection === 'pro' 
                                  ? 'bg-gold/20 border-gold text-gold' 
                                  : 'bg-black/5 border-black/10 text-black/40 hover:border-black/20'
                                }`}
                              >
                                Gemini 3.1 Pro (高精度)
                              </button>
                              <button 
                                onClick={() => setBlogSettings({...blogSettings, modelSelection: 'flash'})}
                                className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all border ${
                                  blogSettings.modelSelection === 'flash' 
                                  ? 'bg-gold/20 border-gold text-gold' 
                                  : 'bg-black/5 border-black/10 text-black/40 hover:border-black/20'
                                }`}
                              >
                                Gemini 3 Flash (高速)
                              </button>
                            </div>
                            <p className="text-[8px] text-black/30 leading-tight">
                              ※Proは品質が高いですが、無料枠では制限がかかりやすいため、大量生成時はFlashがおすすめです。
                            </p>
                          </div>
                        </div>
                      </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gold flex items-center space-x-2">
                        <CheckCircle size={12} />
                        <span>接続ガイド</span>
                      </label>
                      <div className="bg-gold/5 border border-gold/10 rounded-xl p-4 space-y-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-5 h-5 bg-gold/20 rounded-full flex items-center justify-center text-gold shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold">1</span>
                          </div>
                          <p className="text-[10px] text-black/60 leading-relaxed">
                            <strong>ユーザー名:</strong> WordPressログイン時のID（admin等）を入力してください。
                          </p>
                        </div>
                        <div className="flex items-start space-x-3">
                          <div className="w-5 h-5 bg-gold/20 rounded-full flex items-center justify-center text-gold shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold">2</span>
                          </div>
                          <p className="text-[10px] text-black/60 leading-relaxed">
                            <strong>アプリパスワード:</strong> WP管理画面の「ユーザー &gt; プロフィール」下部で発行した24文字のコードを入力してください。
                          </p>
                        </div>
                        <div className="flex items-start space-x-3">
                          <div className="w-5 h-5 bg-gold/20 rounded-full flex items-center justify-center text-gold shrink-0 mt-0.5">
                            <span className="text-[10px] font-bold">3</span>
                          </div>
                          <p className="text-[10px] text-black/60 leading-relaxed">
                            <strong>サーバー制限:</strong> エックスサーバー等の「REST API制限」がONだと接続できません。必ずOFFに設定してください。
                          </p>
                        </div>
                      </div>
                    </div>

                      <button 
                        onClick={testWordPressConnection}
                        disabled={isTestingConnection}
                        className={`w-full py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all flex items-center justify-center space-x-2 ${
                          isTestingConnection 
                            ? 'bg-black/5 border-black/10 text-black/30 cursor-not-allowed' 
                            : 'bg-gold/10 border-gold/30 text-gold hover:bg-gold/20'
                        }`}
                      >
                        {isTestingConnection ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <CheckCircle size={14} />
                        )}
                        <span>接続テストを実行</span>
                      </button>

                      {connectionTestResult && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`p-4 rounded-xl text-[10px] leading-relaxed border ${
                            connectionTestResult.success 
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                              : 'bg-red-500/10 border-red-500/20 text-red-400'
                          }`}
                        >
                          <div className="font-bold mb-2 flex items-center space-x-2">
                            {connectionTestResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                            <span>{connectionTestResult.success ? '接続成功' : '接続エラーが発生しました'}</span>
                          </div>
                          <div className="whitespace-pre-wrap mb-2">{connectionTestResult.message}</div>
                          
                          {!connectionTestResult.success && (
                            <div className="mt-3 pt-3 border-t border-red-500/10 space-y-2">
                              <p className="font-bold text-red-300">よくある原因と対策:</p>
                              <ul className="list-disc list-inside space-y-1 opacity-80">
                                <li><strong>ユーザー名:</strong> ログイン用のID（admin等）ですか？</li>
                                <li><strong>パスワード:</strong> 24文字の英数字コードですか？</li>
                                <li><strong>パーマリンク:</strong> 「基本」以外に設定されていますか？</li>
                                <li><strong>セキュリティ:</strong> エックスサーバー等の「REST API制限」をOFFにしましたか？</li>
                              </ul>
                            </div>
                          )}
                        </motion.div>
                      )}

                      <button
                        onClick={generateBatchPosts}
                        disabled={state.status === 'generating'}
                        className={`w-full py-4 rounded-xl font-bold text-sm tracking-wide transition-all shadow-lg flex items-center justify-center space-x-2 ${
                          state.status === 'generating'
                            ? 'bg-black/10 text-black/40 cursor-not-allowed'
                            : 'bg-gold text-black shadow-gold/20 hover:bg-gold/80 hover:scale-[1.01]'
                        }`}
                      >
                        {state.status === 'generating' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        <span>{state.status === 'generating' ? '記事を生成中...' : 'AIで一括生成を開始'}</span>
                      </button>

                      <button
                        onClick={generateEmptyBatchPosts}
                        className="w-full py-3 rounded-xl font-bold text-xs tracking-wide transition-all border border-black/10 bg-white hover:bg-black/5 flex items-center justify-center space-x-2 text-black/50"
                      >
                        <Plus size={14} />
                        <span>空箱を作成（手動記入用）</span>
                      </button>

                      <p className="text-[9px] text-black/30 leading-tight bg-black/5 p-2 rounded border border-black/10">
                        <span className="text-amber-600 font-bold">【重要：投稿先について】</span><br />
                        ・<span className="font-bold">お知らせ（news）</span>：WordPress側に「news」というスラッグのカスタム投稿タイプが作成されている必要があります。無い場合はエラーになります。<br />
                        ・<span className="font-bold">標準投稿（posts）</span>：通常のブログ記事として投稿されます。特定のカテゴリー（例：お知らせカテゴリー）に入れたい場合は、下の「Category ID」を指定してください。<br />
                        ・<span className="font-bold">URLについて</span>：お客様の環境は <code className="text-black">https://do-date.com/web/</code> のようです。URL欄に <code className="text-black">/web/</code> が含まれているか確認してください。
                      </p>
                      <p className="text-[9px] text-black/20 leading-tight">
                        ※WordPressの「ユーザー → プロフィール」からアプリケーションパスワードを発行してください。
                      </p>
                    </div>
              </motion.div>

            <div className="bg-gold/5 border border-gold/20 rounded-xl p-4">
              <p className="text-[10px] text-gold/80 uppercase tracking-widest font-bold mb-1">AI Engine Active</p>
              <p className="text-[11px] text-black/40 leading-relaxed">
                Gemini 3.1 Proを使用しています。サロンのSEOに特化した高品質な記事を自動生成します。
              </p>
            </div>
          </div>

          {}
          <div className="lg:col-span-7 flex flex-col space-y-6">
                {/* Posts List */}
                <div className="glass rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-gold text-xs font-bold uppercase tracking-widest flex items-center space-x-2">
                      <Sparkles size={14} />
                      <span>生成された記事一覧</span>
                    </h3>
                    <div className="flex items-center space-x-3">
                      {blogPosts.length > 0 && (
                        <button
                          onClick={exportPostsAsCsv}
                          className="px-3 py-1.5 bg-black/5 border border-black/10 rounded-lg text-[10px] text-black/50 hover:text-gold hover:border-gold/30 transition-all flex items-center space-x-1"
                          title="CSV出力（ホットペッパー転記用）"
                        >
                          <FileText size={10} />
                          <span>CSV出力</span>
                        </button>
                      )}
                      {blogPosts.length > 0 && (
                        <button
                          onClick={() => {
                            setBlogPosts([]);
                            localStorage.removeItem('blog_posts_history');
                            setNotification({ message: "履歴をすべて削除しました。", type: 'success' });
                          }}
                          className="p-2 text-black/20 hover:text-red-500 transition-colors"
                          title="履歴をクリア"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      {blogPosts.length > 0 && blogPosts.some(p => p.status === 'draft') && (
                        <div className="flex space-x-2 relative z-[999999]">
                        <button 
                          type="button"
                          onClick={() => bulkPostToBlog(true)}
                          className="px-4 py-2 bg-emerald-500 text-white text-[11px] font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/30 flex items-center space-x-2 cursor-pointer active:scale-95 border-none"
                        >
                          <Play size={12} />
                          <span>今すぐ一括投稿</span>
                        </button>
                        <button 
                          type="button"
                          onClick={() => bulkPostToBlog(false)}
                          className="px-4 py-2 bg-gold text-black text-[11px] font-bold rounded-xl hover:bg-gold/80 transition-all shadow-lg shadow-gold/30 flex items-center space-x-2 cursor-pointer active:scale-95 border-none"
                        >
                          <Calendar size={12} />
                          <span>一括予約投稿</span>
                        </button>
                      </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                    {state.status === 'generating' && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center space-x-3"
                      >
                        <Loader2 size={16} className="text-emerald-500 animate-spin" />
                        <span className="text-xs text-emerald-500 font-bold uppercase tracking-widest">{state.progressMessage}</span>
                      </motion.div>
                    )}
                    {blogPosts.length === 0 ? (
                      <div className="text-center py-12 text-black/20">
                        <p className="text-sm">記事がまだ生成されていません。</p>
                        <p className="text-[10px] mt-1">キーワードを入力して生成を開始してください。</p>
                      </div>
                    ) : (
                      blogPosts.map((post) => (
                        <motion.div 
                          key={post.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-black/5 border border-black/10 rounded-xl p-4 space-y-4"
                        >
                          <div className="flex gap-4">
                            {post.imageUrl && (
                              <div className="relative group/img flex-shrink-0">
                                <img src={post.imageUrl} className="w-24 h-24 lg:w-32 lg:h-32 object-cover rounded-lg" alt="" />
                                <button 
                                  onClick={() => downloadImage(post.imageUrl!, `blog-image-${post.id}.png`)}
                                  className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center rounded-lg text-white"
                                  title="画像をダウンロード"
                                >
                                  <ImageIcon size={20} />
                                </button>
                              </div>
                            )}
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center space-x-2">
                                <h4 className="text-sm font-bold text-black/90 truncate">{post.title}</h4>
                                {post.instaCaption && (
                                  <span className="text-[8px] bg-gold/20 text-gold px-1.5 py-0.5 rounded-md font-bold uppercase tracking-tighter">Insta Ready</span>
                                )}
                              </div>
                              
                              <div className="grid grid-cols-2 gap-4 mt-2">
                                {/* 左側: SNS Preview */}
                                <div className="flex flex-col h-full">
                                  {(post.instaCaption || post.threadsCaption) ? (
                                    <div className="p-3 bg-gold/5 border border-gold/10 rounded-xl group/insta relative flex-1 h-48 overflow-y-auto custom-scrollbar">
                                      <div className="flex items-center justify-between mb-2">
                                        <p className="text-[9px] text-gold font-bold uppercase tracking-widest flex items-center space-x-1">
                                          <Share2 size={10} />
                                          <span>SNS Preview</span>
                                        </p>
                                        <div className="flex items-center space-x-2">
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              downloadImage(post.imageUrl!, `social-image-${post.id}.png`);
                                            }}
                                            className="text-[8px] text-gold hover:underline font-bold opacity-0 group-hover/insta:opacity-100 transition-opacity flex items-center space-x-1"
                                          >
                                            <ImageIcon size={8} />
                                            <span>保存</span>
                                          </button>
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const text = post.threadsCaption || post.instaCaption || '';
                                              navigator.clipboard.writeText(text);
                                              setNotification({ message: 'SNS用文章をコピーしました！', type: 'success' });
                                            }}
                                            className="text-[8px] text-gold hover:underline font-bold opacity-0 group-hover/insta:opacity-100 transition-opacity"
                                          >
                                            コピー
                                          </button>
                                        </div>
                                      </div>
                                      <div className="space-y-2">
                                        {post.instaCaption && (
                                          <div className="space-y-1">
                                            <p className="text-[7px] text-pink-500 font-bold uppercase tracking-tighter">Instagram</p>
                                            <p className="text-[9px] text-black/60 leading-relaxed whitespace-pre-wrap">{post.instaCaption}</p>
                                          </div>
                                        )}
                                        {post.threadsCaption && (
                                          <div className="space-y-1">
                                            <p className="text-[7px] text-black font-bold uppercase tracking-tighter">Threads</p>
                                            <p className="text-[9px] text-black/60 leading-relaxed whitespace-pre-wrap">{post.threadsCaption}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        generateInstaForPost(post.id);
                                      }}
                                      disabled={state.status === 'generating'}
                                      className="text-[9px] text-gold/60 hover:text-gold flex items-center space-x-1 border border-gold/20 rounded-lg px-2 py-3 hover:bg-gold/5 transition-all w-full justify-center h-48"
                                    >
                                      <Sparkles size={10} />
                                      <span>SNS用文章を生成する</span>
                                    </button>
                                  )}
                                </div>
                                
                                {/* 右側: 記事プレビュー */}
                                <div className="p-3 bg-white border border-black/5 rounded-xl h-48 overflow-y-auto custom-scrollbar flex flex-col">
                                  <div className="text-[8px] uppercase tracking-widest font-bold text-black/30 mb-2 border-b border-black/5 pb-1 flex items-center space-x-1 flex-shrink-0">
                                    <FileText size={10} />
                                    <span>記事プレビュー</span>
                                  </div>
                                  <div 
                                    className="text-[10px] text-black/60 leading-relaxed font-medium markdown-preview break-all overflow-hidden"
                                    dangerouslySetInnerHTML={{ __html: post.content }} 
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-black/5">
                            <div className="flex items-center space-x-2">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase font-bold ${
                                post.status === 'posted' 
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                : post.status === 'scheduled'
                                ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                : 'bg-gold/10 text-gold border border-gold/20'
                              }`}>
                                {post.status === 'posted' ? '送信完了' : post.status === 'scheduled' ? '予約済み' : '下書き'}
                              </span>
                              {post.wpStatus && (
                                <div className="flex flex-col space-y-1">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/10 text-black/70 border border-black/20 uppercase font-bold">
                                      WP: {post.wpStatus}
                                    </span>
                                    <span className="text-[10px] text-black/40">ID: {post.wpId}</span>
                                  </div>
                                  {post.wpLink && (
                                    <a 
                                      href={post.wpLink} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-[10px] text-gold hover:underline flex items-center space-x-1"
                                    >
                                      <span>記事を確認する</span>
                                      <Play size={8} />
                                    </a>
                                  )}
                                </div>
                              )}
                              {post.postingMessage && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                  post.postingMessage.includes('エラー') 
                                  ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                                  : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                }`}>
                                  {post.postingMessage}
                                </span>
                              )}
                              <div className="flex flex-col space-y-1">
                                <span className="text-[10px] text-black/30 uppercase font-bold">予定日時を変更</span>
                                <div className="flex items-center space-x-2 bg-gold/10 border border-gold/30 rounded-lg px-3 py-1.5 hover:bg-gold/20 transition-all cursor-pointer relative group">
                                  <Calendar size={14} className="text-gold" />
                                  <input 
                                    type="datetime-local"
                                    value={(() => {
                                      const d = new Date(post.scheduledAt);
                                      const offset = d.getTimezoneOffset() * 60000;
                                      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
                                    })()}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (!val) return;
                                      const localDate = new Date(val);
                                      updatePostDate(post.id, localDate.toISOString());
                                    }}
                                    className="bg-transparent text-[11px] text-gold font-bold border-none focus:ring-0 p-0 cursor-pointer w-full"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center space-x-3">
                              {post.status !== 'posted' && (
                                <div className="flex items-center space-x-2">
                                  <button 
                                    onClick={() => postToBlog(post, true)}
                                    disabled={currentlyPostingId === post.id}
                                    className={`text-[10px] flex items-center space-x-1 transition-all px-2 py-1 rounded-md ${
                                      currentlyPostingId === post.id
                                      ? 'bg-emerald-500/20 text-emerald-400 cursor-not-allowed animate-pulse' 
                                      : 'text-emerald-400 hover:bg-emerald-500/10 hover:underline'
                                    }`}
                                  >
                                    {currentlyPostingId === post.id ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Play size={10} />
                                    )}
                                    <span>{currentlyPostingId === post.id ? '送信中...' : '今すぐ投稿'}</span>
                                  </button>

                                  <button 
                                    onClick={() => postToBlog(post, false)}
                                    disabled={currentlyPostingId === post.id}
                                    className={`text-[10px] flex items-center space-x-1 transition-all px-2 py-1 rounded-md ${
                                      currentlyPostingId === post.id
                                      ? 'bg-gold/20 text-gold cursor-not-allowed animate-pulse' 
                                      : 'text-gold hover:bg-gold/10 hover:underline'
                                    }`}
                                  >
                                    {currentlyPostingId === post.id ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Calendar size={10} />
                                    )}
                                    <span>{currentlyPostingId === post.id ? '送信中...' : '予約投稿'}</span>
                                  </button>

                                  <button
                                    onClick={() => setLoopModal({ post, loopEnabled: true, loopIntervalDays: 43200, loopTime: '', saving: false })}
                                    disabled={currentlyPostingId === post.id}
                                    className="text-[10px] flex items-center space-x-1 transition-all px-2 py-1 rounded-md text-purple-400 hover:bg-purple-500/10 hover:underline"
                                    title="Supabaseに保存してサーバー側で自動投稿（ループ対応）"
                                  >
                                    <RefreshCw size={10} />
                                    <span>ループ予約</span>
                                  </button>
                                </div>
                              )}
                              <div className="flex items-center space-x-3">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deletePost(post.id);
                                  }}
                                  className="p-2 text-black/20 hover:text-red-500 transition-colors"
                                  title="この記事を削除"
                                >
                                  <Trash2 size={14} />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(post.plainContent || '');
                                    setNotification({ message: '本文（プレーンテキスト）をコピーしました！', type: 'success' });
                                  }}
                                  className="text-[10px] text-emerald-500 hover:underline flex items-center space-x-1"
                                >
                                  <CheckCircle size={10} />
                                  <span>本文コピー</span>
                                </button>
                                <button 
                                  onClick={() => setEditingPost(post)}
                                  className="text-[10px] text-gold hover:underline"
                                >
                                  詳細・編集
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>
          </div>
          {/* Close grid */}
          </div>

            {/* Supabase scheduled posts panel */}
            <div className="mt-6">
              <button
                onClick={() => {
                  setShowSupabasePanel(v => !v);
                  if (!showSupabasePanel) fetchSupabasePosts();
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-50 border border-purple-200 rounded-xl text-xs font-bold text-purple-600 hover:bg-purple-100 transition-all"
              >
                <Database size={14} />
                <span>Supabase予約一覧</span>
                <ChevronDown size={12} className={`transition-transform ${showSupabasePanel ? 'rotate-180' : ''}`} />
              </button>

              {showSupabasePanel && (
                <div className="mt-3 bg-white border border-purple-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-purple-50 flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-600 flex items-center space-x-2">
                      <Database size={12} />
                      <span>自動投稿スケジュール（{supabasePosts.length}件）</span>
                    </span>
                    <button
                      onClick={fetchSupabasePosts}
                      disabled={isFetchingSupabase}
                      className="text-[10px] text-purple-400 hover:text-purple-600 flex items-center space-x-1"
                    >
                      <RefreshCw size={10} className={isFetchingSupabase ? 'animate-spin' : ''} />
                      <span>更新</span>
                    </button>
                  </div>
                  {isFetchingSupabase && (
                    <div className="p-6 text-center text-xs text-black/40 flex items-center justify-center space-x-2">
                      <Loader2 size={14} className="animate-spin" />
                      <span>読み込み中...</span>
                    </div>
                  )}
                  {!isFetchingSupabase && supabasePosts.length === 0 && (
                    <div className="p-6 text-center text-xs text-black/30">
                      予約済み記事はありません。記事カードの「ループ予約」ボタンから追加できます。
                    </div>
                  )}
                  {!isFetchingSupabase && supabasePosts.length > 0 && (
                    <div className="divide-y divide-black/5 max-h-80 overflow-y-auto">
                      {supabasePosts.map((sp) => (
                        <div key={sp.id} className="px-4 py-3 flex items-center justify-between hover:bg-purple-50/50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-black/80 truncate">{sp.title}</p>
                            <div className="flex items-center space-x-2 mt-0.5 flex-wrap gap-1">
                              <span className="text-[10px] text-black/40">
                                {new Date(sp.scheduled_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                sp.status === 'published' ? 'bg-emerald-100 text-emerald-600' :
                                sp.status === 'failed' ? 'bg-red-100 text-red-600' :
                                sp.status === 'publishing' ? 'bg-blue-100 text-blue-600 animate-pulse' :
                                'bg-yellow-100 text-yellow-600'
                              }`}>
                                {sp.status === 'published' ? '投稿済' : sp.status === 'failed' ? '失敗' : sp.status === 'publishing' ? '投稿中' : '予約中'}
                              </span>
                              {sp.loop_enabled && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-bold flex items-center space-x-0.5">
                                  <RefreshCw size={8} />
                                  <span>{formatLoopInterval(sp.loop_interval_days)}ループ{sp.loop_count > 0 ? `（${sp.loop_count}回目）` : ''}</span>
                                </span>
                              )}
                              {sp.post_to_wp && <span className="text-[10px] text-black/30">WP</span>}
                              {sp.post_to_instagram && <span className="text-[10px] text-black/30">Insta</span>}
                              {sp.post_to_threads && <span className="text-[10px] text-black/30">Threads</span>}
                            </div>
                            {sp.error_message && (
                              <p className="text-[10px] text-red-400 mt-0.5 truncate">{sp.error_message}</p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 ml-3 flex-shrink-0">
                            {sp.status === 'pending' && (
                              <button
                                onClick={() => publishSupabasePostNow(sp.id)}
                                className="text-[10px] text-emerald-500 hover:underline flex items-center space-x-1"
                              >
                                <Play size={9} />
                                <span>今すぐ</span>
                              </button>
                            )}
                            {sp.loop_enabled && (
                              <button
                                onClick={async () => {
                                  await fetch(`/api/scheduled-post/${sp.id}/stop-loop`, { method: 'POST' });
                                  setNotification({ message: 'ループを停止しました', type: 'success' });
                                  fetchSupabasePosts();
                                }}
                                className="text-[10px] text-purple-500 hover:underline flex items-center space-x-0.5"
                                title="ループを停止する"
                              >
                                <X size={9} />
                                <span>ループ停止</span>
                              </button>
                            )}
                            <button
                              onClick={() => deleteSupabasePost(sp.id)}
                              className="p-1 text-black/20 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {}
            <div className="mt-6 flex flex-wrap gap-3">
              <div className="glass px-4 py-2 rounded-full flex items-center space-x-2 text-[10px] uppercase tracking-widest font-semibold text-black/60">
                <Sparkles size={12} className="text-gold" />
                <span>SEO Optimized</span>
              </div>
              <div className="glass px-4 py-2 rounded-full flex items-center space-x-2 text-[10px] uppercase tracking-widest font-semibold text-black/60">
                <Calendar size={12} className="text-emerald-400" />
                <span>Auto Scheduling</span>
              </div>
              <div className="glass px-4 py-2 rounded-full flex items-center space-x-2 text-[10px] uppercase tracking-widest font-semibold text-black/60">
                <CheckCircle size={12} className="text-blue-400" />
                <span>WP Integrated</span>
              </div>
            </div>
        </main>

      {/* Loop modal */}
      <AnimatePresence>
        {loopModal.post && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => !loopModal.saving && setLoopModal(prev => ({ ...prev, post: null }))}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-purple-700 flex items-center space-x-2">
                  <RefreshCw size={16} />
                  <span>Supabaseループ予約</span>
                </h3>
                <button onClick={() => setLoopModal(prev => ({ ...prev, post: null }))} className="text-black/30 hover:text-black/60">
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-black/60 bg-purple-50 rounded-xl px-3 py-2 truncate">
                「{loopModal.post.title}」
              </p>

              <div className="space-y-1">
                <label className="text-[10px] text-black/40 uppercase font-bold">投稿予定日時</label>
                <p className="text-sm font-semibold text-black/80">
                  {new Date(loopModal.post.scheduledAt).toLocaleString('ja-JP')}
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <div
                    onClick={() => setLoopModal(prev => ({ ...prev, loopEnabled: !prev.loopEnabled }))}
                    className={`w-10 h-6 rounded-full relative transition-colors ${loopModal.loopEnabled ? 'bg-purple-500' : 'bg-black/20'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${loopModal.loopEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-black/80">ループ投稿を有効にする</p>
                    <p className="text-[10px] text-black/40">投稿後に同じ記事を自動で再予約</p>
                  </div>
                </label>

                {loopModal.loopEnabled && (
                  <div className="space-y-3 pl-13">
                    <div className="space-y-1">
                      <label className="text-[10px] text-black/40 uppercase font-bold">ループ間隔</label>
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        {[
                          { label: '10分(テスト)', value: 10 },
                          { label: '1日', value: 1440 },
                          { label: '7日', value: 10080 },
                          { label: '30日', value: 43200 },
                          { label: '60日', value: 86400 },
                        ].map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setLoopModal(prev => ({ ...prev, loopIntervalDays: opt.value }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                              loopModal.loopIntervalDays === opt.value
                                ? 'bg-purple-500 text-white border-purple-500'
                                : 'bg-white text-black/50 border-black/10 hover:border-purple-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-purple-500 mt-1">
                        月300記事 → 1日10記事 × 30日間隔
                      </p>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-black/40 uppercase font-bold">投稿時刻（任意）</label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="time"
                          value={loopModal.loopTime}
                          onChange={e => setLoopModal(prev => ({ ...prev, loopTime: e.target.value }))}
                          className="bg-white border border-black/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-purple-400"
                        />
                        {loopModal.loopTime && (
                          <button
                            onClick={() => setLoopModal(prev => ({ ...prev, loopTime: '' }))}
                            className="text-[10px] text-black/30 hover:text-red-400"
                          >クリア</button>
                        )}
                      </div>
                      <p className="text-[10px] text-black/30 leading-tight">
                        {loopModal.loopTime
                          ? `毎回 ${loopModal.loopTime} に投稿されます。夜中でも起きていなくてOK。`
                          : '空欄 = 元の投稿時刻を引き継ぐ'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-black/5 rounded-xl p-3 text-[10px] text-black/50 space-y-1">
                <p>✓ サーバーが1分ごとに自動チェック・投稿</p>
                <p>✓ WP・Instagram・Threads に同時投稿</p>
                {loopModal.loopEnabled && <p>✓ {formatLoopInterval(loopModal.loopIntervalDays)}ごとに同じ記事を再投稿{loopModal.loopTime ? `（毎回 ${loopModal.loopTime}）` : ''}</p>}
              </div>

              <button
                onClick={() => loopModal.post && saveToSupabase(loopModal.post, loopModal.loopEnabled, loopModal.loopIntervalDays, loopModal.loopTime)}
                disabled={loopModal.saving}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 ${
                  loopModal.saving
                    ? 'bg-purple-200 text-purple-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700 shadow-lg shadow-purple-200'
                }`}
              >
                {loopModal.saving ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
                <span>{loopModal.saving ? '保存中...' : 'Supabaseに予約する'}</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {}
      <AnimatePresence>
        {editingPost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between bg-gold/5">
                <h3 className="text-gold font-bold uppercase tracking-widest text-sm flex items-center space-x-2">
                  <Sparkles size={16} />
                  <span>記事の編集・詳細</span>
                </h3>
                <button 
                  onClick={() => setEditingPost(null)}
                  className="text-black/40 hover:text-black transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">記事タイトル</label>
                  <input 
                    type="text"
                    value={editingPost.title}
                    onChange={(e) => setEditingPost({ ...editingPost, title: e.target.value })}
                    className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-gold/20 outline-none transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">アイキャッチ画像</label>
                    <div className="aspect-video rounded-2xl overflow-hidden border border-black/10 relative group">
                      {editingPost.imageUrl && (
                        <img src={editingPost.imageUrl} className="w-full h-full object-cover" alt="" />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <label className="cursor-pointer bg-white/20 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full hover:bg-white/30 transition-all">
                          画像を差し替える
                          <input 
                              type="file" 
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  if (ev.target?.result) {
                                    setEditingPost({
                                      ...editingPost,
                                      imageUrl: ev.target.result as string,
                                      imageBase64: ''
                                    });
                                  }
                                };
                                reader.readAsDataURL(file);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">投稿するSNSアカウントの選択</label>
                        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto custom-scrollbar bg-black/5 p-3 rounded-2xl border border-black/10">
                          {blogSettings.socialAccounts.length === 0 ? (
                            <p className="text-[10px] text-black/40 text-center py-4">※設定パネルでSNSアカウントを追加してください。</p>
                          ) : (
                            blogSettings.socialAccounts.map(account => {
                              const isSelected = editingPost.selectedSocialAccounts?.includes(account.id);
                              return (
                                <button
                                  key={account.id}
                                  onClick={() => {
                                    const current = editingPost.selectedSocialAccounts || [];
                                    const newAccounts = isSelected 
                                      ? current.filter(id => id !== account.id)
                                      : [...current, account.id];
                                    setEditingPost({ ...editingPost, selectedSocialAccounts: newAccounts });
                                  }}
                                  className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                                    isSelected ? 'bg-gold/10 border-gold/50 text-gold shadow-sm' : 'bg-white border-transparent text-black/60 hover:border-black/10 shadow-sm'
                                  }`}
                                >
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold">{account.name}</span>
                                    <span className="text-[9px] opacity-70">
                                      {account.platform === 'instagram' ? 'Instagram' : 'Threads'}
                                    </span>
                                  </div>
                                  {isSelected && <CheckCircle size={14} />}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-8 mt-8 border-t border-black/5 pt-8">
                    {/* 1. HTML Content (コードのスペース) */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-black/40 flex items-center space-x-2">
                         <span>コード (HTML本文)</span>
                      </label>
                      <textarea 
                        value={editingPost.content}
                        onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-gold/20 outline-none transition-all min-h-[400px] resize-y custom-scrollbar"
                      />
                    </div>

                    {/* 2. Plain Text Content (プレーンテキストのスペース) */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">プレーンテキスト (表示用・読み上げ用など)</label>
                      <textarea 
                        value={editingPost.plainContent || ''}
                        onChange={(e) => setEditingPost({ ...editingPost, plainContent: e.target.value })}
                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-gold/20 outline-none transition-all min-h-[400px] resize-y custom-scrollbar"
                      />
                    </div>

                    {/* 3. Instagram Caption */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">Instagram 用キャプション / スペース</label>
                      <textarea 
                        value={editingPost.instaCaption || ''}
                        onChange={(e) => setEditingPost({ ...editingPost, instaCaption: e.target.value })}
                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-gold/20 outline-none transition-all min-h-[300px] resize-y custom-scrollbar"
                      />
                    </div>

                    {/* 4. Threads Caption */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">Threads 用テキスト / スペース</label>
                      <textarea 
                        value={editingPost.threadsCaption || ''}
                        onChange={(e) => setEditingPost({ ...editingPost, threadsCaption: e.target.value })}
                        className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-gold/20 outline-none transition-all min-h-[300px] resize-y custom-scrollbar"
                      />
                    </div>

                    {/* Small fields: Meta and Hashtags */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">メタディスクリプション (SEO)</label>
                        <textarea 
                          value={editingPost.metaDescription || ''}
                          onChange={(e) => setEditingPost({ ...editingPost, metaDescription: e.target.value })}
                          className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-gold/20 outline-none transition-all min-h-[80px] resize-y custom-scrollbar"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-black/40">Instagram 用ハッシュタグ</label>
                        <textarea 
                          value={editingPost.instaHashtags || ''}
                          onChange={(e) => setEditingPost({ ...editingPost, instaHashtags: e.target.value })}
                          className="w-full bg-black/5 border border-black/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-gold/20 outline-none transition-all min-h-[80px] resize-y custom-scrollbar"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-8 flex justify-end space-x-3">
                    <button 
                      onClick={() => setEditingPost(null)}
                      className="px-6 py-2.5 rounded-full text-xs font-bold text-black/60 bg-black/5 hover:bg-black/10 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button 
                      onClick={() => {
                        setBlogPosts(prev => prev.map(p => p.id === editingPost.id ? editingPost : p));
                        setEditingPost(null);
                        setNotification({ message: '記事を更新しました', type: 'success' });
                      }}
                      className="px-6 py-2.5 rounded-full text-xs font-bold text-white bg-black hover:bg-black/80 shadow-md transition-all flex items-center space-x-2"
                    >
                      <Save size={14} />
                      <span>保存する</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      {/* WPサイト追加モーダル */}
      <AnimatePresence>
        {showAddWpSiteForm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between bg-gold/5">
                <div className="flex items-center space-x-3">
                  <Globe className="text-gold" size={18} />
                  <h3 className="text-sm font-bold">WPサイトを追加</h3>
                </div>
                <button onClick={() => { setShowAddWpSiteForm(false); setNewWpSite({ name: '', url: '', username: '', appPassword: '', newsSlug: 'news' }); }}>
                  <X size={18} className="text-black/40" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-black/40 font-bold uppercase">サイト名（表示名）</label>
                  <input type="text" placeholder="例: クライアントA" value={newWpSite.name}
                    onChange={(e) => setNewWpSite({ ...newWpSite, name: e.target.value })}
                    className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-black/40 font-bold uppercase">WordPress サイトURL</label>
                  <input type="text" placeholder="https://example.com/" value={newWpSite.url}
                    onChange={(e) => setNewWpSite({ ...newWpSite, url: e.target.value })}
                    className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-black/40 font-bold uppercase">ユーザー名</label>
                    <input type="text" placeholder="admin" value={newWpSite.username}
                      onChange={(e) => setNewWpSite({ ...newWpSite, username: e.target.value })}
                      className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-black/40 font-bold uppercase">アプリパスワード</label>
                    <input type="password" placeholder="xxxx xxxx xxxx" value={newWpSite.appPassword}
                      onChange={(e) => setNewWpSite({ ...newWpSite, appPassword: e.target.value })}
                      className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!newWpSite.name || !newWpSite.url) return;
                    const id = `wp-${Date.now()}`;
                    const site: WpSite = { id, ...newWpSite };
                    setBlogSettings({
                      ...blogSettings,
                      wpSites: [...blogSettings.wpSites, site],
                      selectedWpSiteId: id,
                      targetUrl: site.url,
                      username: site.username,
                      appPassword: site.appPassword,
                      newsSlug: site.newsSlug || 'news'
                    });
                    setExpandedWpSiteId(id);
                    setShowAddWpSiteForm(false);
                    setNewWpSite({ name: '', url: '', username: '', appPassword: '', newsSlug: 'news' });
                  }}
                  className="w-full bg-gold text-black font-bold py-2.5 rounded-xl text-xs hover:bg-gold/80 transition-all"
                >
                  追加する
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* サロン管理モーダル */}
      <AnimatePresence>
        {showSalonManager && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between bg-gold/5">
                <div className="flex items-center space-x-3">
                  <Globe className="text-gold" size={20} />
                  <h3 className="text-sm font-bold">サロン管理</h3>
                </div>
                <button onClick={() => { setShowSalonManager(false); setEditingSalon(null); }}>
                  <X size={20} className="text-black/40" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* サロン一覧 */}
                {blogSettings.salonProfiles.length === 0 ? (
                  <p className="text-center text-[11px] text-black/30 py-8">登録されたサロンがありません</p>
                ) : (
                  <div className="space-y-3">
                    {blogSettings.salonProfiles.map(salon => (
                      <div key={salon.id} className="border border-black/10 rounded-xl p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{salon.name}</span>
                          <div className="flex space-x-2">
                            <button onClick={() => setEditingSalon(salon)} className="text-[10px] text-gold hover:underline">編集</button>
                            <button onClick={() => {
                              setBlogSettings({
                                ...blogSettings,
                                salonProfiles: blogSettings.salonProfiles.filter(s => s.id !== salon.id),
                                selectedSalonId: blogSettings.selectedSalonId === salon.id ? '' : blogSettings.selectedSalonId
                              });
                            }} className="text-[10px] text-red-400 hover:underline">削除</button>
                          </div>
                        </div>
                        {[
                          { label: 'HP', url: salon.hpUrl },
                          { label: 'ホットペッパー', url: salon.hotpepperUrl },
                          { label: 'Instagram', url: salon.instagramUrl },
                          ...salon.otherUrls.map((u, i) => ({ label: `参考URL${i + 1}`, url: u }))
                        ].filter(x => x.url).map((x, i) => (
                          <p key={i} className="text-[9px] text-black/40 truncate">🔗 {x.label}: {x.url}</p>
                        ))}
                        {salon.notes && <p className="text-[9px] text-black/30 italic">{salon.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 追加・編集フォーム */}
                {(editingSalon !== null || true) && (() => {
                  const isEditing = editingSalon !== null;
                  const form = isEditing ? editingSalon : newSalon;
                  const setForm = isEditing
                    ? (v: any) => setEditingSalon(v)
                    : (v: any) => setNewSalon(v);

                  return (
                    <div className="border-t border-black/5 pt-6 space-y-4">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-black/40">
                        {isEditing ? `「${editingSalon.name}」を編集` : '新しいサロンを追加'}
                      </h4>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[10px] text-black/40 font-bold uppercase">サロン名</label>
                          <input type="text" placeholder="例: エステサロンA" value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                        </div>
                        {[
                          { key: 'hpUrl', label: 'HP URL', placeholder: 'https://salon-a.com' },
                          { key: 'hotpepperUrl', label: 'ホットペッパー URL', placeholder: 'https://beauty.hotpepper.jp/...' },
                          { key: 'instagramUrl', label: 'Instagram URL', placeholder: 'https://instagram.com/salon_a' },
                        ].map(field => (
                          <div key={field.key} className="space-y-1">
                            <label className="text-[10px] text-black/40 font-bold uppercase">{field.label}</label>
                            <input type="text" placeholder={field.placeholder} value={(form as any)[field.key]}
                              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                              className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                          </div>
                        ))}

                        {/* その他のURL（動的追加） */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-black/40 font-bold uppercase">その他の参考URL</label>
                            <button onClick={() => setForm({ ...form, otherUrls: [...form.otherUrls, ''] })}
                              className="text-[9px] text-gold hover:underline flex items-center space-x-1">
                              <Plus size={9} /><span>追加</span>
                            </button>
                          </div>
                          {form.otherUrls.map((url: string, i: number) => (
                            <div key={i} className="flex space-x-2">
                              <input type="text" placeholder={`参考URL ${i + 1}`} value={url}
                                onChange={(e) => {
                                  const next = [...form.otherUrls];
                                  next[i] = e.target.value;
                                  setForm({ ...form, otherUrls: next });
                                }}
                                className="flex-1 bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50" />
                              <button onClick={() => setForm({ ...form, otherUrls: form.otherUrls.filter((_: string, j: number) => j !== i) })}
                                className="text-black/20 hover:text-red-400 transition-colors">
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-black/40 font-bold uppercase">メモ・特記事項</label>
                          <textarea placeholder="サロンの特徴、強み、注意点など..." value={form.notes}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            rows={3}
                            className="w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-gold/50 resize-none" />
                        </div>

                        <div className="flex space-x-2">
                          {isEditing && (
                            <button onClick={() => setEditingSalon(null)}
                              className="flex-1 py-2 border border-black/10 rounded-xl text-xs text-black/40 hover:bg-black/5 transition-all">
                              キャンセル
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (!form.name) return;
                              if (isEditing) {
                                setBlogSettings({
                                  ...blogSettings,
                                  salonProfiles: blogSettings.salonProfiles.map(s => s.id === editingSalon.id ? editingSalon : s)
                                });
                                setEditingSalon(null);
                              } else {
                                const id = `salon-${Date.now()}`;
                                setBlogSettings({
                                  ...blogSettings,
                                  salonProfiles: [...blogSettings.salonProfiles, { id, ...newSalon }]
                                });
                                setNewSalon({ name: '', hpUrl: '', hotpepperUrl: '', instagramUrl: '', otherUrls: [], notes: '' });
                              }
                            }}
                            className="flex-1 bg-gold text-black font-bold py-2 rounded-xl text-xs hover:bg-gold/80 transition-all"
                          >
                            {isEditing ? '更新する' : '登録する'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPresetManager && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between bg-gold/5">
                <div className="flex items-center space-x-3">
                  <Settings className="text-gold" size={20} />
                  <h3 className="text-sm font-bold uppercase tracking-widest text-black/80">プリセット項目管理</h3>
                </div>
                <button 
                  onClick={() => setShowPresetManager(false)}
                  className="p-2 hover:bg-black/5 rounded-full transition-colors"
                >
                  <X size={20} className="text-black/40" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {[
                  { label: 'SEOキーワード', key: 'keywords' as const },
                  { label: '誰に (ターゲット読者)', key: 'toWhom' as const },
                  { label: '何を (テーマ・訴求点)', key: 'what' as const },
                ].map((section) => (
                  <div key={section.key} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-black/40">{section.label}</h4>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <input 
                        type="text"
                        placeholder={`${section.label}に新しい項目を追加...`}
                        value={newPresetInputs[section.key]}
                        onChange={(e) => setNewPresetInputs(prev => ({ ...prev, [section.key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newPresetInputs[section.key].trim()) {
                            const newItem = newPresetInputs[section.key].trim();
                            const newPresets = { ...policyPresets, [section.key]: [...policyPresets[section.key], newItem] };
                            savePresets(newPresets);
                            setNewPresetInputs(prev => ({ ...prev, [section.key]: '' }));
                          }
                        }}
                        className="flex-1 bg-black/5 border border-black/10 rounded-xl px-4 py-2 text-[10px] focus:ring-2 focus:ring-gold/20 outline-none transition-all"
                      />
                      <button 
                        onClick={() => {
                          if (newPresetInputs[section.key].trim()) {
                            const newItem = newPresetInputs[section.key].trim();
                            const newPresets = { ...policyPresets, [section.key]: [...policyPresets[section.key], newItem] };
                            savePresets(newPresets);
                            setNewPresetInputs(prev => ({ ...prev, [section.key]: '' }));
                          }
                        }}
                        className="bg-gold text-black px-4 py-2 rounded-xl text-[10px] font-bold hover:bg-gold/80 transition-all"
                      >
                        追加
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {policyPresets[section.key].map((item: string, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-black/5 rounded-lg px-3 py-2 group">
                          <span className="text-[10px] text-black/60 truncate mr-2">{item}</span>
                          <button 
                            onClick={() => {
                              const newItems = [...policyPresets[section.key]];
                              newItems.splice(idx, 1);
                              savePresets({ ...policyPresets, [section.key]: newItems });
                            }}
                            className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      {policyPresets[section.key].length === 0 && (
                        <div className="col-span-2 text-center py-4 border border-dashed border-black/10 rounded-xl text-[10px] text-black/30">
                          項目が登録されていません
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 border-t border-black/5 bg-black/5 flex justify-end">
                <button 
                  onClick={() => setShowPresetManager(false)}
                  className="px-6 py-2 bg-gold text-white text-[11px] font-bold uppercase tracking-widest rounded-xl shadow-lg shadow-gold/20 hover:bg-gold/90 transition-all"
                >
                  完了
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
