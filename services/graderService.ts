import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';

/**
 * AI Card Grader service.
 *
 * Takes a few angle photos of a raw card and returns an ESTIMATED condition
 * grade (centering / corners / edges / surface + composite), in the spirit of
 * PSA's 1-10 scale. This is a pre-grading aid, never a certified grade -- the
 * disclaimer rides along on every result and the UI surfaces it prominently.
 *
 * Mirrors scannerService's Gemini conventions: lazy GoogleGenAI init from
 * GEMINI_API_KEY, Flash model, structured JSON output, sharp for image prep.
 * Runs on the nodejs runtime only (sharp is native) -- see app/api/grade/route.ts.
 */

// Flash, matching scannerService. The grading schema is compact (four numbers +
// short notes), so Pro's thinking-token truncation pitfall buys nothing here;
// Flash is faster and cheaper at comparable quality. Bump if accuracy demands.
const GRADER_MODEL = 'gemini-2.5-flash';

let _ai: GoogleGenAI | null | undefined;
function getAi(): GoogleGenAI | null {
  if (_ai !== undefined) return _ai;
  const apiKey = process.env.GEMINI_API_KEY || '';
  _ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  return _ai;
}

export type GradeAngle = 'front' | 'back' | 'surface';
export interface GradeImageInput {
  angle: GradeAngle;
  image: string; // base64, with or without a data: URL prefix
}

export interface SubGrades {
  centering: number;
  corners: number;
  edges: number;
  surface: number;
}

export type ImageQuality = 'good' | 'fair' | 'poor';

export interface GradeEstimate extends SubGrades {
  overall: number;
  label: string;
  confidence: number;
  notes: {
    centering: string;
    corners: string;
    edges: string;
    surface: string;
    summary: string;
    imageQuality: ImageQuality;
  };
  disclaimer: string;
}

export const GRADE_DISCLAIMER =
  'AI estimate from your photos only. This is not an official PSA, BGS, or CGC grade; a professional grader may score differently.';

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Composite from the four sub-grades. Weighted toward corners and surface (the
 * defects that most depress real grades), then capped near the weakest area: a
 * single bad sub-grade limits the overall, the way professional grading does.
 */
export function computeComposite(s: SubGrades): number {
  const weighted = s.centering * 0.2 + s.corners * 0.3 + s.edges * 0.2 + s.surface * 0.3;
  const lowest = Math.min(s.centering, s.corners, s.edges, s.surface);
  return roundHalf(clamp(Math.min(weighted, lowest + 1), 1, 10));
}

export function gradeLabel(overall: number): string {
  const map: Record<number, string> = {
    10: 'Gem Mint', 9: 'Mint', 8: 'NM-MT', 7: 'Near Mint', 6: 'EX-MT',
    5: 'Excellent', 4: 'VG-EX', 3: 'Very Good', 2: 'Good', 1: 'Poor',
  };
  return `${map[Math.floor(overall)] ?? 'Ungraded'} (est.)`;
}

// Re-encode every photo to a bounded JPEG: small enough to keep the request
// under serverless body limits, large enough that edge/corner/surface defects
// stay visible. .rotate() bakes in EXIF orientation so phone shots aren't sideways.
async function normalizeImage(image: string): Promise<string> {
  const base64 = image.includes(',') ? image.split(',')[1] : image;
  const buf = Buffer.from(base64, 'base64');
  const out = await sharp(buf)
    .rotate()
    .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return out.toString('base64');
}

function sanitizeGrade(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return roundHalf(clamp(n, 1, 10));
}

const GRADING_PROMPT = `You are an experienced trading-card condition grader producing a PRE-GRADING ESTIMATE (PSA-style 1-10 scale) from a collector's phone photos. Multiple images may be provided, each labelled with its angle (front, back, surface).

Grade each of the four sub-aspects from 1.0 (poor) to 10.0 (gem mint), in 0.5 steps:
- centering: how even the borders are, front and back. Off-center = lower.
- corners: sharpness of all four corners. Any whitening, fraying, or rounding = lower.
- edges: edge whitening, nicks, or chipping along all four sides.
- surface: scratches, print lines, scuffs, dents, holo scratches, indentations, staining.

Rules:
- Be CONSERVATIVE. When a defect might be present but the photo is unclear, assume the lower grade and say so. Collectors are harmed more by an inflated estimate than a cautious one.
- Judge only what the photos actually show. If you cannot see the back, do not assume it is flawless.
- imageQuality: rate the photos overall as "good", "fair", or "poor" (blur, glare, low resolution, cropping). Lower your confidence when quality is "fair" or "poor".
- confidence: 0.0 to 1.0, reflecting how sure you are given the image quality and angles provided.
- Keep every notes field to one short sentence. Name the specific defect you saw, or state it looked clean.

Return JSON only.`;

export async function gradeCard(images: GradeImageInput[]): Promise<GradeEstimate> {
  const ai = getAi();
  if (!ai) throw new Error('GEMINI_API_KEY not configured');
  if (!images?.length) throw new Error('No images provided');

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  for (const img of images) {
    const data = await normalizeImage(img.image);
    parts.push({ text: `Image -- ${img.angle} of the card:` });
    parts.push({ inlineData: { data, mimeType: 'image/jpeg' } });
  }
  parts.push({ text: GRADING_PROMPT });

  const response = await ai.models.generateContent({
    model: GRADER_MODEL,
    contents: [{ parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          centering: { type: Type.NUMBER },
          corners: { type: Type.NUMBER },
          edges: { type: Type.NUMBER },
          surface: { type: Type.NUMBER },
          confidence: { type: Type.NUMBER },
          centeringNotes: { type: Type.STRING },
          cornersNotes: { type: Type.STRING },
          edgesNotes: { type: Type.STRING },
          surfaceNotes: { type: Type.STRING },
          imageQuality: { type: Type.STRING, enum: ['good', 'fair', 'poor'] },
          summary: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}');

  const raw = {
    centering: sanitizeGrade(parsed.centering),
    corners: sanitizeGrade(parsed.corners),
    edges: sanitizeGrade(parsed.edges),
    surface: sanitizeGrade(parsed.surface),
  };
  const valid = Object.values(raw).filter((v): v is number => v !== null);
  if (valid.length === 0) {
    throw new Error('Could not assess the card from these photos. Try clearer, well-lit shots.');
  }
  // Backfill any aspect the model failed to score with the most conservative
  // (lowest) of the ones it did, rather than inventing a flattering default.
  const floor = Math.min(...valid);
  const sub: SubGrades = {
    centering: raw.centering ?? floor,
    corners: raw.corners ?? floor,
    edges: raw.edges ?? floor,
    surface: raw.surface ?? floor,
  };

  const overall = computeComposite(sub);
  const imageQuality: ImageQuality =
    parsed.imageQuality === 'good' || parsed.imageQuality === 'poor' ? parsed.imageQuality : 'fair';
  let confidence = sanitizeConfidence(parsed.confidence);
  // A clean grade off bad photos is not trustworthy; never report high confidence then.
  if (imageQuality === 'poor') confidence = Math.min(confidence, 0.4);

  const note = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 160) : '');

  console.log('[GraderService] estimate:', { overall, ...sub, confidence, imageQuality });

  return {
    ...sub,
    overall,
    label: gradeLabel(overall),
    confidence,
    notes: {
      centering: note(parsed.centeringNotes),
      corners: note(parsed.cornersNotes),
      edges: note(parsed.edgesNotes),
      surface: note(parsed.surfaceNotes),
      summary: note(parsed.summary),
      imageQuality,
    },
    disclaimer: GRADE_DISCLAIMER,
  };
}

function sanitizeConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return clamp(n, 0, 1);
}
