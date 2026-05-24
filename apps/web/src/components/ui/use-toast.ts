import * as React from 'react';
import type { ToastActionElement, ToastProps } from '@/components/ui/toast';

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 5000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

type State = { toasts: ToasterToast[] };

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };
let count = 0;
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

function dispatch(next: State) {
  memoryState = next;
  for (const l of listeners) l(memoryState);
}

function scheduleRemove(id: string) {
  if (timeouts.has(id)) return;
  const t = setTimeout(() => {
    timeouts.delete(id);
    dispatch({ toasts: memoryState.toasts.filter((t) => t.id !== id) });
  }, TOAST_REMOVE_DELAY);
  timeouts.set(id, t);
}

type ToastInput = Omit<ToasterToast, 'id'>;

function toast(input: ToastInput) {
  const id = genId();
  const next: ToasterToast = {
    ...input,
    id,
    open: true,
    onOpenChange: (open) => {
      if (!open) scheduleRemove(id);
    },
  };
  dispatch({
    toasts: [next, ...memoryState.toasts].slice(0, TOAST_LIMIT),
  });
  scheduleRemove(id);
  return id;
}

export function useToast() {
  const [state, setState] = React.useState<State>(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const i = listeners.indexOf(setState);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);
  return {
    toasts: state.toasts,
    toast,
    dismiss: (id: string) =>
      dispatch({
        toasts: memoryState.toasts.map((t) =>
          t.id === id ? { ...t, open: false } : t,
        ),
      }),
  };
}

export { toast };
