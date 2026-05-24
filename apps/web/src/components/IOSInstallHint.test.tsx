import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IOSInstallHint } from './IOSInstallHint';

const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DISMISS_KEY = 'two-cents:ios-install-hint-dismissed';

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('IOSInstallHint', () => {
  const originalUA = navigator.userAgent;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    setUserAgent(originalUA);
    localStorage.clear();
  });

  it('is hidden by default in jsdom (non-iOS UA)', () => {
    render(<IOSInstallHint />);
    expect(screen.queryByText('Install Two Cents')).toBeNull();
  });

  it('renders on iOS Safari when no dismiss flag is present', () => {
    setUserAgent(IOS_SAFARI_UA);
    render(<IOSInstallHint />);
    expect(screen.getByText('Install Two Cents')).toBeInTheDocument();
  });

  it('does not render on iOS Safari when the dismiss flag is set', () => {
    setUserAgent(IOS_SAFARI_UA);
    localStorage.setItem(DISMISS_KEY, '1');
    render(<IOSInstallHint />);
    expect(screen.queryByText('Install Two Cents')).toBeNull();
  });

  it('dismiss button sets localStorage flag and hides the banner', () => {
    setUserAgent(IOS_SAFARI_UA);
    render(<IOSInstallHint />);
    const button = screen.getByRole('button', { name: /dismiss install hint/i });
    fireEvent.click(button);
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
    expect(screen.queryByText('Install Two Cents')).toBeNull();
  });
});
