import { describe, expect, it } from 'vitest';
import { pipeline } from '@huggingface/transformers';
import { TRANSLATION_TEST_SENTENCE } from '../../config/app';
import { extractTranslationText } from './helpers';

describe('opus-mt-ja-en integration', () => {
  it(
    'initializes and translates locally',
    async () => {
      const translator = await pipeline('translation', 'Xenova/opus-mt-ja-en', {
        device: 'cpu',
        dtype: 'q8',
      });
      const result = await translator(TRANSLATION_TEST_SENTENCE);
      const text = extractTranslationText(result);
      expect(text.length).toBeGreaterThan(2);
    },
    300000,
  );
});
