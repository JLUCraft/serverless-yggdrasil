import { createSignal, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../lib/api';

export default function Premium() {
  const [status, setStatus] = createSignal<any>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal(false);
  const navigate = useNavigate();

  onMount(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
      return;
    }
    loadStatus();
  });

  async function loadStatus() {
    try {
      const res = await api.premium.status();
      setStatus(res.data);
    } catch (err: any) {
      setError(err.message);
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

  return (
    <div class="max-w-2xl mx-auto">
      <h1 class="text-3xl font-bold mb-6">正版账号绑定</h1>

      <Show when={loading()}>
        <div class="flex justify-center py-20"><span class="loading loading-spinner loading-lg text-primary"></span></div>
      </Show>

      <Show when={!loading()}>
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
      </Show>
    </div>
  );
}
