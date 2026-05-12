import { Show, createSignal, createEffect } from 'solid-js';
import { A, useLocation, type RouteSectionProps } from '@solidjs/router';
import { account, loadAccount, logout } from '../lib/api';
import siteConfig from '../../../site.config.json';
import { themeMode, setTheme, type ThemeMode } from '../lib/theme';

function ThemeToggle() {
  const [open, setOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;


  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  });

  const options: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'light', label: '浅色', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
    { mode: 'dark', label: '深色', icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' },
    { mode: 'system', label: '跟随系统', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  ];

  return (
    <div class="relative" ref={containerRef}>
      <button
        class="p-1.5 rounded text-base-content/70 hover:bg-base-200 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-label="主题"
        title="切换主题"
      >
        <Show
          when={themeMode() === 'dark'}
          fallback={
            <Show
              when={themeMode() === 'light'}
              fallback={
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </Show>
          }
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        </Show>
      </button>

      <Show when={open()}>
        <div class="absolute right-0 mt-2 w-32 rounded-md border border-base-300 bg-base-100 shadow-panel-md py-1 z-50">
          {options.map((opt) => (
            <button
              class={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                themeMode() === opt.mode
                  ? 'text-primary bg-primary/10 font-medium'
                  : 'text-base-content hover:bg-base-200'
              }`}
              onClick={() => {
                setTheme(opt.mode);
                setOpen(false);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d={opt.icon} />
              </svg>
              {opt.label}
            </button>
          ))}
        </div>
      </Show>
    </div>
  );
}

export default function Layout(props: RouteSectionProps) {
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const location = useLocation();

  createEffect(() => {
    location.pathname;
    void loadAccount();
  });


  createEffect(() => {
    location.pathname;
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
                <A href="/dashboard" class="px-3 py-1.5 text-sm rounded hover:bg-base-200 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                  我的档案
                </A>
                <Show when={account()?.role === 'admin'}>
                  <A href="/admin" class="px-3 py-1.5 text-sm rounded hover:bg-base-200 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                    管理
                  </A>
                </Show>
              </nav>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <ThemeToggle />

              <Show
                when={account()}
                fallback={
                  <A href="/login" class="text-sm px-4 py-1.5 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary hover:text-primary-content transition-colors">
                    登录
                  </A>
                }
              >
                <div class="hidden sm:flex items-center gap-3 bg-base-200 border border-base-300 px-3 py-1.5 rounded text-sm">
                  <span class="font-medium text-base-content max-w-[120px] truncate">{account()?.username}</span>
                  <span class="text-base-content/30 select-none">|</span>
                  <button onClick={logout} class="text-xs font-medium text-base-content/60 hover:text-error transition-colors">
                    退出
                  </button>
                </div>
              </Show>

              {}
              <button
                class="md:hidden p-1.5 rounded text-base-content/70 hover:bg-base-200 transition-colors"
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

          {}
          <Show when={mobileOpen()}>
            <div class="md:hidden border-t border-base-200 bg-base-100 px-4 py-3 space-y-0.5">
              <A href="/dashboard" class="flex items-center px-3 py-2 text-sm rounded hover:bg-base-200 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                我的档案
              </A>
              <Show when={account()?.role === 'admin'}>
                <A href="/admin" class="flex items-center px-3 py-2 text-sm rounded hover:bg-base-200 transition-colors" activeClass="bg-primary/10 text-primary font-semibold">
                  管理
                </A>
              </Show>
              <Show when={account()}>
                <div class="border-t border-base-200 mt-1 pt-2 px-3 flex items-center justify-between text-sm">
                  <span class="font-medium text-base-content">{account()?.username}</span>
                  <button onClick={logout} class="text-xs font-medium text-base-content/60 hover:text-error transition-colors">
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
