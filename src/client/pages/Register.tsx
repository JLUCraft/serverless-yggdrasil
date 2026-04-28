import { createSignal, Show, For, onMount } from 'solid-js';
import { useNavigate, A } from '@solidjs/router';
import { api, allowedEmailDomains, loadAccount } from '../lib/api';
import siteConfig from '../../../site.config.json';

const PENDING_KEY = 'pendingRegistration';

export default function Register() {
  const [username, setUsername] = createSignal('');
  const [emailPrefix, setEmailPrefix] = createSignal('');
  const [emailDomain, setEmailDomain] = createSignal(allowedEmailDomains[0]);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const navigate = useNavigate();

  onMount(() => {
    void loadAccount().then((current) => {
      if (current) {
        navigate('/dashboard', { replace: true });
      }
    });
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError('');

    if (!emailPrefix()) {
      setError('请输入邮箱');
      return;
    }

    const email = `${emailPrefix()}@${emailDomain()}`;

    setLoading(true);
    try {
      const res = await api.auth.registerInitiate(username(), email);
      localStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
          username: username(),
          email,
          recipient: res.data.recipient,
          token: res.data.token,
        })
      );
      navigate('/register/verify');
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="min-h-screen w-full flex flex-col lg:flex-row bg-base-100">
      {/* Left Branding Side */}
      <div class="hidden lg:flex lg:w-1/2 relative bg-primary/5 flex-col justify-between p-12 border-r border-base-300">
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -top-[20%] -left-[10%] w-[80%] h-[80%] bg-primary/15 rounded-full blur-[120px]"></div>
          <div class="absolute top-[40%] -right-[20%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[100px]"></div>
        </div>
        <div class="relative z-10">
          <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-14 h-14 rounded object-contain" />
          <h1 class="mt-8 text-4xl font-extrabold text-base-content tracking-tight leading-tight">
            加入<br />{siteConfig.appName}
          </h1>
          <p class="mt-4 text-base text-base-content/60 max-w-xs leading-relaxed">
            {siteConfig.siteSubtitle}
          </p>
        </div>
        <div class="relative z-10 glass-panel p-5 max-w-sm">
          <p class="text-sm text-base-content/70 italic">"Explore the boundless world with a unified identity."</p>
        </div>
      </div>

      {/* Right Form Side */}
      <div class="flex-1 flex items-center justify-center p-6 sm:p-10 animate-fade-in">
        <div class="w-full max-w-sm space-y-5">
          {/* Mobile logo */}
          <div class="lg:hidden flex items-center gap-3 mb-2">
            <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-8 h-8 rounded object-contain" />
            <span class="font-bold text-primary">{siteConfig.shortName}</span>
          </div>

          <div>
            <h2 class="text-2xl font-bold text-base-content tracking-tight">创建您的账号</h2>
            <p class="mt-1 text-sm text-base-content/60">今天就开始使用 {siteConfig.shortName}</p>
          </div>

          <form onSubmit={handleSubmit} class="space-y-4">
            <div>
              <label class="block text-sm font-semibold text-base-content/80 mb-1.5">用户名</label>
              <input
                type="text"
                class="input glass-input w-full focus:ring-2 focus:ring-primary/20 focus:outline-none"
                placeholder="3-16 个字符"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                required
                minLength={3}
                maxLength={16}
              />
            </div>

            <div>
              <label class="block text-sm font-semibold text-base-content/80 mb-1.5">校园邮箱</label>
              <div class="flex">
                <input
                  type="text"
                  class="input glass-input flex-1 rounded-r-none border-r-0 focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  placeholder="邮箱前缀"
                  value={emailPrefix()}
                  onInput={(e) => setEmailPrefix(e.currentTarget.value)}
                  required
                />
                <div class="flex items-center px-2.5 bg-base-200 border border-base-300 border-l-0 text-base-content/60 text-sm select-none">@</div>
                <select
                  class="select glass-input rounded-l-none border-l-0 focus:ring-2 focus:ring-primary/20 focus:outline-none w-36 shrink-0"
                  value={emailDomain()}
                  onChange={(e) => setEmailDomain(e.currentTarget.value)}
                >
                  <For each={allowedEmailDomains}>
                    {(domain) => <option value={domain}>{domain}</option>}
                  </For>
                </select>
              </div>
            </div>
            <Show when={error()}>
              <div class="rounded border border-error/30 bg-error/8 text-error text-sm px-4 py-2.5">
                {error()}
              </div>
            </Show>

            <button type="submit" class="btn btn-primary w-full text-white font-semibold h-11 mt-1" disabled={loading()}>
              <Show when={loading()}>
                <span class="loading loading-spinner loading-xs mr-2"></span>
              </Show>
              继续邮箱验证
            </button>
          </form>

          <div class="text-center text-sm text-base-content/60 pt-1">
            已有账号？<A href="/login" class="text-primary hover:underline font-semibold ml-1">返回登录</A>
          </div>
        </div>
      </div>
    </div>
  );
}
