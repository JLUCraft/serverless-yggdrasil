import { For, Show, createSignal, onMount } from 'solid-js';
import Rail from '../components/Rail';
import { api } from '../lib/api';

type Bridge = {
  site_code: string;
  site_name: string;
  api_key: string | null;
  union_endpoint: string;
  enabled: boolean;
};

type Site = {
  site_code: string;
  site_name: string;
  endpoint: string;
  api_key?: string;
  enabled: boolean;
};

export default function Admin() {
  const [bridge, setBridge] = createSignal<Bridge | null>(null);
  const [sites, setSites] = createSignal<Site[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');

  onMount(() => {
    void loadConsole();
  });

  async function loadConsole() {
    setLoading(true);
    try {
      const [config, registry] = await Promise.all([api.bridge.read(), api.bridge.list()]);
      setBridge(config.data);
      setSites(registry.data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function writeBridge(body: Partial<Bridge>) {
    try {
      const response = await api.bridge.write(body);
      setBridge(response.data);
      setSuccess('节点互通配置已更新');
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function createSite(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);

    try {
      await api.bridge.create({
        site_code: String(formData.get('site_code')),
        site_name: String(formData.get('site_name')),
        endpoint: String(formData.get('endpoint')),
        api_key: String(formData.get('api_key') || ''),
      });
      setSuccess('外部节点已加入');
      form.reset();
      await loadConsole();
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
            <h1 class="text-3xl font-extrabold tracking-tight">节点互通</h1>
            <p class="mt-2 text-sm text-base-content/60">本站标识、通信密钥和信任节点都在同一处维护。</p>
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
            <div class="flex flex-col gap-3 border-b border-base-300 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="text-xl font-extrabold">本站配置</h2>
                <p class="mt-1 text-sm text-base-content/60">这些字段决定本站如何被其他节点识别与信任。</p>
              </div>
              <span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">单页维护</span>
            </div>

            <Show when={!bridge()}>
              <div class="mt-6 rounded border border-warning/30 bg-warning/8 px-5 py-4 text-sm text-warning-content">
                配置不存在。请先初始化 MUA 配置表，再回到这里编辑。
              </div>
            </Show>

            <Show when={bridge()}>
              <div class="mt-6 grid gap-4 lg:grid-cols-2">
                <div>
                  <label class="mb-2 block text-sm font-semibold text-base-content/80">站点代码</label>
                  <input
                    type="text"
                    class="input glass-input w-full"
                    value={bridge()?.site_code || ''}
                    onBlur={(event) => void writeBridge({ site_code: event.currentTarget.value })}
                  />
                </div>
                <div>
                  <label class="mb-2 block text-sm font-semibold text-base-content/80">站点名称</label>
                  <input
                    type="text"
                    class="input glass-input w-full"
                    value={bridge()?.site_name || ''}
                    onBlur={(event) => void writeBridge({ site_name: event.currentTarget.value })}
                  />
                </div>
                <div class="lg:col-span-2">
                  <label class="mb-2 block text-sm font-semibold text-base-content/80">MUA API Key</label>
                  <div class="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      class="input glass-input w-full font-mono text-sm"
                      value={bridge()?.api_key || ''}
                      onBlur={(event) => void writeBridge({ api_key: event.currentTarget.value })}
                    />
                    <button
                      type="button"
                      class="btn bg-base-100 text-primary shadow-sm hover:bg-primary hover:text-primary-content border border-base-300"
                      onClick={() =>
                        void writeBridge({
                          api_key: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
                        })
                      }
                    >
                      重新生成
                    </button>
                  </div>
                </div>
                <div class="lg:col-span-2">
                  <label class="mb-2 block text-sm font-semibold text-base-content/80">Union Endpoint</label>
                  <input
                    type="text"
                    class="input glass-input w-full font-mono text-sm"
                    value={bridge()?.union_endpoint || ''}
                    onBlur={(event) => void writeBridge({ union_endpoint: event.currentTarget.value })}
                  />
                </div>
              </div>
            </Show>
          </div>

          <div class="glass-panel p-6">
            <div class="border-b border-base-300 pb-4">
              <h2 class="text-xl font-extrabold">信任节点</h2>
              <p class="mt-1 text-sm text-base-content/60">录入对方站点代码、地址与密钥，然后纳入互通名单。</p>
            </div>

            <form onSubmit={createSite} class="mt-6 grid gap-4 lg:grid-cols-4">
              <div>
                <label class="mb-2 block text-sm font-semibold text-base-content/80">短代码</label>
                <input name="site_code" type="text" class="input glass-input w-full font-mono" required />
              </div>
              <div>
                <label class="mb-2 block text-sm font-semibold text-base-content/80">名称</label>
                <input name="site_name" type="text" class="input glass-input w-full" required />
              </div>
              <div>
                <label class="mb-2 block text-sm font-semibold text-base-content/80">API 地址</label>
                <input name="endpoint" type="text" class="input glass-input w-full font-mono text-sm" required />
              </div>
              <div>
                <label class="mb-2 block text-sm font-semibold text-base-content/80">对方 Key</label>
                <input name="api_key" type="text" class="input glass-input w-full font-mono text-sm" />
              </div>
              <div class="lg:col-span-4">
                <button type="submit" class="btn btn-primary w-full text-white">
                  加入节点
                </button>
              </div>
            </form>

            <div class="mt-6 overflow-hidden rounded border border-base-300 bg-base-100">
              <table class="table w-full">
                <thead class="text-base-content/80">
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>地址</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={sites().length}
                    fallback={
                      <tr>
                        <td colSpan={4} class="py-10 text-center text-sm text-base-content/60">
                          还没有任何外部节点。
                        </td>
                      </tr>
                    }
                  >
                    <For each={sites()}>
                      {(entry) => (
                        <tr class="border-t border-base-200 hover:bg-base-200/50">
                          <td><span class="rounded-full bg-base-200 px-3 py-1 font-mono text-xs font-bold text-base-content/70">{entry.site_code}</span></td>
                          <td class="font-semibold">{entry.site_name}</td>
                          <td class="font-mono text-xs text-base-content/50">{entry.endpoint}</td>
                          <td>
                            <span class={`rounded-full px-3 py-1 text-xs font-bold ${entry.enabled ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content/60'}`}>
                              {entry.enabled ? '启用' : '停用'}
                            </span>
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
