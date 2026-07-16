import fs from "node:fs/promises";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import type { ExtractedBlock } from "../types.js";

// Marker appended per page by the custom pagerender so pages can be split apart.
const pageSeparator = "\f";

// Mirrors pdf-parse's default render_page line-break heuristic, plus the page separator.
async function renderPdfPage(pageData: any): Promise<string> {
  const textContent = await pageData.getTextContent();
  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY === undefined) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = item.transform[5];
  }
  return text + pageSeparator;
}

function extractPdfBlocks(text: string): ExtractedBlock[] {
  // Assign page numbers before filtering so blank pages do not shift numbering.
  return text
    .split(pageSeparator)
    .map((pageText, index) => ({ text: pageText, page: index + 1 }))
    .filter((block) => block.text.trim().length > 0);
}

function extractMarkdownBlocks(raw: string): ExtractedBlock[] {
  const headingPattern = /^#{1,6}\s+(.+)$/gm;
  const blocks: ExtractedBlock[] = [];
  let lastIndex = 0;
  let currentSection: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(raw)) !== null) {
    const body = raw.slice(lastIndex, match.index);
    if (body.trim()) {
      blocks.push({ text: body, section: currentSection });
    }
    currentSection = match[1].trim();
    lastIndex = match.index + match[0].length;
  }

  const tail = raw.slice(lastIndex);
  if (tail.trim()) {
    blocks.push({ text: tail, section: currentSection });
  }

  return blocks.length > 0 ? blocks : raw.trim() ? [{ text: raw }] : [];
}

function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "));
}

function extractHtmlBlocks(html: string): ExtractedBlock[] {
  const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const blocks: ExtractedBlock[] = [];
  let lastIndex = 0;
  let currentSection: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(html)) !== null) {
    const body = stripTags(html.slice(lastIndex, match.index));
    if (body.trim()) {
      blocks.push({ text: body, section: currentSection });
    }
    currentSection = stripTags(match[2]).trim() || currentSection;
    lastIndex = match.index + match[0].length;
  }

  const tail = stripTags(html.slice(lastIndex));
  if (tail.trim()) {
    blocks.push({ text: tail, section: currentSection });
  }

  return blocks;
}

export async function extractText(filePath: string, mimeType: string): Promise<ExtractedBlock[]> {
  const buffer = await fs.readFile(filePath);

  if (mimeType === "application/pdf") {
    const result = await pdf(buffer, { pagerender: renderPdfPage });
    return extractPdfBlocks(result.text);
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filePath.endsWith(".docx")
  ) {
    // convertToHtml preserves headings, which extractRawText discards.
    const result = await mammoth.convertToHtml({ buffer });
    const blocks = extractHtmlBlocks(result.value);
    if (blocks.length > 0) {
      return blocks;
    }
    const fallback = await mammoth.extractRawText({ buffer });
    return fallback.value.trim() ? [{ text: fallback.value }] : [];
  }

  if (filePath.endsWith(".md") || mimeType === "text/markdown") {
    return extractMarkdownBlocks(buffer.toString("utf-8"));
  }

  if (
    mimeType.startsWith("text/") ||
    filePath.endsWith(".txt") ||
    filePath.endsWith(".csv")
  ) {
    const text = buffer.toString("utf-8");
    return text.trim() ? [{ text }] : [];
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
