const dimensions = 256;

export function embedText(text: string): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const index = positiveHash(token) % dimensions;
    vector[index] += weight(token);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
}

export function cosineSimilarity(left: unknown, right: number[]): number {
  if (!Array.isArray(left) || !right.length) return 0;
  const limit = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < limit; index += 1) {
    const value = Number(left[index]);
    if (Number.isFinite(value)) sum += value * right[index];
  }
  return sum;
}

export function extractKeywords(content: string, limit = 80): string[] {
  return [...new Set(tokenize(content).filter((token) => token.length >= 2))].slice(0, limit);
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[\p{Script=Han}]{2,8}|[a-z0-9][a-z0-9_-]{1,}/gu) ?? [];
  const grams: string[] = [];
  for (const word of words) {
    grams.push(word);
    if (/[\p{Script=Han}]/u.test(word)) {
      for (let index = 0; index < word.length - 1; index += 1) {
        grams.push(word.slice(index, index + 2));
      }
    }
  }
  return grams;
}

function positiveHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function weight(token: string): number {
  return Math.min(3, 1 + Math.log10(Math.max(1, token.length)));
}
