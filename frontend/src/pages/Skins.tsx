import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Rail from '../components/Rail';
import Viewer from '../components/Viewer';
import { api, type Shape, type Texture, type TextureKind, type User } from '../lib/api';
import siteConfig from '../../site.config';

type Draft = { file: File; url: string };

const railItems = [
  { href: '/dashboard', label: '档案配置', note: '管理角色档案与纹理绑定', exact: true },
  { href: '/skins', label: '纹理库', note: '上传与预览皮肤、披风', exact: true },
];

export default function Skins() {
  const [member, setMember] = createSignal<User | null>(null);
  const [textures, setTextures] = createSignal<Texture[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');

  const [selected, setSelected] = createSignal<Texture | null>(null);
  const [previewShape, setPreviewShape] = createSignal<Shape>('default');

  const [uploadKind, setUploadKind] = createSignal<TextureKind>('skin');
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [deleting, setDeleting] = createSignal('');

  const navigate = useNavigate();

  const viewerSkin = createMemo(() => {
    const sel = selected();
    if (sel?.type === 'skin') return sel.url;
    const d = draft();
    if (d && uploadKind() === 'skin') return d.url;
    return siteConfig.defaultSkinUrl;
  });

  const viewerCape = createMemo(() => {
    const sel = selected();
    if (sel?.type === 'cape') return sel.url;
    const d = draft();
    if (d && uploadKind() === 'cape') return d.url;
    return null;
  });

  const canUpload = createMemo(() => Boolean(draft()));

  onMount(() => {
    if (!localStorage.getItem('token')) { navigate('/login'); return; }
    void load();
  });

  onCleanup(() => clearDraft(draft()));

  async function load() {
    setLoading(true);
    try {
      const [whoami, entries] = await Promise.all([api.auth.me(), api.skin.textures()]);
      setMember(whoami.data);
      setTextures(entries.data);
      const cur = selected();
      if (cur && !entries.data.find((texture) => texture.uuid === cur.uuid)) {
        setSelected(null);
      }
      setError('');
    } catch (err: any) {
      setError(err.message);
      if (err.message?.includes('Unauthorized') || err.message?.includes('Invalid')) {
        localStorage.removeItem('token');
        navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  }

  function clearDraft(value: Draft | null) {
    if (value) URL.revokeObjectURL(value.url);
  }

  function pickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) { input.value = ''; return; }
    if (file.type !== 'image/png') { setError('只支持 PNG 文件'); input.value = ''; return; }
    setError('');
    setSuccess('');
    clearDraft(draft());
    setDraft({ file, url: URL.createObjectURL(file) });
    setSelected(null);
    input.value = '';
  }

  function selectTexture(texture: Texture) {
    if (selected()?.uuid === texture.uuid) {
      setSelected(null);
      return;
    }
    setSelected(texture);
    clearDraft(draft());
    setDraft(null);
    setError('');
    setSuccess('');
  }

  async function uploadTexture() {
    if (!canUpload() || uploading()) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const uploaded = await api.skin.upload(draft()!.file, uploadKind());
      clearDraft(draft());
      setDraft(null);
      setSelected(uploaded.data);
      setSuccess(uploadKind() === 'skin' ? '皮肤已上传到纹理库' : '披风已上传到纹理库');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function deleteTexture(event: MouseEvent, texture: Texture) {
    event.stopPropagation();
    if (deleting()) return;
    setDeleting(texture.uuid);
    setError('');
    setSuccess('');
    try {
      await api.skin.deleteTexture(texture.uuid);
      if (selected()?.uuid === texture.uuid) {
        setSelected(null);
      }
      setSuccess('纹理已删除');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting('');
    }
  }

  const userCard = () => (
    <div class="rounded bg-primary px-4 py-4 text-white">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-white/20 bg-white/15 text-xl font-bold">
          {member()?.username.slice(0, 1).toUpperCase()}
        </div>
        <div class="min-w-0">
          <div class="truncate font-bold">{member()?.username}</div>
          <div class="truncate text-sm text-white/75">{member()?.email || '未绑定邮箱'}</div>
        </div>
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

        <div class="space-y-6">
          <div class="border-b border-slate-200 pb-4">
            <h1 class="text-2xl font-bold tracking-tight text-slate-800">纹理库</h1>
            <p class="mt-0.5 text-sm text-slate-500">管理皮肤与披风资源，档案绑定请在档案配置中完成。</p>
          </div>

          <Show when={error()}>
            <div class="rounded border border-error/25 bg-error/8 px-4 py-2.5 text-sm text-error">{error()}</div>
          </Show>
          <Show when={success()}>
            <div class="rounded border border-success/30 bg-success/8 px-4 py-2.5 text-sm text-success">{success()}</div>
          </Show>

          <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px] items-start">
            <div class="space-y-6">
              <section>
                <h2 class="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">已有纹理</h2>
                <Show
                  when={textures().length}
                  fallback={
                    <div class="rounded border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">
                      暂无纹理，请先上传皮肤或披风。
                    </div>
                  }
                >
                  <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    <For each={textures()}>
                      {(texture) => (
                        <article
                          role="button"
                          tabIndex={0}
                          class={`glass-panel overflow-hidden text-left transition-all ${selected()?.uuid === texture.uuid ? 'ring-2 ring-primary/40' : 'hover:bg-slate-50'}`}
                          onClick={() => selectTexture(texture)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              selectTexture(texture);
                            }
                          }}
                        >
                          <div class="flex h-20 items-center justify-center bg-slate-100">
                            <img src={texture.url} alt={texture.uuid} class="h-16 w-16 object-contain" style="image-rendering:pixelated" />
                          </div>
                          <div class="p-2.5">
                            <div class="flex items-center justify-between gap-1.5">
                              <span class={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${texture.type === 'skin' ? 'bg-primary/10 text-primary' : 'bg-slate-200 text-slate-600'}`}>
                                {texture.type}
                              </span>
                              <span class="truncate font-mono text-[10px] text-slate-300">{texture.uuid.slice(0, 12)}</span>
                            </div>
                            <button
                              type="button"
                              class="mt-2 text-[11px] font-bold text-error disabled:text-slate-300"
                              disabled={deleting() === texture.uuid}
                              onClick={(event) => void deleteTexture(event, texture)}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              {deleting() === texture.uuid ? '删除中' : '删除'}
                            </button>
                          </div>
                        </article>
                      )}
                    </For>
                  </div>
                </Show>
              </section>

              <section class="glass-panel p-5 space-y-4">
                <div>
                  <h2 class="font-bold text-slate-800">上传新纹理</h2>
                  <p class="mt-0.5 text-xs text-slate-500">选择 PNG 文件后在右侧实时预览，确认后加入纹理库。</p>
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">纹理类型</label>
                  <div class="grid grid-cols-2 gap-2">
                    {(['skin', 'cape'] as const).map((texture) => (
                      <button
                        type="button"
                        class={`rounded border py-2 text-sm font-semibold transition-colors ${uploadKind() === texture ? 'border-primary/25 bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        onClick={() => setUploadKind(texture)}
                      >
                        {texture === 'skin' ? '皮肤' : '披风'}
                      </button>
                    ))}
                  </div>
                </div>

                <input type="file" accept="image/png" class="file-input glass-input w-full" onChange={pickFile} />

                <button
                  type="button" class="btn btn-primary w-full text-white"
                  onClick={() => void uploadTexture()}
                  disabled={!canUpload() || uploading()}
                >
                  <Show when={uploading()}><span class="loading loading-spinner loading-xs mr-1"></span></Show>
                  {uploading() ? '上传中…' : '上传到纹理库'}
                </button>
              </section>
            </div>

            <div class="space-y-3">
              <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400">实时预览</h2>
              <div class="relative overflow-hidden rounded-lg border border-slate-900/80 bg-[radial-gradient(circle_at_top,rgba(87,124,255,0.28),transparent_34%),radial-gradient(circle_at_bottom,rgba(56,189,248,0.18),transparent_30%),linear-gradient(180deg,#0f172a_0%,#020617_100%)]">
                <div class="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-white/50">
                  <span>Drag · Orbit</span>
                  <span>Wheel · Zoom</span>
                </div>
                <div class="h-96">
                  <Viewer shape={previewShape()} skin={viewerSkin()} cape={viewerCape()} />
                </div>
                <div class="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/30 px-4 py-2 text-xs text-white/50 backdrop-blur-sm">
                  {selected()
                    ? `${selected()!.type} · ${selected()!.uuid.slice(0, 12)}…`
                    : draft()
                    ? `本地预览 · ${draft()!.file.name}`
                    : '选择已有纹理或上传新文件以预览'
                  }
                </div>
              </div>

              <Show when={selected()?.type === 'skin' || (draft() && uploadKind() === 'skin')}>
                <div>
                  <label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">预览模型</label>
                  <div class="grid grid-cols-2 gap-2">
                    {(['default', 'slim'] as const).map((shape) => (
                      <button
                        type="button"
                        class={`rounded border py-1.5 text-xs font-semibold transition-colors ${previewShape() === shape ? 'border-primary/25 bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        onClick={() => setPreviewShape(shape)}
                      >
                        {shape === 'default' ? 'Steve' : 'Alex'}
                      </button>
                    ))}
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
