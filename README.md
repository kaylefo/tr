# Japan Pocket

**Japan Pocket** is an iPhone-first installable web app that combines:

1. A **JPY ↔ USD currency converter** using free public reference rates (no API key).
2. An **offline Japanese → English translator** that runs entirely on your device after a one-time model download.

Everything stays on your phone. No account, ads, trackers, or backend server.

## Offline behavior (truthful)

- **Currency:** The app saves the last successfully fetched reference rate. Offline, it keeps converting with that saved rate and shows “Saved rate” or “Offline rate.” A newly current rate requires internet at least once.
- **Translation:** After you download and validate the offline pack while online, translation works in airplane mode. Text is never sent to a hosted translation API.
- **First visit:** You need internet once to load the app, fetch a rate, and optionally download the translation model.

## Deploy on Vercel (from your iPhone or any browser)

1. Push this repository to GitHub (already done if you imported it).
2. Open [vercel.com](https://vercel.com) and sign in.
3. Tap **Add New… → Project**.
4. Import this GitHub repository.
5. Use these settings (defaults should match):

| Setting | Value |
|---------|--------|
| Framework | Vite |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

6. Tap **Deploy**. Future pushes to `main` deploy automatically.

No environment variables are required for core features.

## Install on iPhone (Safari)

1. Open the deployed URL in Safari.
2. Tap **Share** → **Add to Home Screen**.
3. Enable **Open as Web App** if shown, then tap **Add**.
4. Launch **Japan Pocket** from your Home Screen.

## Download the offline translation pack

1. Open **Translate** or **Settings**.
2. Tap **Download offline pack** while on Wi‑Fi (large download).
3. Wait until status shows **Offline translation ready** (includes a local validation test).

## Test with airplane mode

1. Open the app online and confirm a rate loaded.
2. Download the translation pack.
3. Enable airplane mode.
4. Force-quit and reopen Japan Pocket from the Home Screen icon.
5. Convert — you should see **Offline rate** or **Saved rate**.
6. Translate Japanese text — results should appear with no network.

## Repair or clear the model

- **Repair:** Settings → Translation → **Repair / redownload**
- **Delete pack only:** **Delete pack** (keeps history and settings)
- **Clear everything:** Settings → Storage → **Clear all local data**

## Attribution

- Exchange rates: [Fawaz Ahmed Currency API](https://github.com/fawazahmed0/currency-api) (jsDelivr), [Frankfurter](https://www.frankfurter.app/)
- Translation model: [Xenova/opus-mt-ja-en](https://huggingface.co/Xenova/opus-mt-ja-en) (Apache-2.0, based on Helsinki-NLP/opus-mt-ja-en)
- Runtime: [@huggingface/transformers](https://github.com/huggingface/transformers.js)

## License

MIT — see repository license file.
