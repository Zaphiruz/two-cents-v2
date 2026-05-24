import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const URL_RE = /https?:\/\/\S+/;
const TRAILING_PUNCT = /[.,;:)\]}]+$/;

export default function ShareTargetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const rawUrl = (searchParams.get('url') ?? '').trim();
    const rawTitle = (searchParams.get('title') ?? '').trim();
    const rawText = (searchParams.get('text') ?? '').trim();

    let extractedUrl = '';
    let cleanedText = rawText;
    if (!rawUrl && rawText) {
      const match = rawText.match(URL_RE);
      if (match && match.index !== undefined) {
        extractedUrl = match[0].replace(TRAILING_PUNCT, '');
        cleanedText = (
          rawText.slice(0, match.index) + rawText.slice(match.index + match[0].length)
        ).trim();
      }
    }

    const finalUrl = rawUrl || extractedUrl;

    if (cleanedText && cleanedText === rawTitle) {
      cleanedText = '';
    }

    const params = new URLSearchParams();
    if (finalUrl) params.set('url', finalUrl);
    if (rawTitle) params.set('title', rawTitle);
    if (cleanedText) params.set('text', cleanedText);

    const qs = params.toString();
    const target = qs ? `/requests/new?${qs}` : '/requests/new';
    navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="p-6 text-sm text-muted-foreground">Redirecting…</div>;
}
