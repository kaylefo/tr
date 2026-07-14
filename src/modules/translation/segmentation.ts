import { TRANSLATION_MAX_CHARS } from '../../config/app';

const MAX_SEGMENT_CHARS = 400;
const HARD_LIMIT = TRANSLATION_MAX_CHARS;

export interface TextSegment {
  text: string;
  isBlank: boolean;
}

export function normalizeTranslationText(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function segmentJapaneseText(input: string, maxChars = MAX_SEGMENT_CHARS): TextSegment[] {
  const normalized = normalizeTranslationText(input);
  if (normalized.length > HARD_LIMIT) {
    throw new Error('INPUT_TOO_LONG');
  }

  const paragraphs = normalized.split('\n');
  const segments: TextSegment[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      segments.push({ text: '', isBlank: true });
      continue;
    }

    let remaining = paragraph;
    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        segments.push({ text: remaining, isBlank: false });
        break;
      }

      let splitAt = findSplitIndex(remaining, maxChars);
      if (splitAt <= 0) splitAt = maxChars;

      const chunk = remaining.slice(0, splitAt).trimEnd();
      if (chunk) {
        segments.push({ text: chunk, isBlank: false });
      }
      remaining = remaining.slice(splitAt).trimStart();
    }
  }

  return segments;
}

const SENTENCE_BOUNDARIES = new Set([
  '。', '！', '？', '、', '．', '.', '!', '?', '；', ';', '」', '』', '）', ')',
]);

function findSplitIndex(text: string, maxChars: number): number {
  const start = Math.min(maxChars, text.length - 1);
  const floor = Math.floor(maxChars * 0.5);

  for (let i = start; i >= floor; i--) {
    if (SENTENCE_BOUNDARIES.has(text[i])) {
      return i + 1;
    }
  }

  let fallback = maxChars;
  const code = text.charCodeAt(fallback - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    fallback -= 1;
  }
  return Math.max(1, fallback);
}

export function reassembleTranslation(
  segments: TextSegment[],
  translations: string[],
): string {
  const lines: string[] = [];
  let translationIndex = 0;

  for (const segment of segments) {
    if (segment.isBlank) {
      lines.push('');
      continue;
    }
    const translated = translations[translationIndex] ?? '';
    translationIndex += 1;
    lines.push(translated);
  }

  const result: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of lines) {
    if (line === '') {
      if (currentParagraph.length > 0) {
        result.push(currentParagraph.join(' '));
        currentParagraph = [];
      }
      result.push('');
    } else {
      currentParagraph.push(line);
    }
  }
  if (currentParagraph.length > 0) {
    result.push(currentParagraph.join(' '));
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function countNonBlankSegments(segments: TextSegment[]): number {
  return segments.filter((s) => !s.isBlank && s.text.trim()).length;
}
