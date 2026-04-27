import { Show, createSignal, createEffect } from 'solid-js';
import { A, useLocation, type RouteSectionProps } from '@solidjs/router';
import { api, logout } from '../lib/api';
import siteConfig from '../../site.config.ts';

export default function Layout(props: RouteSectionProps) {
  const [user, setUser] = createSignal<{ username: string; role: string } | null>(null);
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const location = useLocation();

  createEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.auth.me()
        .then((res) => setUser({ username: res.data.username, role: res.data.role }))
        .catch(() => {
          localStorage.removeItem('token');
          setUser(null);
        });
    }
  });

  // Close mobile menu on navigation
  createEffect(() => {
    location.pathname; // track for reactivity
    setMobileOpen(false);
  });

  const isAuthPage = () => location.pathname === '/login' || location.pathname === '/register';

  return (
    <div class="min-h-screen text-base-content flex flex-col font-sans">
      <Show when={!isAuthPage()}>
        <header class="glass-header">
          <div class="container mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <div class="flex items-center gap-5 min-w-0">
              <A href="/" class="text-base font-bold tracking-tight text-primary flex items-center gap-2 shrink-0 hover:opacity-75 transition-opacity">
                <img src={siteConfig.logoUrl} alt={siteConfig.shortName} class="w-6 h-6 rounded object-contain" />
                <span class="hidden sm:inline">{siteConfig.shortName}</span>
              </A>
              <nav class="hidden md:flex items-center gap-0.5">
                <A href="/dashboard" class="px-3 py-1.5 text-sm rounded hover:bg-slate-100 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                  我的档案
                </A>
                <Show when={user()?.role === 'admin'}>
                  <A href="/admin" class="px-3 py-1.5 text-sm rounded hover:bg-slate-100 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                    管理
                  </A>
                </Show>
              </nav>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <Show
                when={user()}
                fallback={
                  <A href="/login" class="text-sm px-4 py-1.5 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary hover:text-white transition-colors">
                    登录
                  </A>
                }
              >
                <div class="hidden sm:flex items-center gap-3 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded text-sm">
                  <span class="font-medium text-slate-700 max-w-[120px] truncate">{user()?.username}</span>
                  <span class="text-slate-300 select-none">|</span>
                  <button onClick={logout} class="text-xs font-medium text-slate-500 hover:text-error transition-colors">
                    退出
                  </button>
                </div>
              </Show>

              {/* Mobile hamburger */}
              <button
                class="md:hidden p-1.5 rounded text-slate-600 hover:bg-slate-100 transition-colors"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label="菜单"
              >
                <Show
                  when={mobileOpen()}
                  fallback={
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  }
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Show>
              </button>
            </div>
          </div>

          {/* Mobile dropdown menu */}
          <Show when={mobileOpen()}>
            <div class="md:hidden border-t border-slate-100 bg-white px-4 py-3 space-y-0.5">
              <A href="/dashboard" class="flex items-center px-3 py-2 text-sm rounded hover:bg-slate-50 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                我的档案
              </A>
              <Show when={user()?.role === 'admin'}>
                <A href="/admin" class="flex items-center px-3 py-2 text-sm rounded hover:bg-slate-50 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                  管理
                </A>
              </Show>
              <Show when={user()}>
                <div class="border-t border-slate-100 mt-1 pt-2 px-3 flex items-center justify-between text-sm">
                  <span class="font-medium text-slate-700">{user()?.username}</span>
                  <button onClick={logout} class="text-xs font-medium text-slate-500 hover:text-error transition-colors">
                    退出
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </header>
      </Show>

      <main class={`flex-1 flex flex-col ${isAuthPage() ? '' : 'container mx-auto px-4 sm:px-6 py-6 sm:py-8'}`}>
        {props.children}
      </main>
    </div>
  );
}
