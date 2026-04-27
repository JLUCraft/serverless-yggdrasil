import { createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import siteConfig from '../../site.config.ts';

const PENDING_KEY = 'pendingRegistration';
const isMock = () => import.meta.env.DEV;

interface PendingRegistration {
  username: string;
  password: string;
  email: string;
  recipient: string;
  token: string;
}

function getPending(): PendingRegistration | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRegistration>;
    if (!parsed.username || !parsed.password || !parsed.email || !parsed.recipient || !parsed.token) {
      return null;
    }
    return {
      username: parsed.username,
      password: parsed.password,
      email: parsed.email,
      recipient: parsed.recipient,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

function clearPending() {
  localStorage.removeItem(PENDING_KEY);
}

export default function VerifyEmail() {
  const navigate = useNavigate();
  const pending = getPending();

  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  if (!pending) {
    navigate('/register');
    return null;
  }
  const registration = pending;

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(registration.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  async function completeRegistration() {
    setError('');
    setLoading(true);
    try {
      const res = await api.auth.registerComplete(
        registration.username,
        registration.password,
        registration.email,
        registration.token
      );
      localStorage.setItem('token', res.data.token);
      clearPending();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  }

  async function mockVerify() {
    setError('');
    try {
      const res = await api.auth.registerComplete(
        registration.username,
        registration.password,
        registration.email,
        registration.token
      );
      localStorage.setItem('token', res.data.token);
      clearPending();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || '注册失败');
    }
  }

  return (
    <div class="min-h-screen w-full flex flex-col lg:flex-row bg-base-100">
      {/* Left Branding Side */}
      <div class="hidden lg:flex lg:w-1/2 relative bg-primary/5 flex-col justify-between p-12 border-r border-slate-200">
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -top-[20%] -left-[10%] w-[80%] h-[80%] bg-primary/15 rounded-full blur-[120px]"></div>
          <div class="absolute top-[40%] -right-[20%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[100px]"></div>
        </div>
        <div class="relative z-10">
          <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-14 h-14 rounded object-contain" />
          <h1 class="mt-8 text-4xl font-extrabold text-slate-800 tracking-tight leading-tight">
            验证<br />{siteConfig.shortName}
          </h1>
          <p class="mt-4 text-base text-slate-500 max-w-xs leading-relaxed">
            {siteConfig.siteSubtitle}
          </p>
        </div>
        <div class="relative z-10 glass-panel p-5 max-w-sm">
          <p class="text-sm text-slate-600 italic">"Explore the boundless world with a unified identity."</p>
        </div>
      </div>

      {/* Right Content Side */}
      <div class="flex-1 flex items-center justify-center p-6 sm:p-10 animate-fade-in">
        <div class="w-full max-w-sm space-y-5">
          {/* Mobile logo */}
          <div class="lg:hidden flex items-center gap-3 mb-2">
            <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-8 h-8 rounded object-contain" />
            <span class="font-bold text-primary">{siteConfig.shortName}</span>
          </div>

          <div>
            <h2 class="text-2xl font-bold text-slate-800 tracking-tight">验证您的校园邮箱</h2>
            <p class="mt-1 text-sm text-slate-500">
              注册前需要通过校园邮箱发送验证邮件
            </p>
          </div>

          <div class="rounded border border-slate-200 bg-white p-5 space-y-4">
            <div class="space-y-1">
              <div class="text-xs font-bold uppercase tracking-widest text-slate-400">收件地址</div>
              <div class="text-sm font-mono text-slate-700">{registration.recipient}</div>
            </div>

            <div class="space-y-1">
              <div class="text-xs font-bold uppercase tracking-widest text-slate-400">发送邮箱</div>
              <div class="text-sm font-mono text-slate-700">{registration.email}</div>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <div class="text-xs font-bold uppercase tracking-widest text-slate-400">验证令牌</div>
                <button
                  type="button"
                  onClick={copyToken}
                  class="text-xs font-semibold text-primary hover:underline"
                >
                  {copied() ? '已复制' : '复制'}
                </button>
              </div>
              <div class="rounded bg-slate-50 border border-slate-200 px-3 py-2">
                <code class="text-sm font-mono text-slate-700 break-all">{registration.token}</code>
              </div>
              <p class="text-xs text-slate-500">
                请将上述令牌包含在邮件的<strong>主题</strong>或<strong>正文</strong>中发送
              </p>
            </div>
          </div>

          <Show when={siteConfig.emailWebmailUrl}>
            <a
              href={siteConfig.emailWebmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-outline w-full h-11 font-semibold flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              打开网页邮箱
            </a>
          </Show>

          <Show when={error()}>
            <div class="rounded border border-error/30 bg-error/8 text-error text-sm px-4 py-2.5">
              {error()}
            </div>
          </Show>

          <Show when={isMock()}>
            <div class="rounded border border-warning/30 bg-warning/8 text-warning text-sm px-4 py-2.5">
              <div class="font-semibold mb-1">开发模式</div>
              <div class="text-xs">点击下方按钮模拟邮件验证完成</div>
            </div>
            <button
              type="button"
              onClick={() => void mockVerify()}
              class="btn btn-outline w-full h-11 font-semibold border-dashed border-warning text-warning hover:bg-warning/10"
            >
              模拟验证完成
            </button>
          </Show>

          <button
            type="button"
            onClick={() => void completeRegistration()}
            class="btn btn-primary w-full text-white font-semibold h-11"
            disabled={loading()}
          >
            <Show when={loading()}>
              <span class="loading loading-spinner loading-xs mr-2"></span>
            </Show>
            我已完成验证，继续注册
          </button>

          <div class="text-center text-sm text-slate-500 pt-1">
            <button
              type="button"
              onClick={() => { clearPending(); navigate('/register'); }}
              class="text-primary hover:underline font-semibold"
            >
              返回注册页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
