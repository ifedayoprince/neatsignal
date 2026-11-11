import cac from 'cac';
import { trace } from 'console';
import { existsSync } from 'fs';
import { } from 'fs/promises';
import path from 'path';
import picocolors from 'picocolors';

function error(message: string, exit: boolean = true) {
  console.error(picocolors.red('[ERROR]: ' + message));
  if (exit) process.exit(1);
  return;
}

const cli = cac('Neatsignal');
cli
  .command('analyze [trace_file]', 'Trigger Neatsignal to analyze your trace and provide recommendations.')
  .action(async (file: string) => {
    const traceFile = path.resolve(file);

    if (
      !existsSync(traceFile) ||
      path.parse(traceFile).ext != "json"
    )
      error(`Trace file ${file} does not exist or is not a valid JSON file.`);

      
  });

cli.help();
cli.version('0.0.1');

cli.parse();
