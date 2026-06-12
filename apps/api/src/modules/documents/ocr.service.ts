import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import type { OcrExtractResult } from "@automator/contracts";

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const IMAGE_SYSTEM_PROMPT = `You are a document OCR assistant for Russian B2B documents.
Extract all text and structured fields from the provided document image.
Return ONLY a JSON object:
{"documentType":string,"rawText":string,"fields":[{"name":string,"value":string,"confidence":number}],"overallConfidence":number}
documentType: "invoice"|"waybill"|"act"|"contract"|"receipt"|"upd"|"other"
fields: supplier, buyer, date, document number, total, vat, currency, and each line item
confidence: 0.0–1.0 per field; overallConfidence is weighted average
No markdown, no explanation — only JSON.`;

const TEXT_SYSTEM_PROMPT = `You are a document field extraction assistant for Russian B2B documents.
Extract structured fields from the provided document text.
Return ONLY a JSON object:
{"documentType":string,"rawText":string,"fields":[{"name":string,"value":string,"confidence":number}],"overallConfidence":number}
documentType: "invoice"|"waybill"|"act"|"contract"|"receipt"|"upd"|"other"
rawText: the full input text verbatim
fields: supplier, buyer, date, document number, total, vat, currency, and each line item
confidence: 0.0–1.0 per field; overallConfidence is weighted average
No markdown, no explanation — only JSON.`;

type ParsedOcrJson = {
  documentType: string;
  rawText: string;
  fields: Array<{ name: string; value: string; confidence: number }>;
  overallConfidence: number;
};

@Injectable()
export class OcrService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.getOrThrow<string>("OPENAI_API_KEY");
    this.client = new OpenAI({ apiKey });
    this.model = this.config.get<string>("OPENAI_OCR_MODEL") ?? "gpt-4o-mini";
  }

  async extractFromFile(file: Express.Multer.File): Promise<OcrExtractResult> {
    if (file.mimetype === "application/pdf") {
      return this.extractFromPdf(file);
    }
    if (SUPPORTED_IMAGE_TYPES.has(file.mimetype)) {
      return this.extractFromImage(file);
    }
    throw new BadRequestException(
      `Unsupported file type: ${file.mimetype}. Supported: PDF, JPEG, PNG, WebP.`
    );
  }

  private async extractFromImage(file: Express.Multer.File): Promise<OcrExtractResult> {
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: IMAGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            { type: "text", text: "Extract all fields from this document." }
          ]
        }
      ]
    });

    return this.buildResult(response, file.originalname);
  }

  private async extractFromPdf(file: Express.Multer.File): Promise<OcrExtractResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (
      buf: Buffer
    ) => Promise<{ text: string }>;

    let text: string;
    try {
      const data = await pdfParse(file.buffer);
      text = data.text?.trim() ?? "";
    } catch {
      throw new InternalServerErrorException("Failed to parse PDF.");
    }

    if (!text) {
      throw new BadRequestException(
        "PDF contains no extractable text (scanned image). Convert it to JPEG/PNG and upload as an image."
      );
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TEXT_SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 12000) }
      ]
    });

    return this.buildResult(response, file.originalname);
  }

  private buildResult(
    response: OpenAI.Chat.ChatCompletion,
    documentId: string
  ): OcrExtractResult {
    const content = response.choices[0]?.message?.content;
    if (!content) throw new InternalServerErrorException("Empty response from OpenAI.");

    let parsed: ParsedOcrJson;
    try {
      parsed = JSON.parse(content) as ParsedOcrJson;
    } catch {
      throw new InternalServerErrorException("OpenAI returned invalid JSON.");
    }

    return {
      documentId,
      provider: "openai",
      model: this.model,
      rawText: String(parsed.rawText ?? ""),
      documentType: String(parsed.documentType ?? "other"),
      fields: (parsed.fields ?? []).map((f) => ({
        name: String(f.name ?? ""),
        value: String(f.value ?? ""),
        confidence: clamp(Number(f.confidence))
      })),
      overallConfidence: clamp(Number(parsed.overallConfidence)),
      tokenUsage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0
      }
    };
  }
}

function clamp(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
}
