// Admin gating logic — actionAllowed() and buildSystemPrompt() honour operator controls.

import { actionAllowed, buildSystemPrompt } from '../src/agent/agent.js';

let fail = 0, pass = 0;
const ok = (c, m) => { c ? (pass++, console.log('PASS ' + m)) : (fail++, console.log('FAIL ' + m)); };

const allOn = { allowCode: true, allowLab: true, skills: { code: true, run: true, lab: true, annotate: true, dragdrop: true, simulate: true, quiz: true, lesson: true } };

// default (no admin) allows everything
ok(actionAllowed(undefined, { action: 'code' }) === true, 'no admin => code allowed');
ok(actionAllowed(allOn, { action: 'quiz' }) === true, 'all-on => quiz allowed');

// per-skill off
const noQuiz = { ...allOn, skills: { ...allOn.skills, quiz: false } };
ok(actionAllowed(noQuiz, { action: 'quiz' }) === false, 'quiz skill off blocks quiz');
ok(actionAllowed(noQuiz, { action: 'code' }) === true, 'quiz off does not block code');

// master guardrails override skills
const noCode = { ...allOn, allowCode: false };
ok(actionAllowed(noCode, { action: 'code' }) === false, 'allowCode=false blocks code');
ok(actionAllowed(noCode, { action: 'run' }) === false, 'allowCode=false blocks run');
const noLab = { ...allOn, allowLab: false };
ok(actionAllowed(noLab, { action: 'lab' }) === false, 'allowLab=false blocks lab');
ok(actionAllowed(noLab, { action: 'annotate' }) === true, 'allowLab=false keeps annotate');

// unknown action
ok(actionAllowed(allOn, { action: 'rm-rf' }) === false, 'unknown action denied');

// prompt reflects admin
const p = buildSystemPrompt({ mode: 'code', persona: 'mentor', admin: { ...noQuiz, allowLab: false, customInstructions: 'Answer tersely.' } });
ok(p.includes('KEZA'), 'prompt names KEZA');
ok(p.includes('Answer tersely.'), 'custom instructions appended');
ok(p.includes('OPERATOR LIMITS'), 'guardrails section present');
ok(!p.includes('"action":"quiz"'), 'disabled quiz action not advertised');
ok(!p.includes('"action":"lab"'), 'lab action hidden when allowLab false');
ok(p.includes('"action":"code"'), 'enabled code action still advertised');

// empty admin => full prompt
const full = buildSystemPrompt({ mode: 'graphics', persona: 'socratic', admin: {} });
ok(full.includes('OPERATOR LIMITS') === false, 'no guardrails when nothing blocked');
ok(full.includes('Socratic'), 'persona honoured');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
