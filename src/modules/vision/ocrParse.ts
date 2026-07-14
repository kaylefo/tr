import type { OcrLineBox } from './ocrMessages';
import { containsJapanese } from './imageProcessing';

interface TesseractBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
}

interface TesseractLine {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
  words?: TesseractWord[];
}

interface TesseractParagraph {
  lines?: TesseractLine[];
}

interface TesseractBlock {
  paragraphs?: TesseractParagraph[];
  lines?: TesseractLine[];
}

export interface TesseractPageData {
  blocks?: TesseractBlock[] | null;
  text?: string | null;
  confidence?: number | null;
}

function mapWord(word: TesseractWord): OcrLineBox['words'][number] {
  return {
    text: word.text,
    confidence: word.confidence ?? 0,
    bbox: word.bbox,
  };
}

function mapLine(line: TesseractLine): OcrLineBox | null {
  const text = line.text?.trim();
  if (!text) return null;
  return {
    text,
    confidence: line.confidence ?? 0,
    bbox: line.bbox,
    words: (line.words ?? []).map(mapWord),
  };
}

export function parseTesseractPage(
  page: TesseractPageData,
  imageWidth: number,
  imageHeight: number,
): OcrLineBox[] {
  const lines: OcrLineBox[] = [];

  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const mapped = mapLine(line);
        if (mapped) lines.push(mapped);
      }
    }
    for (const line of block.lines ?? []) {
      const mapped = mapLine(line);
      if (mapped) lines.push(mapped);
    }
  }

  if (lines.length > 0) {
    return dedupeLines(lines);
  }

  const words: OcrLineBox[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim();
          if (!text || !containsJapanese(text)) continue;
          words.push({
            text,
            confidence: word.confidence ?? 0,
            bbox: word.bbox,
            words: [mapWord(word)],
          });
        }
      }
    }
  }

  if (words.length > 0) {
    return dedupeLines(words);
  }

  const fullText = page.text?.trim();
  if (fullText && containsJapanese(fullText)) {
    return [
      {
        text: fullText,
        confidence: page.confidence ?? 65,
        bbox: {
          x0: Math.round(imageWidth * 0.05),
          y0: Math.round(imageHeight * 0.08),
          x1: Math.round(imageWidth * 0.95),
          y1: Math.round(imageHeight * 0.28),
        },
        words: [],
      },
    ];
  }

  return [];
}

function dedupeLines(lines: OcrLineBox[]): OcrLineBox[] {
  const seen = new Set<string>();
  const out: OcrLineBox[] = [];
  for (const line of lines) {
    const key = `${line.text}|${line.bbox.x0}|${line.bbox.y0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
