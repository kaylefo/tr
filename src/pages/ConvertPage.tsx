import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QUICK_JPY_AMOUNTS, FEE_PRESETS } from '../config/app';
import {
  convertAmount,
  displayAmount,
  formatInverseExplanation,
  formatJpy,
  formatUsd,
  getRateStatusLabel,
  parseSanitizedAmount,
  sanitizeCurrencyInput,
} from '../modules/currency/conversion';
import { addConversionHistory } from '../modules/storage/historyStore';
import { RateStatusBadge } from '../components/RateStatusBadge';
import { useExchangeRate } from '../hooks/useExchangeRate';
import type { ConversionDirection } from '../config/app';

interface ConvertPageProps {
  defaultDirection: ConversionDirection;
  defaultFeePercent: number;
  autoRefreshEnabled: boolean;
}

export function ConvertPage({
  defaultDirection,
  defaultFeePercent,
  autoRefreshEnabled,
}: ConvertPageProps) {
  const { rate, checking, error, refresh, isOnline } = useExchangeRate(autoRefreshEnabled);
  const [direction, setDirection] = useState<ConversionDirection>(defaultDirection);
  const [jpyInput, setJpyInput] = useState('');
  const [usdInput, setUsdInput] = useState('');
  const [activeField, setActiveField] = useState<'jpy' | 'usd'>('jpy');
  const [feePercent, setFeePercent] = useState(defaultFeePercent);
  const [customFee, setCustomFee] = useState('');
  const [feeOpen, setFeeOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastHistoryRef = useRef('');

  const effectiveFee = customFee !== '' ? Number(customFee) || 0 : feePercent;

  const conversion = useMemo(() => {
    if (!rate) return null;
    const raw = activeField === 'jpy' ? jpyInput : usdInput;
    const sanitized = sanitizeCurrencyInput(raw);
    const amount = parseSanitizedAmount(sanitized);
    if (!amount) return null;
    return convertAmount({
      amount,
      direction: activeField === 'jpy' ? 'JPY_TO_USD' : 'USD_TO_JPY',
      rate: rate.rate,
      feePercent: effectiveFee,
    });
  }, [activeField, effectiveFee, jpyInput, rate, usdInput]);

  useEffect(() => {
    if (!conversion || !rate) return;
    if (activeField === 'jpy') {
      setUsdInput(displayAmount(conversion.outputAmount));
    } else {
      setJpyInput(displayAmount(conversion.outputAmount));
    }
  }, [conversion, activeField, rate]);

  useEffect(() => {
    if (!conversion || !rate || !jpyInput && !usdInput) return;
    const key = `${conversion.inputAmount.toString()}-${conversion.outputAmount.toString()}-${direction}`;
    if (lastHistoryRef.current === key) return;
    lastHistoryRef.current = key;
    const jpy =
      direction === 'JPY_TO_USD'
        ? conversion.inputAmount
        : conversion.outputAmount;
    const usd =
      direction === 'JPY_TO_USD'
        ? conversion.outputAmount
        : conversion.inputAmount;
    if (jpy.isZero() && usd.isZero()) return;
    void addConversionHistory({
      jpyAmount: jpy.toFixed(0),
      usdAmount: usd.toFixed(2),
      direction,
      rate: rate.rate,
      feePercent: effectiveFee,
      rateSourceDate: rate.providerSourceDate,
    });
  }, [conversion, direction, effectiveFee, jpyInput, rate, usdInput]);

  const swapDirection = () => {
    setDirection((d) => (d === 'JPY_TO_USD' ? 'USD_TO_JPY' : 'JPY_TO_USD'));
    setActiveField((f) => (f === 'jpy' ? 'usd' : 'jpy'));
  };

  const handleQuickAmount = (amount: number) => {
    setDirection('JPY_TO_USD');
    setActiveField('jpy');
    setJpyInput(String(amount));
  };

  const copyResult = async () => {
    const jpyVal = Number(jpyInput) || 0;
    const usdVal = Number(usdInput) || 0;
    const text =
      direction === 'JPY_TO_USD'
        ? `${formatJpy(jpyVal)} → ${formatUsd(usdVal)}`
        : `${formatUsd(usdVal)} → ${formatJpy(jpyVal)}`;
    await navigator.clipboard.writeText(text);
    setAnnouncement('Result copied');
  };

  const shareResult = async () => {
    const jpyVal = Number(jpyInput) || 0;
    const usdVal = Number(usdInput) || 0;
    const text =
      direction === 'JPY_TO_USD'
        ? `${formatJpy(jpyVal)} ≈ ${formatUsd(usdVal)}`
        : `${formatUsd(usdVal)} ≈ ${formatJpy(jpyVal)}`;
    if (navigator.share) {
      await navigator.share({ text, title: 'Japan Pocket conversion' });
    } else {
      await copyResult();
    }
  };

  const statusLabel = getRateStatusLabel(
    rate?.freshnessStatus ?? 'unavailable',
    checking,
    !!rate,
  );

  const inverse = rate ? formatInverseExplanation(rate.rate) : null;

  const handleRefresh = useCallback(async () => {
    await refresh(true);
    setAnnouncement(checking ? 'Checking for update' : 'Rate refreshed');
  }, [checking, refresh]);

  return (
    <section className="page convert-page" aria-labelledby="convert-heading">
      <header className="page__header">
        <h1 id="convert-heading">Convert</h1>
        <p className="page__subtitle">Latest reference rate when connected</p>
      </header>

      <RateStatusBadge
        label={statusLabel}
        provider={rate?.providerLabel}
        sourceDate={rate?.providerSourceDate}
        fetchedAt={rate?.fetchedAt}
      />

      {!rate && !checking ? (
        <p className="notice" role="alert">
          {error ?? 'Connect once while online to obtain an exchange rate.'}
        </p>
      ) : null}

      {error && rate ? <p className="notice notice--warn">{error}</p> : null}

      <div className="convert-card">
        <label className="field field--large" htmlFor="jpy-input">
          <span className="field__label">Japanese Yen</span>
          <input
            id="jpy-input"
            className="field__input field__input--jpy"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={jpyInput}
            onFocus={() => setActiveField('jpy')}
            onChange={(e) => {
              setDirection('JPY_TO_USD');
              setActiveField('jpy');
              setJpyInput(sanitizeCurrencyInput(e.target.value));
            }}
            aria-label="Amount in Japanese Yen"
          />
        </label>

        <div className="convert-actions">
          <button type="button" className="icon-button" onClick={swapDirection} aria-label="Swap conversion direction">
            ⇅
          </button>
        </div>

        <label className="field field--large" htmlFor="usd-input">
          <span className="field__label">US Dollar</span>
          <input
            id="usd-input"
            className="field__input field__input--usd"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={usdInput}
            onFocus={() => setActiveField('usd')}
            onChange={(e) => {
              setDirection('USD_TO_JPY');
              setActiveField('usd');
              setUsdInput(sanitizeCurrencyInput(e.target.value));
            }}
            aria-label="Amount in US Dollars"
          />
        </label>
      </div>

      {inverse ? (
        <p className="inverse-rate">
          1 USD ≈ {inverse.oneUsdInJpy} · 1 JPY ≈ {inverse.oneJpyInUsd}
        </p>
      ) : null}

      <div className="quick-amounts" role="group" aria-label="Quick yen amounts">
        {QUICK_JPY_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            className="chip"
            onClick={() => handleQuickAmount(amount)}
          >
            {formatJpy(amount)}
          </button>
        ))}
      </div>

      <details className="fee-panel" open={feeOpen} onToggle={(e) => setFeeOpen(e.currentTarget.open)}>
        <summary>Fee estimate (optional)</summary>
        <p className="fee-panel__hint">User estimate only — not part of the reference rate.</p>
        <div className="fee-panel__options">
          {FEE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip${feePercent === preset && customFee === '' ? ' chip--active' : ''}`}
              onClick={() => {
                setFeePercent(preset);
                setCustomFee('');
              }}
            >
              {preset}%
            </button>
          ))}
        </div>
        <label className="field" htmlFor="custom-fee">
          <span className="field__label">Custom %</span>
          <input
            id="custom-fee"
            className="field__input"
            inputMode="decimal"
            value={customFee}
            onChange={(e) => setCustomFee(sanitizeCurrencyInput(e.target.value))}
          />
        </label>
      </details>

      <div className="action-row">
        <button type="button" className="button button--secondary" onClick={() => void handleRefresh()} disabled={checking || !isOnline}>
          Refresh rate
        </button>
        <button type="button" className="button button--secondary" onClick={() => void copyResult()}>
          Copy
        </button>
        {'share' in navigator ? (
          <button type="button" className="button button--secondary" onClick={() => void shareResult()}>
            Share
          </button>
        ) : null}
      </div>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </section>
  );
}
