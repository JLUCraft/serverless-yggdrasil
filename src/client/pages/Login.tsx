import { createSignal, Show, onMount } from 'solid-js';
import { useNavigate, A } from '@solidjs/router';
import { api, loadAccount, acceptLogin } from '../lib/api';
import siteConfig from '../../../site.config.json';

export default function Login() {
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
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
    setLoading(true);
    try {
      const res = await api.auth.login(username(), password());
      acceptLogin(res.data.token, res.data.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || '登录失败');
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
            欢迎访问<br />{siteConfig.appName}
          </h1>
          <p class="mt-4 text-base text-base-content/60 max-w-xs leading-relaxed">
            {siteConfig.siteSubtitle}
          </p>
        </div>
        <div class="relative z-10">
          <p class="text-xs text-base-content/50">Powered by Yggdrasil</p>
        </div>
      </div>

      {/* Right Form Side */}
      <div class="flex-1 flex items-center justify-center p-6 sm:p-10 animate-fade-in">
        <div class="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div class="lg:hidden flex items-center gap-3 mb-2">
            <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-8 h-8 rounded object-contain" />
            <span class="font-bold text-primary">{siteConfig.shortName}</span>
          </div>
          <div>
            <h2 class="text-2xl font-bold text-base-content tracking-tight">登录账号</h2>
            <p class="mt-1 text-sm text-base-content/60">请输入您的皮肤站账号信息</p>
          </div>

          <form onSubmit={handleSubmit} class="space-y-4">
            <div class="form-control">
              <label class="label py-1">
                <span class="label-text font-semibold text-base-content/80">用户名</span>
              </label>
              <input
                type="text"
                class="input glass-input w-full focus:ring-2 focus:ring-primary/20 focus:outline-none"
                placeholder="请输入您的用户名"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                required
              />
            </div>

            <div class="form-control">
              <label class="label py-1">
                <span class="label-text font-semibold text-base-content/80">密码</span>
              </label>
              <input
                type="password"
                class="input glass-input w-full focus:ring-2 focus:ring-primary/20 focus:outline-none"
                placeholder="请输入您的密码"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
              />
            </div>


            <Show when={error()}>
              <div class="rounded border border-error/30 bg-error/8 text-error text-sm px-4 py-2.5">
                {error()}
              </div>
            </Show>

            <button type="submit" class="btn btn-primary w-full text-white font-semibold h-11 mt-2" disabled={loading()}>
              <Show when={loading()}>
                <span class="loading loading-spinner loading-xs mr-2"></span>
              </Show>
              登录系统
            </button>
          </form>

          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-base-300"></div>
            </div>
            <div class="relative flex justify-center">
              <span class="bg-base-200 px-3 text-xs text-base-content/50">新用户？</span>
            </div>
          </div>

          <A href="/register" class="btn btn-outline w-full h-11 font-semibold">
            创建新账号
          </A>
        </div>
      </div>
    </div>
  );
}
