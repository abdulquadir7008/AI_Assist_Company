export type AiProviderName = "openai" | "huggingface";

export type RetrievedChunk = {
  chromaId: string;
  content: string;
  title: string;
  documentId: string;
  category: string;
  distance?: number;
};

export type Citation = {
  documentId: string;
  title: string;
  category: string;
  chunkId: string;
};
