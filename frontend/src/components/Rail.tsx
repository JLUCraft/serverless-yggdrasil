import { A, useLocation } from '@solidjs/router';
import { For, Show, createSignal, type JSX } from 'solid-js';

type Entry = {
  href: string;
  label: string;
  note?: string;
  exact?: boolean;
};

type RailProps = {
  title: string;
  note?: string;
  top?: JSX.Element;
  items: Entry[];
};

export default function Rail(props: RailProps) {
  const location = useLocation();
  const [expanded, setExpanded] = createSignal(false);

  const isActive = (entry: Entry) =>
    entry.exact ? location.pathname === entry.href : location.pathname.startsWith(entry.href);

  const activeLabel = () => props.items.find(isActive)?.label;

  return (
    <aside class="glass-panel lg:sticky lg:top-[62px] overflow-hidden">
      {/* Mobile toggle — always visible on small screens */}
      <button
        class="lg:hidden w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div class="min-w-0">
          <div class="text-sm font-bold text-slate-800">{props.title}</div>
          <div class="text-xs text-slate-500 mt-0.5 truncate">{activeLabel() ?? props.note}</div>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class={`w-4 h-4 text-slate-400 shrink-0 ml-2 transition-transform duration-200 ${expanded() ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Sidebar body — always visible on desktop, toggled on mobile */}
      <div class={`${expanded() ? 'block' : 'hidden'} lg:block p-4 lg:p-5 border-t border-slate-100 lg:border-t-0 space-y-4`}>
        <div class="hidden lg:block">
          <h2 class="text-xs font-bold tracking-widest text-slate-500 uppercase">{props.title}</h2>
          {props.note && <p class="mt-1 text-xs text-slate-400">{props.note}</p>}
        </div>

        <Show when={props.top}>
          {props.top}
        </Show>

        <nav class="space-y-0.5">
          <For each={props.items}>
            {(entry) => (
              <A
                href={entry.href}
                class={`flex flex-col px-3 py-2.5 rounded transition-colors text-sm border-l-2 ${isActive(entry)
                    ? 'bg-primary/10 text-primary border-primary'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-transparent'
                  }`}
              >
                <span class="font-semibold leading-none">{entry.label}</span>
                {entry.note && <span class="mt-1 text-xs text-slate-400 leading-snug">{entry.note}</span>}
              </A>
            )}
          </For>
        </nav>
      </div>
    </aside>
  );
}
