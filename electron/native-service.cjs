'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function runtimeCommand({ packaged, resourcesPath, root, platform = process.platform, env = process.env }) {
  const binary = path.join(resourcesPath, 'native', platform === 'win32' ? 'studio-native.exe' : 'studio-native');
  // A distributed app must never silently use an unrelated machine Python.
  if (packaged || fs.existsSync(binary)) {
    if (!fs.existsSync(binary)) throw new Error('The bundled native runtime is missing. Reinstall this application.');
    return { executable: binary, args: ['--serve'], cwd: path.dirname(binary) };
  }
  const python = env.STUDIO_PYTHON || path.join(root, platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!fs.existsSync(python)) throw new Error('Development Python is missing. Install requirements.txt in .venv, then run npm run build.');
  return { executable: python, args: ['-m', 'server.entrypoint', '--serve'], cwd: root };
}

class NativeService extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.child = null;
    this.origin = null;
    this.token = randomBytes(32).toString('hex');
    this.stopping = false;
    this.failure = null;
    this.stderr = '';
  }
  async start() {
    const command = runtimeCommand(this.options);
    const env = { ...process.env, STUDIO_INSTANCE_TOKEN: this.token, PYTHONDONTWRITEBYTECODE: '1' };
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    this.child = spawn(command.executable, command.args, { cwd: command.cwd, env,
      detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const child = this.child;
    const failed = message => {
      if (this.stopping || this.failure) return;
      this.failure = new Error(message);
      this.emit('failure', this.failure);
    };
    child.on('error', error => failed('Native service could not start: ' + error.message));
    child.on('exit', (code, signal) => failed(`Native service stopped (${signal || code}).`));
    child.stdin.on('error', () => {}); // Exit/startup failures are handled above.
    child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-8192); });
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      if (output.length > 16384) return failed('Native service sent invalid startup output.');
      let newline;
      while ((newline = output.indexOf('\n')) !== -1) {
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (!line.startsWith('STUDIO_READY ') || this.origin) continue;
        try {
          const { port } = JSON.parse(line.slice('STUDIO_READY '.length));
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
          this.origin = `http://127.0.0.1:${port}`;
        } catch { failed('Native service sent an invalid endpoint.'); }
      }
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !this.failure) {
      if (this.origin) {
        try {
          const response = await fetch(this.origin + '/api/health', {
            headers: { 'X-Studio-Instance': this.token }, signal: AbortSignal.timeout(750), redirect: 'error'
          });
          const health = await response.json();
          if (response.ok && response.headers.get('x-studio-instance') === this.token &&
              health.status === 'ok' && health.parserVersion === '0.9.4' && health.isolatedWorkers === true &&
              child.exitCode === null && child.signalCode === null && !this.failure) return this.origin;
        } catch { /* The socket is bound before the server event loop is ready. */ }
      }
      await delay(100);
    }
    const error = this.failure || new Error('The native service did not become ready within 30 seconds.');
    await this.stop();
    throw error;
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = this._stop();
    return this.stopPromise;
  }
  async _stop() {
    const child = this.child;
    if (!child || !child.pid) return;
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    if (!exited()) child.stdin.end();
    for (let i = 0; i < 40 && !exited(); i++) await delay(100);
    // Terminate only the process tree we created, including one-shot workers.
    if (process.platform === 'win32') {
      if (!exited()) await new Promise(resolve => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', resolve); killer.once('exit', resolve);
      });
    } else if (!exited()) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await delay(150);
      try { if (!exited()) process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
}
module.exports = { NativeService, runtimeCommand };
