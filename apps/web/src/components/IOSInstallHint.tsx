import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'two-cents:ios-install-hint-dismissed';

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  if (!/iphone|ipad|ipod/i.test(ua)) return false;
  if (/crios|fxios|edgios|opios/i.test(ua)) return false;
  return true;
}

function isStandalone(): boolean {
  if (
    'standalone' in navigator &&
    (navigator as unknown as { standalone?: boolean }).standalone === true
  ) {
    return true;
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  ) {
    return true;
  }
  return false;
}

export function IOSInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      // ignore localStorage errors
    }
    if (!isIOSSafari()) return;
    if (isStandalone()) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore localStorage errors
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Install Two Cents"
      className="mb-4 flex items-start justify-between gap-3 rounded border bg-muted p-3 text-sm"
    >
      <div className="flex-1">
        <p className="font-semibold">Install Two Cents</p>
        <p className="text-muted-foreground">
          Tap the Share button, then &lsquo;Add to Home Screen&rsquo; to use Two Cents like a native
          app.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Dismiss install hint"
        onClick={handleDismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
