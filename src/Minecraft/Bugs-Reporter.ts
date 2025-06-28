import fs from 'fs';
import os from 'os';
import path from 'path';

interface LogEntry {
  level: string;
  message: string;
}

interface ExceptionReport {
  message: string;
  stack?: string;
}

export class BugReporter {
  private static appVersion: string;
  private static isDev: boolean;
  private static logs: LogEntry[] = [];
  private static lastLog: string = '';
  private static launcherDir: string;
  private static processType: string;

  public static configure(appVersion: string, isDev: boolean, launcherDir: string, processType: string): void {
    this.appVersion = appVersion;
    this.isDev = isDev;
    this.launcherDir = launcherDir;
    this.processType = processType;
  }

  public static getLauncherUrl(): string {
    return this.isDev ? "http://localhost:8000" : "https://panel.crazycity.fr";
  }

  public static getApiURL(): string {
    return `${this.getLauncherUrl()}/api/bugreport/submit`;
  }

  public static initDumpLogs(): void {
    (console as any).log_old = console.log;
    (console as any).error_old = console.error;

    const addLog = (level: string, message: string): void => {
      if (message === this.lastLog) return;
      this.lastLog = message;
      this.logs.push({ level, message });
    };

    console.log = (...args: any[]): void => {
      const msg = args.map(String).join(' ');
      addLog('info', msg);
      (console as any).log_old(...args);
    };

    console.error = (...args: any[]): void => {
      const msg = args.map(String).join(' ');
      addLog('error', msg);
      (console as any).error_old(...args);
    };
  }

  public static dumpLogs(): LogEntry[] {
    return this.logs;
  }

  public static async report(exception: ExceptionReport): Promise<void> {
    const dir = path.join(this.launcherDir, 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString();

    const payload = {
      timestamp,
      version: this.appVersion,
      electronVersion: process.versions.electron,
      processType: this.processType || 'main',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch()
      },
      exception: {
        message: exception.message,
        stack: exception.stack,
        dump: this.dumpLogs()
      }
    };

    try {
      const res = await fetch(this.getApiURL(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: payload })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(err)}`);
      }

      console.info('Bug report successfully sent !');
    } catch (err: any) {
      console.error('Unable to send Bug report, saving locally : ', err.message);
      fs.writeFileSync(
        path.join(dir, `report-${timestamp.replace(/[:.]/g, '-')}.json`),
        JSON.stringify({ metadata: payload }, null, 2)
      );
    }
  }

  public static async flushPending(): Promise<void> {
    const dir = path.join(this.launcherDir, 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const payloadPath = path.join(dir, file);
      const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')).metadata;

      try {
        const res = await fetch(this.getApiURL(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: payload })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(`HTTP ${res.status}: ${JSON.stringify(err)}`);
        }

        fs.unlinkSync(payloadPath);
        console.info(`Bug report ${file} successfully sent and deleted.`);
      } catch (err: any) {
        console.error('Unable to send Bug report, it will be sent on the next launch', err.message);
      }
    }
  }
}
