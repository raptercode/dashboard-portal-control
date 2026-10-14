import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function command(file, name, context) {
  const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
  const body = source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(body);
  return runInNewContext(`${body}; ${name}`, context);
}

for (const kind of ['reset', 'configure']) {
  test(`${kind} CLI validates before acquisition and holds maintenance lease across all mutations`, async () => {
    let held = false;
    let busy = false;
    let failMutation = false;
    const calls = [];
    const mutation = (label, result) => async () => {
      assert.equal(held, true, `${label} requires the maintenance lease`);
      calls.push(label);
      if (failMutation && label === 'config') throw new Error('configuration write failed');
      return result;
    };
    const gate = async (operation) => {
      if (busy) throw new Error('maintenance busy');
      held = true;
      try { return await operation(); } finally { held = false; }
    };
    let run;
    let valid;
    let invalid;
    if (kind === 'reset') {
      const process = { getuid: () => 0, argv: ['node', 'password-config.mjs', '--reset-pwd'], stdout: { write: mutation('output') } };
      run = await command('password-config.mjs', 'runResetCommand', {
        process, withMaintenanceLease: gate, generateResetPassword: () => 'test-password',
        updateStoredPassword: mutation('config'), invalidateStoredSessions: mutation('database', 'owner@example.test'),
        restartDashboardService: mutation('restart'), DEFAULT_STATE_DATABASE_PATH: '/fixture/state.sqlite'
      });
      valid = () => run();
      invalid = async () => {
        process.argv = ['node', 'password-config.mjs', '--invalid'];
        try { await assert.rejects(run(), /Usage/); } finally { process.argv = ['node', 'password-config.mjs', '--reset-pwd']; }
      };
    } else {
      run = await command('dashboard-portal-update.mjs', 'configureUpdate', {
        parseOptions: (options) => options, resolve: (value) => value,
        stat: async () => ({ isFile: () => true }), readFile: async () => 'BEGIN PUBLIC KEY',
        fatal: (message) => { throw new Error(message); }, withMaintenanceLease: gate,
        copyFile: mutation('key'), chmod: mutation('permissions'), readConfig: async () => ({}),
        writeConfig: mutation('config'), updateConfiguration: (config) => config,
        softwareUpdateStatus: mutation('verification', { configured: true, status: 'available', channel: 'stable', currentVersion: '0.8.5' }),
        installedVersion: async () => '0.8.5', PUBLIC_KEY_FILE: '/fixture/key.pem',
        console: { log: mutation('output') }
      });
      valid = () => run({ manifest: 'https://updates.example.test/stable.json', 'public-key': '/fixture/source.pem' });
      invalid = () => assert.rejects(run({ manifest: 'http://updates.example.test', 'public-key': '/fixture/source.pem' }), /HTTPS/);
    }
    await invalid();
    assert.deepEqual(calls, []);
    busy = true;
    await assert.rejects(valid(), /maintenance busy/);
    assert.deepEqual(calls, []);
    busy = false;
    await valid();
    assert.equal(held, false);
    assert.ok(calls.includes('config'));
    assert.ok(calls.includes(kind === 'reset' ? 'restart' : 'verification'));
    failMutation = true;
    await assert.rejects(valid(), /configuration write failed/);
    assert.equal(held, false);
  });
}

test('software updater installation avoids a shared lease that would deadlock its exclusive installer', async () => {
  const source = await readFile(new URL('../scripts/dashboard-portal-update.mjs', import.meta.url), 'utf8');
  const body = source.match(/async function update\(values\) \{[^]*?\n\}/)[0];
  assert.doesNotMatch(body, /withMaintenanceLease/);
});
