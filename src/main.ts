import boxen from 'boxen';
import cac from 'cac';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import picocolors from 'picocolors';
import type { MessageEntry, RawTraceFile } from './trace.type.js';
import { error } from './utils.js';
import { normalizeOtel } from './otel.js';
import { TOOL_WINDOW_SIZE } from './constants.js';
import { FrictionMonitor } from './friction.js';
import figlet from 'figlet';

const cli = cac('Neatsignal');
cli
  .command('analyze [trace_file]', 'Trigger Neatsignal to analyze your trace and provide recommendations.')
  .action(async (file: string) => {
    const traceFile = path.resolve(file);

    if (
      !existsSync(traceFile) ||
      path.parse(traceFile).ext != ".json"
    )
      error(`Trace file ${file} does not exist or is not a valid JSON file.`);

    const contentStr = await readFile(traceFile);
    let content: RawTraceFile | null = null;
    try {
      content = JSON.parse(contentStr.toString('utf8')) as RawTraceFile;
      if (!content) throw new Error();
    } catch {
      error("Could not parse trace file. Please ensure JSON is valid.");
    }

    if (!content) return;

    console.log(picocolors.green(await figlet("Neatsignal")))
    console.log(`           Trace analyzer built by Ifedayo\n\n`)
    console.log(boxen(
      `
${picocolors.green('Trace File:')} ${picocolors.gray(traceFile)}
${picocolors.green('Trace ID:')} ${content?.trace_id ?? "No TraceID"}
${picocolors.green('Session ID:')} ${content?.session_id ?? "No Session"}
${picocolors.green('Total Spans:')} ${content?.spans?.length?.toLocaleString()} (s)
`.trim(),
      {
        title: "Input Trace",
        padding: 1
      })
    );

    let messages: MessageEntry[] = normalizeOtel(content);
    const monitor = new FrictionMonitor(messages);
    await monitor.scan();
  });

cli.help();
cli.version('0.0.1');

cli.parse();
