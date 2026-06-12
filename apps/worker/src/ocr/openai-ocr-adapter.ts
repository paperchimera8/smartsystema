import OpenAI from "openai";
import type { OcrExtractResult, OcrExtractedField } from "@automator/contracts";

const SYSTEM_PROMPT = `You are a document OCR assistant. Extract all text and structured fields from the provided document image.
Return a JSON object with exactly this shape:
{
  "documentType": string,
  "rawText": string,
  "fields": [{ "name": string, "value": string, "confidence": number }],
  "overallConfidence": number
}
Rules:
- documentType: one of "invoice", "waybill", "act", "contract", "receipt", "upd", "other"
- rawText: all visible text in reading order
- fields: extract supplier, buyer, date, number, total, vat, currency, and any line items as separate entries
- confidence values: 0.0–1.0 per field; overallConfidence is the weighted average
- Respond ONLY with valid JSON, no markdown fences`;

type RawOcrResponse = {
  documentType: string;
  rawText: string;
  fields: Array<{ name: string; value: string; confidence: number }>;
  overallConfidence: number;
};

export type OcrAdapterConfig = {
  apiKey: string;
  model: string;
};

export type OcrAdapterInput = {
  documentId: string;
  imageUrl: string;
};

export async function extractWithOpenAI(
  input: OcrAdapterInput,
  config: OcrAdapterConfig
): Promise<OcrExtractResult> {
  const client = new OpenAI({ apiKey: config.apiKey });

  const response = await client.chat.completions.create({
    model: config.model,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: input.imageUrl, detail: "high" }
          },
          {
            type: "text",
            text: "Extract all text and structured fields from this document."
          }
        ]
      }
    ]
  });

  const choice = response.choices[0];

  if (!choice?.message?.content) {
    throw new Error("OpenAI returned an empty OCR response.");
  }

  let parsed: RawOcrResponse;

  try {
    parsed = JSON.parse(choice.message.content) as RawOcrResponse;
  } catch {
    throw new Error("OpenAI OCR response was not valid JSON.");
  }

  const fields: OcrExtractedField[] = (parsed.fields ?? []).map((f) => ({
    name: String(f.name ?? ""),
    value: String(f.value ?? ""),
    confidence: clampScore(Number(f.confidence))
  }));

  return {
    documentId: input.documentId,
    provider: "openai",
    model: config.model,
    rawText: String(parsed.rawText ?? ""),
    documentType: String(parsed.documentType ?? "other"),
    fields,
    overallConfidence: clampScore(Number(parsed.overallConfidence)),
    tokenUsage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0
    }
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
