import { For, Show, createSignal, onMount } from 'solid-js';
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

  onMount(() => {
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

        <div class="space-y-6 min-w-0">
          <div class="border-b border-base-300 pb-4">
            <h1 class="text-3xl font-extrabold tracking-tight">用户管理</h1>
            <p class="mt-2 text-sm text-base-content/60">独立查看用户列表，并在这里调整角色。</p>
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

          <div class="glass-panel p-4 sm:p-6">
            <div class="flex flex-col gap-3 border-b border-base-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div class="text-sm text-base-content/60">共 {members().length} 人</div>
            </div>

            {}
            <div class="hidden md:block mt-6 overflow-x-auto rounded border border-base-300">
              <table class="table w-full">
                <thead>
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
                        <td colSpan={6} class="py-10 text-center text-sm text-base-content/60">
                          当前没有可展示的用户。
                        </td>
                      </tr>
                    }
                  >
                    <For each={members()}>
                      {(entry) => (
                        <tr class="border-t border-base-200 hover:bg-base-200/50">
                          <td class="font-mono text-xs text-base-content/50">{entry.uuid}</td>
                          <td class="font-semibold">{entry.username}</td>
                          <td class="text-sm text-base-content/70">{entry.email || '-'}</td>
                          <td>
                            <span class={`rounded-full px-3 py-1 text-xs font-bold ${entry.status === 'active' ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/60'}`}>
                              {entry.status}
                            </span>
                          </td>
                          <td class="text-sm text-base-content/60">{new Date(entry.created_at * 1000).toLocaleDateString()}</td>
                          <td>
                            <select
                              class="select select-bordered select-sm min-w-28 text-sm"
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

            {}
            <div class="md:hidden mt-4 space-y-3">
              <Show
                when={members().length}
                fallback={
                  <div class="py-10 text-center text-sm text-base-content/60">
                    当前没有可展示的用户。
                  </div>
                }
              >
                <For each={members()}>
                  {(entry) => (
                    <div class="rounded border border-base-300 bg-base-100 p-4 space-y-3">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-semibold text-base">{entry.username}</span>
                        <span class={`rounded-full px-3 py-1 text-xs font-bold shrink-0 ${entry.status === 'active' ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/60'}`}>
                          {entry.status}
                        </span>
                      </div>
                      <div class="text-xs font-mono text-base-content/50 break-all">{entry.uuid}</div>
                      <div class="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span class="text-xs text-base-content/40 block">邮箱</span>
                          <span class="text-base-content/70">{entry.email || '-'}</span>
                        </div>
                        <div>
                          <span class="text-xs text-base-content/40 block">注册时间</span>
                          <span class="text-base-content/70">{new Date(entry.created_at * 1000).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div>
                        <span class="text-xs text-base-content/40 block mb-1">角色</span>
                        <select
                          class="select select-bordered select-sm w-full text-sm"
                          value={entry.role}
                          onChange={(event) => void changeRole(entry.uuid, event.currentTarget.value as Member['role'])}
                        >
                          <option value="guest">Guest</option>
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
