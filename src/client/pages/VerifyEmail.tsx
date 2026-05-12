import { createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api, acceptLogin } from '../lib/api';
import siteConfig from '../../../site.config.json';

const PENDING_KEY = 'pendingRegistration';

interface PendingRegistration {
  username: string;
  email: string;
  recipient: string;
  token: string;
}

function getPending(): PendingRegistration | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRegistration>;
    if (!parsed.username || !parsed.email || !parsed.recipient || !parsed.token) {
      return null;
    }
    return {
      username: parsed.username,
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
  const [password, setPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');

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

    }
  }

  async function completeRegistration() {
    setError('');
    if (password() !== confirmPassword()) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password().length < 8) {
      setError('密码至少需要 8 位');
      return;
    }

    setLoading(true);
    try {
      const res = await api.auth.registerComplete(
        registration.username,
        password(),
        registration.email,
        registration.token
      );
      acceptLogin(res.data.token, res.data.user);
      clearPending();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="min-h-screen w-full flex flex-col lg:flex-row bg-base-100">
      {}
      <div class="hidden lg:flex lg:w-1/2 relative bg-primary/5 flex-col justify-between p-12 border-r border-base-300">
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -top-[20%] -left-[10%] w-[80%] h-[80%] bg-primary/15 rounded-full blur-[120px]"></div>
          <div class="absolute top-[40%] -right-[20%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[100px]"></div>
        </div>
        <div class="relative z-10">
          <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-14 h-14 rounded object-contain" />
          <h1 class="mt-8 text-4xl font-extrabold text-base-content tracking-tight leading-tight">
            验证<br />{siteConfig.shortName}
          </h1>
          <p class="mt-4 text-base text-base-content/60 max-w-xs leading-relaxed">
            {siteConfig.siteSubtitle}
          </p>
        </div>
        <div class="relative z-10 glass-panel p-5 max-w-sm">
          <p class="text-sm text-base-content/70 italic">"Explore the boundless world with a unified identity."</p>
        </div>
      </div>

      {}
      <div class="flex-1 flex items-center justify-center p-6 sm:p-10 animate-fade-in">
        <div class="w-full max-w-sm space-y-5">
          {}
          <div class="lg:hidden flex items-center gap-3 mb-2">
            <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-8 h-8 rounded object-contain" />
            <span class="font-bold text-primary">{siteConfig.shortName}</span>
          </div>

          <div>
            <h2 class="text-2xl font-bold text-base-content tracking-tight">验证您的校园邮箱</h2>
            <p class="mt-1 text-sm text-base-content/60">
              注册前需要通过校园邮箱发送验证邮件
            </p>
          </div>

          <div class="rounded border border-base-300 bg-base-100 p-5 space-y-4">
            <div class="space-y-1">
              <div class="text-xs font-bold uppercase tracking-widest text-base-content/50">用户名</div>
              <div class="text-sm font-mono text-base-content/80">{registration.username}</div>
            </div>

            <div class="space-y-1">
              <div class="text-xs font-bold uppercase tracking-widest text-base-content/50">收件地址</div>
              <div class="text-sm font-mono text-base-content/80">{registration.recipient}</div>
            </div>

            <div class="space-y-1">
              <div class="text-xs font-bold uppercase tracking-widest text-base-content/50">发送邮箱</div>
              <div class="text-sm font-mono text-base-content/80">{registration.email}</div>
            </div>

            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <div class="text-xs font-bold uppercase tracking-widest text-base-content/50">验证令牌</div>
                <button
                  type="button"
                  onClick={copyToken}
                  class="text-xs font-semibold text-primary hover:underline"
                >
                  {copied() ? '已复制' : '复制'}
                </button>
              </div>
              <div class="rounded bg-base-200 border border-base-300 px-3 py-2">
                <code class="text-sm font-mono text-base-content/80 break-all">{registration.token}</code>
              </div>
              <p class="text-xs text-base-content/60">
                请将上述令牌包含在邮件的<strong>主题</strong>或<strong>正文</strong>中发送
              </p>
            </div>
          </div>

          <div class="rounded border border-base-300 bg-base-100 p-5 space-y-4">
            <div>
              <label class="block text-sm font-semibold text-base-content/80 mb-1.5">设置密码</label>
              <input
                type="password"
                class="input glass-input w-full focus:ring-2 focus:ring-primary/20 focus:outline-none"
                placeholder="至少 8 位"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
                minLength={8}
              />
            </div>

            <div>
              <label class="block text-sm font-semibold text-base-content/80 mb-1.5">确认密码</label>
              <input
                type="password"
                class="input glass-input w-full focus:ring-2 focus:ring-primary/20 focus:outline-none"
                placeholder="再次输入密码"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                required
              />
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

          <div class="text-center text-sm text-base-content/60 pt-1">
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
