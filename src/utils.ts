import picocolors from "picocolors";
import levenshtein from "fast-levenshtein";
import type { ToolCall } from "./trace.type.js";

export function error(message: string, exit: boolean = true) {
  console.error(picocolors.red('[ERROR]: ' + message));
  if (exit) process.exit(1);
}

export function warn(message: string) {
  console.warn(picocolors.yellow('[ERROR]: ' + message));
}

export function isEmptyToolCall(call: ToolCall) {
  return call?.output?.length == 0
    || Object.keys(call?.output ?? {}).length == 0;
}

export function countWords(str: string) {
  return str.trim() === "" ? 0 : str.trim().split(/\s+/g).length;
}

export function percent(num: number) {
  return (num * 100).toFixed(2) + '%';
}

export function countMatches(str: string, refList: string[]) {
  const matches: string[] = [];
  str = str.toLowerCase();
  refList.forEach(entry => {
    if (str.includes(entry)) matches.push(entry);
  });

  return matches;
}



export function normalizedSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;

  const distance = levenshtein.get(a, b);
  return Math.max(0.0, 1.0 - distance / maxLength);
}

export function checkToolArgsSimilarity(calls: ToolCall[]) {
  const args = calls.map(call => JSON.stringify(call.params));

  const uniquePairs = [];
  for (let i = 0; i < args.length; i++) {
    for (let j = i + 1; j < args.length; j++) {
      const sim = normalizedSimilarity(args[i]!, args[j]!);
      uniquePairs.push(sim);
    }
  }
  return uniquePairs.reduce((acc, pair) => acc + pair, 0) / uniquePairs.length;
}
