import picocolors from "picocolors";

export function error(message: string, exit: boolean = true) {
  console.error(picocolors.red('[ERROR]: ' + message));
  if (exit) process.exit(1);
}

export function warn(message: string) {
  console.warn(picocolors.yellow('[ERROR]: ' + message));
}
