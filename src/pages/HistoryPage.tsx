import { useCallback, useEffect, useState } from 'react';
import {
  listConversionHistory,
  listTranslationHistory,
  deleteConversionHistoryItem,
  deleteTranslationHistoryItem,
  toggleTranslationFavorite,
  clearConversionHistory,
  clearTranslationHistory,
  type ConversionHistoryItem,
  type TranslationHistoryItem,
} from '../modules/storage/historyStore';
import { formatJpy, formatUsd } from '../modules/currency/conversion';

export function HistoryPage() {
  const [conversions, setConversions] = useState<ConversionHistoryItem[]>([]);
  const [translations, setTranslations] = useState<TranslationHistoryItem[]>([]);

  const reload = useCallback(async () => {
    setConversions(await listConversionHistory());
    setTranslations(await listTranslationHistory());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="page history-page" aria-labelledby="history-heading">
      <header className="page__header">
        <h1 id="history-heading">History</h1>
        <p className="page__subtitle">Stored only on this device</p>
      </header>

      <section aria-labelledby="conversion-history-heading">
        <div className="section-header">
          <h2 id="conversion-history-heading">Conversions</h2>
          <button type="button" className="text-button" onClick={() => void clearConversionHistory().then(reload)}>
            Clear
          </button>
        </div>
        <ul className="history-list">
          {conversions.length === 0 ? (
            <li className="history-list__empty">No conversions yet</li>
          ) : (
            conversions.map((item) => (
              <li key={item.id} className="history-item">
                <div>
                  <strong>{formatJpy(Number(item.jpyAmount))} → {formatUsd(Number(item.usdAmount))}</strong>
                  <p className="history-item__meta">
                    {new Date(item.timestamp).toLocaleString()} · Rate {item.rate.toFixed(6)}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete conversion"
                  onClick={() => void deleteConversionHistoryItem(item.id).then(reload)}
                >
                  ×
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section aria-labelledby="translation-history-heading">
        <div className="section-header">
          <h2 id="translation-history-heading">Translations</h2>
          <button type="button" className="text-button" onClick={() => void clearTranslationHistory().then(reload)}>
            Clear
          </button>
        </div>
        <ul className="history-list">
          {translations.length === 0 ? (
            <li className="history-list__empty">No translations yet</li>
          ) : (
            translations.map((item) => (
              <li key={item.id} className="history-item history-item--stacked">
                <div>
                  <p className="history-item__source">{item.source}</p>
                  <p className="history-item__translation">{item.translation}</p>
                  <p className="history-item__meta">{new Date(item.timestamp).toLocaleString()}</p>
                </div>
                <div className="history-item__actions">
                  <button
                    type="button"
                    className={`icon-button${item.favorite ? ' icon-button--active' : ''}`}
                    aria-label={item.favorite ? 'Remove favorite' : 'Favorite'}
                    onClick={() => void toggleTranslationFavorite(item.id).then(reload)}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Delete translation"
                    onClick={() => void deleteTranslationHistoryItem(item.id).then(reload)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </section>
  );
}
