// Studio action protocol scanner test — confirms the agent's ```studio JSON blocks are
// detected exactly once, parsed, normalised (unsafe keys/actions rejected), and stripped
// from the displayed prose, including mid-stream partial blocks.

import { createScanner, buildSystemPrompt, normaliseAction } from '../src/agent/agent.js';

let fail = 0, pass = 0;
const ok = (c, m) => { c ? (pass++, console.log('PASS ' + m)) : (fail++, console.log('FAIL ' + m)); };

const s = createScanner();

// A partially-streamed block must NOT execute yet, and its raw JSON must be hidden.
const partial = 'Look here:\n```studio\n{"action":"code","mode":"css"';
const r1 = s.scan(partial);
ok(r1.actions.length === 0, 'partial block does not fire');
ok(!s.displayText(partial).includes('"action"'), 'partial block hidden from prose');

// Close the block — now it fires exactly once.
const full = partial + ',"content":"body{color:red}"}\n```\ndone';
const r2 = s.scan(full);
ok(r2.actions.length === 1 && r2.actions[0].action === 'code' && r2.actions[0].mode === 'css', 'closed block parses to code action');
ok(s.scan(full).actions.length === 0, 'already-emitted block does not re-fire');
ok(s.displayText(full) === 'Look here:\n\ndone', 'closed block stripped from prose');

// Two blocks in one stream.
const s2 = createScanner();
const two = '```studio\n{"action":"run"}\n```\nx ```studio\n{"action":"quiz","question":"q","options":["a","b"],"answer":1}\n```';
const found = s2.scan(two).actions.map((a) => a.action);
ok(found.length === 2 && found[0] === 'run' && found[1] === 'quiz', 'two blocks both parsed');

// Unsafe / malformed actions are dropped by the normaliser.
ok(normaliseAction({ action: 'lab', method: 'rm -rf', args: [] }) === null, 'disallowed lab method rejected');
ok(normaliseAction({ action: 'code', mode: 'bash', content: 'x' }).mode === 'html', 'bad code mode coerced to html');
ok(normaliseAction({ action: 'quiz', question: 'x', options: ['only'] }) === null, 'quiz with <2 options rejected');
ok(normaliseAction({ action: 'nonsense' }) === null, 'unknown action rejected');
ok(normaliseAction({ action: 'lab', method: 'setEnvironment', args: 'studio' }).args.length === 0, 'non-array lab args normalised to []');

// trailing-comma JSON gets repaired.
const s3 = createScanner();
const repaired = s3.scan('```studio\n{"action":"run",}\n```').actions;
ok(repaired.length === 1 && repaired[0].action === 'run', 'trailing comma repaired');

// system prompt sanity
const sys = buildSystemPrompt({ mode: 'graphics', persona: 'socratic' });
ok(sys.includes('IRAGUHA Vincent'), 'prompt credits creator');
ok(sys.includes('Socratic'), 'prompt honours persona');
ok(sys.includes('the 3D Graphics Lab'), 'prompt reflects current surface');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
