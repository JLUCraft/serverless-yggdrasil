import { createSignal, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Rail from '../components/Rail';
import { api, forgetLogin, authRejected, type User } from '../lib/api';

const railItems = [
  { href: '/dashboard', label: '档案配置', note: '管理角色档案与纹理绑定', exact: true },
  { href: '/skins', label: '纹理库', note: '上传与预览皮肤、披风', exact: true },
  { href: '/premium', label: '正版绑定', note: '绑定微软正版账号', exact: true },
];

export default function Premium() {
  const [member, setMember] = createSignal<User | null>(null);
  const [status, setStatus] = createSignal<any>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal(false);

  const navigate = useNavigate();

  onMount(() => {
    void load();
  });

  async function load() {
    try {
      const [whoami, res] = await Promise.all([api.auth.me(), api.premium.status()]);
      setMember(whoami.data);
      setStatus(res.data);
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

  async function bind() {
    setActionLoading(true);
    try {
      const res = await api.premium.bind();
      window.location.href = res.data.auth_url;
    } catch (err: any) {
      setError(err.message);
      setActionLoading(false);
    }
  }

  async function unbind() {
    if (!confirm('确定要解绑正版账号吗？')) return;
    setActionLoading(true);
    try {
      await api.premium.unbind();
      setStatus({ bound: false });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
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

        <div class="max-w-2xl">
          <h1 class="text-3xl font-bold mb-6">正版账号绑定</h1>

          <Show when={error()}>
            <div class="alert alert-error mb-4"><span>{error()}</span></div>
          </Show>

          <Show when={status()?.bound}>
            <div class="card bg-base-200 shadow-xl">
              <div class="card-body">
                <div class="flex items-center gap-3 mb-4">
                  <div class="badge badge-success badge-lg">已绑定</div>
                </div>

                <div class="space-y-3">
                  <div class="flex justify-between items-center py-2 border-b border-base-300">
                    <span class="text-base-content/60">Minecraft ID</span>
                    <span class="font-bold">{status().minecraft_name}</span>
                  </div>
                  <div class="flex justify-between items-center py-2 border-b border-base-300">
                    <span class="text-base-content/60">Minecraft UUID</span>
                    <span class="font-mono text-sm">{status().minecraft_uuid}</span>
                  </div>
                  <div class="flex justify-between items-center py-2">
                    <span class="text-base-content/60">绑定时间</span>
                    <span>{status().bound_at ? new Date(status().bound_at * 1000).toLocaleString() : '-'}</span>
                  </div>
                </div>

                <div class="card-actions justify-end mt-6">
                  <button class="btn btn-error" onClick={unbind} disabled={actionLoading()}>
                    <Show when={actionLoading()}>
                      <span class="loading loading-spinner loading-xs"></span>
                    </Show>
                    解绑
                  </button>
                </div>
              </div>
            </div>
          </Show>

          <Show when={!status()?.bound}>
            <div class="card bg-base-200 shadow-xl">
              <div class="card-body">
                <div class="flex items-center gap-3 mb-4">
                  <div class="badge badge-ghost badge-lg">未绑定</div>
                </div>

                <p class="text-base-content/70 mb-6">
                  绑定微软正版账号后，你的 Minecraft UUID 将与正版一致，支持通过微软 OAuth 直接登录皮肤站。
                </p>

                <div class="alert alert-info mb-4">
                  <span>绑定流程：点击按钮 → 微软登录授权 → 自动完成绑定</span>
                </div>

                <button class="btn btn-primary w-full" onClick={bind} disabled={actionLoading()}>
                  <Show when={actionLoading()}>
                    <span class="loading loading-spinner loading-xs"></span>
                  </Show>
                  绑定微软账号
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
