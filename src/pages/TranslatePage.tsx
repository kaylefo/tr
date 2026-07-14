import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { TRANSLATION_DEBOUNCE_MS, TRANSLATION_MAX_CHARS } from '../config/app';
import { useConnectivity } from '../hooks/useConnectivity';
import { addTranslationHistory } from '../modules/storage/historyStore';
import { getJaEnPack, type OfflinePackRecord } from '../modules/storage/packStore';
import { languagePackManager } from '../modules/languagePack/languagePackManager';
import { translationService } from '../modules/translation/translationService';
import { normalizeTranslationError } from '../modules/translation/messages';

const OfflinePackPanel = lazy(() =>
  import('../components/OfflinePackPanel').then((m) => ({ default: m.OfflinePackPanel })),
);

export function TranslatePage() {
  const connection = useConnectivity();
  const isOnline = connection === 'online' || connection === 'uncertain';
  const [source, setSource] = useState('');
  const [result, setResult] = useState('');
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<OfflinePackRecord | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const debounceRef = useRef<number | null>(null);
  const lastSavedRef = useRef('');

  const loadPack = useCallback(async () => {
    setPack(await getJaEnPack());
  }, []);

  useEffect(() => {
    void loadPack();
    const unsubs = [
      languagePackManager.subscribeTranslationReady(() => {
        void loadPack();
        setAnnouncement('Offline translation ready');
      }),
      languagePackManager.subscribeTranslationError((message) => setError(message)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [loadPack]);

  const runTranslation = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setResult('');
        setError(null);
        return;
      }
      if (text.length > TRANSLATION_MAX_CHARS) {
        setError(normalizeTranslationError('INPUT_TOO_LONG'));
        return;
      }

      setTranslating(true);
      setError(null);
      try {
        const translated = await translationService.translate(text, isOnline);
        setResult(translated);
        const key = `${text}::${translated}`;
        if (translated && lastSavedRef.current !== key) {
          lastSavedRef.current = key;
          await addTranslationHistory({
            source: text,
            translation: translated,
            modelId: pack?.modelId ?? 'Xenova/opus-mt-ja-en',
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Translation failed');
      } finally {
        setTranslating(false);
      }
    },
    [isOnline, pack?.modelId],
  );

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runTranslation(source);
    }, TRANSLATION_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [source, runTranslation]);

  const speak = () => {
    if (!result || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(result);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
  };

  return (
    <section className="page translate-page" aria-labelledby="translate-heading">
      <header className="page__header">
        <h1 id="translate-heading">Translate</h1>
        <p className="page__subtitle">Japanese → English on your device</p>
      </header>

      <Suspense fallback={<p className="loading">Loading pack controls…</p>}>
        <OfflinePackPanel
          pack={pack}
          isOnline={isOnline}
          onPackChange={loadPack}
        />
      </Suspense>

      <label className="field field--textarea" htmlFor="ja-source">
        <span className="field__label">Japanese</span>
        <textarea
          id="ja-source"
          className="field__textarea"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="日本語を入力"
          rows={5}
          maxLength={TRANSLATION_MAX_CHARS}
          aria-label="Japanese text to translate"
        />
        <span className="char-count" aria-live="polite">
          {source.length}/{TRANSLATION_MAX_CHARS}
        </span>
      </label>

      <div className="action-row">
        <button
          type="button"
          className="button"
          onClick={() => void runTranslation(source)}
          disabled={translating || pack?.status !== 'ready'}
        >
          Translate
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            translationService.cancel();
            setTranslating(false);
          }}
        >
          Stop
        </button>
        <button type="button" className="button button--secondary" onClick={() => setSource('')}>
          Clear
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              setSource(text);
            } catch {
              setError('Paste requires a tap on this button.');
            }
          }}
        >
          Paste
        </button>
      </div>

      <div className="translate-result" aria-live="polite" aria-busy={translating}>
        <h2 className="translate-result__heading">English</h2>
        {translating ? <p className="translate-result__status">Translating…</p> : null}
        {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}
        <p className="translate-result__text">{result || (pack?.status !== 'ready' ? 'Download the offline pack to translate.' : '')}</p>
      </div>

      <div className="action-row">
        <button
          type="button"
          className="button button--secondary"
          disabled={!result}
          onClick={async () => {
            await navigator.clipboard.writeText(result);
            setAnnouncement('English copied');
          }}
        >
          Copy English
        </button>
        {'share' in navigator ? (
          <button
            type="button"
            className="button button--secondary"
            disabled={!result}
            onClick={() => void navigator.share({ text: result })}
          >
            Share
          </button>
        ) : null}
        {'speechSynthesis' in window ? (
          <button type="button" className="button button--secondary" disabled={!result} onClick={speak}>
            Read aloud
          </button>
        ) : null}
      </div>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}
