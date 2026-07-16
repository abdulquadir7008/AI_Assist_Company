import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractText } from "./extractText.js";

const tempFiles: string[] = [];

async function tempFile(name: string, content: string): Promise<string> {
  const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "extract-test-")), name);
  await fs.writeFile(filePath, content, "utf-8");
  tempFiles.push(path.dirname(filePath));
  return filePath;
}

afterAll(async () => {
  await Promise.all(tempFiles.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("extractText markdown", () => {
  it("splits on headings and assigns each body its section", async () => {
    const filePath = await tempFile(
      "policy.md",
      "Intro paragraph.\n\n# Remote Work\nThree days a week.\n\n## Equipment\nLaptops are provided.\n"
    );

    const blocks = await extractText(filePath, "text/markdown");

    expect(blocks).toEqual([
      { text: expect.stringContaining("Intro paragraph."), section: undefined },
      { text: expect.stringContaining("Three days a week."), section: "Remote Work" },
      { text: expect.stringContaining("Laptops are provided."), section: "Equipment" }
    ]);
  });

  it("returns a single sectionless block when there are no headings", async () => {
    const filePath = await tempFile("notes.md", "Just some notes without headings.");
    const blocks = await extractText(filePath, "text/markdown");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].section).toBeUndefined();
  });
});

describe("extractText plain text", () => {
  it("returns a single block for txt", async () => {
    const filePath = await tempFile("readme.txt", "Plain content.");
    const blocks = await extractText(filePath, "text/plain");
    expect(blocks).toEqual([{ text: "Plain content." }]);
  });

  it("returns empty for whitespace-only files", async () => {
    const filePath = await tempFile("empty.txt", "   \n ");
    const blocks = await extractText(filePath, "text/plain");
    expect(blocks).toEqual([]);
  });

  it("rejects unsupported types", async () => {
    const filePath = await tempFile("image.bin", "binary");
    await expect(extractText(filePath, "image/png")).rejects.toThrow("Unsupported file type");
  });
});
