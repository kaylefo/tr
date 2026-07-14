import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultJaEnPack, getJaEnPack, saveOfflinePack } from '../storage/packStore';
import { TranslationService } from './translationService';
import { WORKER_MESSAGE, type WorkerInbound, type WorkerOutbound } from './messages';

class FakeWorker {
  private readonly listeners = new Set<(event: MessageEvent<WorkerOutbound>) => void>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === 'message') {
      this.listeners.add(listener as (event: MessageEvent<WorkerOutbound>) => void);
    }
  }

  postMessage(message: WorkerInbound): void {
    if (message.type === WORKER_MESSAGE.INIT) {
      queueMicrotask(() => {
        this.emit({
          type: WORKER_MESSAGE.READY,
          payload: {
            modelId: message.payload.modelId,
            executionMode: 'wasm',
            validatedAt: Date.now(),
          },
        });
      });
    }

    if (message.type === WORKER_MESSAGE.TRANSLATE) {
      queueMicrotask(() => {
        this.emit({
          type: WORKER_MESSAGE.PARTIAL,
          payload: { status: 'translating' },
        });
        this.emit({
          type: WORKER_MESSAGE.RESULT,
          payload: {
            requestId: message.payload.requestId,
            translation: `translated:${message.payload.text}`,
          },
        });
      });
    }
  }

  terminate(): void {}

  private emit(data: WorkerOutbound): void {
    const event = { data } as MessageEvent<WorkerOutbound>;
    this.listeners.forEach((listener) => listener(event));
  }
}

describe('TranslationService lifecycle', () => {
  beforeEach(async () => {
    await saveOfflinePack({
      ...defaultJaEnPack,
      status: 'ready',
      executionMode: 'wasm',
      lastValidatedAt: Date.now(),
    });
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  it('does not corrupt a ready pack when inference emits PARTIAL', async () => {
    const service = new TranslationService();
    await expect(service.translate('こんにちは', true)).resolves.toBe(
      'translated:こんにちは',
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await getJaEnPack()).status).toBe('ready');
  });

  it('routes concurrent results to their matching requests', async () => {
    const service = new TranslationService();
    const [first, second] = await Promise.all([
      service.translate('一', true),
      service.translate('二', true),
    ]);

    expect(first).toBe('translated:一');
    expect(second).toBe('translated:二');
  });
});
