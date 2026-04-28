import { Show, createEffect, createSignal, type ParentProps } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { loadAccount, type Role } from '../lib/api';

type GateProps = ParentProps<{
  role?: Role;
  login: string;
  denied: string;
}>;

export default function Gate(props: GateProps) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = createSignal(false);

  createEffect(() => {
    void (async () => {
      const current = await loadAccount();
      if (!current) {
        navigate(props.login, { replace: true });
        return;
      }
      if (props.role && current.role !== props.role) {
        navigate(props.denied, { replace: true });
        return;
      }
      setAllowed(true);
    })();
  });

  return <Show when={allowed()}>{props.children}</Show>;
}
