import { For, Show, createSignal, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Rail from '../components/Rail';
import { api } from '../lib/api';

type Member = {
  uuid: string;
  username: string;
  email: string | null;
  role: 'guest' | 'member' | 'admin';
  status: string;
  created_at: number;
};

export default function Users() {
  const [members, setMembers] = createSignal<Member[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');
  const navigate = useNavigate();

  onMount(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
      return;
    }
    void loadUsers();
  });

  async function loadUsers() {
    setLoading(true);
    try {
      const response = await api.users.list();
      setMembers(response.data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(uuid: string, role: Member['role']) {
    try {
      await api.users.changeRole(uuid, role);
      setSuccess('用户角色已更新');
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div class="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] animate-fade-in">
      <Show when={loading()}>
        <div class="lg:col-span-2 flex justify-center py-32">
          <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
      </Show>

      <Show when={!loading()}>
        <Rail
          title="管理控制台"
          note="配置站点互通与用户权限。"
          items={[
            { href: '/admin', label: '节点互通', note: '本站配置与外部信任节点', exact: true },
            { href: '/admin/users', label: '用户管理', note: '查看与调整账号角色', exact: true },
          ]}
        />

        <div class="space-y-6">
          <div class="border-b border-slate-200 pb-4">
            <h1 class="text-3xl font-extrabold tracking-tight text-slate-800">用户管理</h1>
            <p class="mt-2 text-sm text-slate-500">独立查看用户列表，并在这里调整角色。</p>
          </div>

          <Show when={error()}>
            <div class="alert alert-error border border-error/25 bg-error/8 text-sm">
              <span>{error()}</span>
            </div>
          </Show>

          <Show when={success()}>
            <div class="alert alert-success border border-success/30 bg-success/8 text-sm">
              <span>{success()}</span>
            </div>
          </Show>

          <div class="glass-panel p-6">
            <div class="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div class="text-sm text-slate-500">共 {members().length} 人</div>
            </div>

            <div class="mt-6 overflow-hidden rounded border border-slate-200 bg-white">
              <table class="table w-full">
                <thead class="text-slate-700">
                  <tr>
                    <th>UUID</th>
                    <th>用户名</th>
                    <th>邮箱</th>
                    <th>状态</th>
                    <th>注册时间</th>
                    <th>角色</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={members().length}
                    fallback={
                      <tr>
                        <td colSpan={6} class="py-10 text-center text-sm text-slate-500">
                          当前没有可展示的用户。
                        </td>
                      </tr>
                    }
                  >
                    <For each={members()}>
                      {(entry) => (
                        <tr class="border-t border-slate-100 hover:bg-slate-50">
                          <td class="font-mono text-xs text-slate-500">{entry.uuid}</td>
                          <td class="font-semibold text-slate-800">{entry.username}</td>
                          <td class="text-sm text-slate-600">{entry.email || '-'}</td>
                          <td>
                            <span class={`rounded-full px-3 py-1 text-xs font-bold ${entry.status === 'active' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>
                              {entry.status}
                            </span>
                          </td>
                          <td class="text-sm text-slate-500">{new Date(entry.created_at * 1000).toLocaleDateString()}</td>
                          <td>
                            <select
                              class="select glass-input select-sm min-w-28 text-sm"
                              value={entry.role}
                              onChange={(event) => void changeRole(entry.uuid, event.currentTarget.value as Member['role'])}
                            >
                              <option value="guest">Guest</option>
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
