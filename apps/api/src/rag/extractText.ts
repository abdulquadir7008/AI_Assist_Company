import fs from "node:fs/promises";
import mammoth from "mammoth";
import pdf from "pdf-parse";

export async function extractText(filePath: string, mimeType: string): Promise<string> {
  const buffer = await fs.readFile(filePath);

  if (mimeType === "application/pdf") {
    const result = await pdf(buffer);
    return result.text;
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filePath.endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (
    mimeType.startsWith("text/") ||
    filePath.endsWith(".md") ||
    filePath.endsWith(".txt") ||
    filePath.endsWith(".csv")
  ) {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
