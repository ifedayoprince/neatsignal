import picocolors from "picocolors";
import type { ToolCall } from "./trace.type.js";
import { match } from "node:assert";

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

export function checkToolArgsSimilarity(calls: ToolCall[]) {
  // To be implemented
  return 1;
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
