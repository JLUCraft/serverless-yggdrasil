import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Rail from '../components/Rail';
import Viewer from '../components/Viewer';
import { api, forgetLogin, authRejected, type Profile, type Shape, type Texture, type TextureKind, type User } from '../lib/api';
import siteConfig from '../../../site.config.json';

type Draft = { file: File; url: string; kind: TextureKind };

function readShape(v: string): Shape | null {
  return v === 'default' || v === 'slim' ? v : null;
}

const railItems = [
  { href: '/dashboard', label: '档案配置', note: '管理角色档案与纹理绑定', exact: true },
  { href: '/skins', label: '纹理库', note: '上传与预览皮肤、披风', exact: true },
  { href: '/premium', label: '正版绑定', note: '绑定微软正版账号', exact: true },
];

export default function Dashboard() {
  const [member, setMember] = createSignal<User | null>(null);
  const [profiles, setProfiles] = createSignal<Profile[]>([]);
  const [textures, setTextures] = createSignal<Texture[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');


  const [draftName, setDraftName] = createSignal('');
  const [draftModel, setDraftModel] = createSignal<'' | Shape>('');
  const [creating, setCreating] = createSignal(false);
  const [showCreate, setShowCreate] = createSignal(false);


  const [target, setTarget] = createSignal('');
  const [kind, setKind] = createSignal<TextureKind>('skin');
  const [shape, setShape] = createSignal<'' | Shape>('');
  const [skinDraft, setSkinDraft] = createSignal<Draft | null>(null);
  const [capeDraft, setCapeDraft] = createSignal<Draft | null>(null);
  const [chosen, setChosen] = createSignal('');
  const [uploading, setUploading] = createSignal(false);

  const navigate = useNavigate();

  const active = createMemo(() => profiles().find((p) => p.id === target()) ?? null);
  const picked = createMemo(() => textures().find((texture) => texture.uuid === chosen() && texture.type === kind()) ?? null);
  const choices = createMemo(() => textures().filter((texture) => texture.type === kind()));
  const activeShape = createMemo<'' | Shape>(() => {
    if (shape()) return shape() as Shape;
    const cur = active();
    if (!cur) return '';
    return readShape(cur.model) ?? '';
  });
  const previewSkin = createMemo(() => {
    if (skinDraft()) return skinDraft()!.url;
    if (kind() === 'skin' && picked()) return picked()!.url;
    return active()?.skin?.url ?? siteConfig.defaultSkinUrl;
  });
  const previewCape = createMemo(() => {
    if (capeDraft()) return capeDraft()!.url;
    if (kind() === 'cape' && picked()) return picked()!.url;
    return active()?.cape?.url ?? null;
  });
  const canCommit = createMemo(() => {
    if (!target()) return false;
    if (kind() === 'skin') return Boolean((skinDraft() || picked()) && activeShape());
    if (kind() === 'cape') return Boolean(capeDraft() || picked());
    return false;
  });

  onMount(() => {
    void load();
  });

  onCleanup(() => {
    clearDraft(skinDraft());
    clearDraft(capeDraft());
  });

  async function load() {
    setLoading(true);
    try {
      const [whoami, entries, stored] = await Promise.all([api.auth.me(), api.skin.profiles(), api.skin.textures()]);
      setMember(whoami.data);
      setProfiles(entries.data);
      setTextures(stored.data);
      if (entries.data.length === 0) setShowCreate(true);
      const cur = target();
      if (cur && !entries.data.find((p) => p.id === cur)) setTarget('');
      const texture = chosen();
      if (texture && !stored.data.find((item) => item.uuid === texture)) setChosen('');
      setError('');
    } catch (err: any) {
      setError(err.message);
      if (authRejected(err.message)) {
        forgetLogin();
        navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  }

  async function createProfile(event: Event) {
    event.preventDefault();
    if (!draftName() || !draftModel()) return;
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const created = await api.skin.createProfile(draftName(), draftModel() as Shape);
      const newModel = draftModel() as Shape;
      setDraftName('');
      setDraftModel('');
      setSuccess('档案已创建');
      setShowCreate(false);
      await load();
      setTarget(created.data.id);
      setShape(newModel);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function selectProfile(id: string) {
    if (target() === id) { setTarget(''); return; }
    setTarget(id);
    const p = profiles().find((e) => e.id === id);
    if (p) { const m = readShape(p.model); if (m) setShape(m); }
    clearDraft(skinDraft()); setSkinDraft(null);
    clearDraft(capeDraft()); setCapeDraft(null);
    setChosen('');
    setKind('skin');
    setError('');
    setSuccess('');
  }

  function clearDraft(d: Draft | null) { if (d) URL.revokeObjectURL(d.url); }

  function setTexture(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) { input.value = ''; return; }
    if (file.type !== 'image/png') { setError('只支持 PNG 文件'); input.value = ''; return; }
    setError('');
    setSuccess('');
    const k = kind();
    const next: Draft = { file, url: URL.createObjectURL(file), kind: k };
    if (k === 'skin') { clearDraft(skinDraft()); setSkinDraft(next); }
    else { clearDraft(capeDraft()); setCapeDraft(next); }
    setChosen('');
    input.value = '';
  }

  function discard(k: TextureKind) {
    if (k === 'skin') { clearDraft(skinDraft()); setSkinDraft(null); }
    else { clearDraft(capeDraft()); setCapeDraft(null); }
  }

  function chooseTexture(uuid: string) {
    setChosen(chosen() === uuid ? '' : uuid);
    discard(kind());
    setError('');
    setSuccess('');
  }

  async function commit() {
    if (!canCommit() || uploading()) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      if (kind() === 'skin') {
        const model = activeShape() as Shape;
        const uuid = skinDraft() ? (await api.skin.upload(skinDraft()!.file, 'skin')).data.uuid : chosen();
        await api.skin.assignTextures(target(), { skin_texture_uuid: uuid, model });
        discard('skin');
        setSuccess('皮肤已绑定到档案');
      } else {
        const uuid = capeDraft() ? (await api.skin.upload(capeDraft()!.file, 'cape')).data.uuid : chosen();
        await api.skin.assignTextures(target(), { cape_texture_uuid: uuid });
        discard('cape');
        setSuccess('披风已绑定到档案');
      }
      setChosen('');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const userCard = () => (
    <div class="rounded bg-primary px-4 py-4 text-white">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-white/20 bg-base-100/15 text-xl font-bold">
          {member()?.username.slice(0, 1).toUpperCase()}
        </div>
        <div class="min-w-0">
          <div class="truncate font-bold">{member()?.username}</div>
          <div class="truncate text-sm text-white/75">{member()?.email || '未绑定邮箱'}</div>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold uppercase">
        <span class="rounded-full bg-base-100/15 px-2.5 py-0.5">{member()?.role}</span>
        <span class="rounded-full bg-base-100/15 px-2.5 py-0.5">{member()?.status}</span>
      </div>
    </div>
  );

  return (
    <div class="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] items-start animate-fade-in">
      <Show when={loading()}>
        <div class="lg:col-span-2 flex justify-center py-32">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
      </Show>

      <Show when={!loading() && member()}>
        <Rail title="我的账户" top={userCard()} items={railItems} />

        <div class="space-y-5">
          {}
          <div class="flex items-center justify-between border-b border-base-300 pb-4">
            <div>
              <h1 class="text-2xl font-bold tracking-tight text-base-content">档案配置</h1>
              <p class="mt-0.5 text-sm text-base-content/60">
                通行证 <span class="font-mono">{member()?.uuid}</span>
                {member()?.club && <span class="ml-2 text-base-content/50">· {member()?.club}</span>}
              </p>
            </div>
            <button class="btn btn-primary btn-sm text-white" onClick={() => setShowCreate((v) => !v)}>
              {showCreate() ? '取消' : '+ 新建档案'}
            </button>
          </div>

          {}
          <Show when={error()}>
            <div class="rounded border border-error/25 bg-error/8 px-4 py-2.5 text-sm text-error">{error()}</div>
          </Show>
          <Show when={success()}>
            <div class="rounded border border-success/30 bg-success/8 px-4 py-2.5 text-sm text-success">{success()}</div>
          </Show>

          {}
          <Show when={showCreate()}>
            <div class="glass-panel p-5">
              <h2 class="mb-4 font-bold text-base-content">新建档案</h2>
              <form onSubmit={createProfile} class="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-base-content/60">档案名称</label>
                  <input
                    type="text" class="input glass-input w-full" placeholder="3–16 个字符"
                    value={draftName()} onInput={(e) => setDraftName(e.currentTarget.value)}
                    required minLength={3} maxLength={16}
                  />
                </div>
                <div>
                  <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-base-content/60">角色模型</label>
                  <select
                    class="select glass-input w-full" value={draftModel()}
                    onChange={(e) => setDraftModel(e.currentTarget.value as '' | Shape)} required
                  >
                    <option value="" disabled>请选择模型</option>
                    <option value="default">默认臂宽（Steve）</option>
                    <option value="slim">纤细臂宽（Alex）</option>
                  </select>
                </div>
                <div class="flex items-end">
                  <button type="submit" class="btn btn-primary w-full text-white" disabled={creating()}>
                    <Show when={creating()}><span class="loading loading-spinner loading-xs mr-1"></span></Show>
                    创建
                  </button>
                </div>
              </form>
            </div>
          </Show>

          {}
          <Show when={!profiles().length && !showCreate()}>
            <div class="rounded border border-dashed border-base-300 bg-base-200 px-6 py-16 text-center">
              <p class="text-sm text-base-content/60">还没有任何档案</p>
              <button class="mt-3 text-sm font-semibold text-primary hover:underline" onClick={() => setShowCreate(true)}>
                创建第一个档案 →
              </button>
            </div>
          </Show>

          {}
          <Show when={profiles().length > 0}>
            <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] items-start">

              {}
              <div class="space-y-2">
                <For each={profiles()}>
                  {(entry) => {
                    const selected = () => target() === entry.id;
                    return (
                      <article
                        class={`glass-panel cursor-pointer overflow-hidden transition-all ${selected() ? 'ring-2 ring-primary/40' : 'hover:bg-base-200'}`}
                        onClick={() => selectProfile(entry.id)}
                      >
                        <div class="flex items-center gap-4 p-4">
                          <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-base-300 bg-base-200">
                            <Show
                              when={entry.skin}
                              fallback={<span class="text-xl font-black text-base-content/40">{entry.name.slice(0, 2).toUpperCase()}</span>}
                            >
                              <img src={entry.skin!.url} alt={entry.name} class="h-full w-full object-contain" style="image-rendering:pixelated" />
                            </Show>
                          </div>
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-3">
                              <h3 class="truncate font-bold text-base-content">{entry.name}</h3>
                              <span class="shrink-0 rounded bg-base-200 px-2 py-0.5 font-mono text-xs text-base-content/60">{entry.model}</span>
                            </div>
                            <div class="mt-2 flex gap-2">
                              <span class={`rounded px-2 py-1 text-xs font-semibold ${entry.skin ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/50'}`}>
                                皮肤 {entry.skin ? '✓' : '—'}
                              </span>
                              <span class={`rounded px-2 py-1 text-xs font-semibold ${entry.cape ? 'bg-primary/10 text-primary' : 'bg-base-200 text-base-content/50'}`}>
                                披风 {entry.cape ? '✓' : '—'}
                              </span>
                            </div>
                          </div>
                          <svg xmlns="http://www.w3.org/2000/svg" class={`h-4 w-4 shrink-0 transition-colors ${selected() ? 'text-primary' : 'text-base-content/30'}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                          </svg>
                        </div>
                      </article>
                    );
                  }}
                </For>
              </div>

              {}
              <Show
                when={active()}
                fallback={
                  <div class="glass-panel flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-base-content/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    <p class="text-sm font-semibold text-base-content/70">选择一个档案</p>
                    <p class="text-xs text-base-content/50">开始配置皮肤与披风</p>
                  </div>
                }
              >
                <div class="space-y-3">
                  {}
                  <div class="relative overflow-hidden rounded-lg border border-slate-900/80 bg-[radial-gradient(circle_at_top,rgba(87,124,255,0.28),transparent_34%),radial-gradient(circle_at_bottom,rgba(56,189,248,0.18),transparent_30%),linear-gradient(180deg,#0f172a_0%,#020617_100%)]">
                    <div class="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-white/50">
                      <span>Drag · Orbit</span>
                      <span>Wheel · Zoom</span>
                    </div>
                    <Show
                      when={active() && activeShape()}
                      fallback={<div class="flex h-72 items-center justify-center text-sm text-white/40">模型未识别</div>}
                    >
                      <div class="h-72">
                        <Viewer shape={activeShape() as Shape} skin={previewSkin()} cape={previewCape()} />
                      </div>
                    </Show>
                    <div class="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/10 bg-black/30 px-4 py-2 text-sm backdrop-blur-sm">
                      <span class="font-bold text-white/80">{active()?.name}</span>
                      <span class="text-xs text-white/40">{activeShape() || '—'}</span>
                    </div>
                  </div>

                  {}
                  <div class="glass-panel p-4 space-y-4">
                    <div class="flex items-center justify-between">
                      <h3 class="font-bold text-base-content">配置纹理</h3>
                      <span class="text-[11px] text-base-content/50">从纹理库选择或上传</span>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                      {(['skin', 'cape'] as const).map((k) => (
                        <button
                          type="button"
                          class={`rounded border py-2 text-sm font-semibold transition-colors ${kind() === k ? 'border-primary/25 bg-primary/10 text-primary' : 'border-base-300 bg-base-100 text-base-content/70 hover:bg-base-200'}`}
                          onClick={() => {
                            setKind(k);
                            setChosen('');
                          }}
                        >
                          {k === 'skin' ? '皮肤' : '披风'}
                        </button>
                      ))}
                    </div>

                    <Show when={kind() === 'skin'}>
                      <select class="select glass-input w-full" value={shape()} onChange={(e) => setShape(e.currentTarget.value as '' | Shape)}>
                        <option value="" disabled>请选择模型</option>
                        <option value="default">默认（Steve）</option>
                        <option value="slim">纤细（Alex）</option>
                      </select>
                    </Show>

                    <div>
                      <div class="mb-2 flex items-center justify-between">
                        <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">纹理库</span>
                        <span class="text-[11px] text-base-content/50">{choices().length} 个可选</span>
                      </div>
                      <Show
                        when={choices().length}
                        fallback={
                          <div class="rounded border border-dashed border-base-300 bg-base-200 px-3 py-5 text-center text-xs text-base-content/50">
                            纹理库暂无此类型资源
                          </div>
                        }
                      >
                        <div class="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1">
                          <For each={choices()}>
                            {(texture) => (
                              <button
                                type="button"
                                class={`overflow-hidden rounded border bg-base-100 transition-colors ${chosen() === texture.uuid ? 'border-primary ring-2 ring-primary/20' : 'border-base-300 hover:bg-base-200'}`}
                                onClick={() => chooseTexture(texture.uuid)}
                              >
                                <div class="flex h-16 items-center justify-center bg-base-200">
                                  <img src={texture.url} alt={texture.uuid} class="h-12 w-12 object-contain" style="image-rendering:pixelated" />
                                </div>
                                <div class="truncate px-1.5 py-1 font-mono text-[10px] text-base-content/50">{texture.uuid.slice(0, 8)}</div>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>

                    <div class="rounded border border-base-300 bg-base-200 px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <span class="min-w-0 truncate text-xs text-base-content/60">
                          {kind() === 'skin'
                            ? (skinDraft()?.file.name ?? picked()?.uuid ?? active()?.skin?.uuid ?? '未设置')
                            : (capeDraft()?.file.name ?? picked()?.uuid ?? active()?.cape?.uuid ?? '未设置')
                          }
                        </span>
                        <Show when={(kind() === 'skin' ? skinDraft() : capeDraft()) || picked()}>
                          <button
                            type="button"
                            class="shrink-0 text-xs font-bold text-error"
                            onClick={() => {
                              discard(kind());
                              setChosen('');
                            }}
                          >
                            撤销
                          </button>
                        </Show>
                      </div>
                    </div>

                    <input
                      type="file" accept="image/png" class="file-input glass-input w-full"
                      onChange={setTexture}
                      disabled={kind() === 'skin' && !activeShape()}
                    />

                    <button
                      type="button" class="btn btn-primary w-full text-white"
                      onClick={() => void commit()}
                      disabled={!canCommit() || uploading()}
                    >
                      <Show when={uploading()}><span class="loading loading-spinner loading-xs mr-1"></span></Show>
                      {uploading() ? '提交中…' : '提交并绑定到档案'}
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
