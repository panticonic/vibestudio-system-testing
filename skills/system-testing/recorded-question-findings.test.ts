import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordedFindingsBindNativeReferences as valid} from './recorded-question-findings.js';
const answer={disposition:'caution',originalRationale:'The original record describes a local loading trial.',affected:['dock/rules.md','dock/layout.md'],withdrawn:['dock/layout.md'],reasons:['The smaller trailer could not make the return turn.']};
const affected=['dock/layout.md','dock/rules.md'];
test('native reference binding permits supported paraphrase and reordered actual paths',()=>{assert.equal(valid(answer,affected,['dock/layout.md']),true);});
test('native reference binding permits extra actual evidence, leaving goal completeness to mandatory meaning review',()=>{assert.equal(valid({...answer,affected:['dock/layout.md']},affected,['dock/layout.md']),true);assert.equal(valid({...answer,affected:[...answer.affected,'dock/notes.md']},[...affected,'dock/notes.md'],['dock/layout.md']),true);});
test('refuses foreign affected paths and falsely attributed counteraction paths',()=>{assert.equal(valid({...answer,affected:['foreign/layout.md']},affected,['dock/layout.md']),false);assert.equal(valid({...answer,withdrawn:['dock/rules.md']},affected,['dock/layout.md']),false);});
test('requires an actual typed requested value and rejects malformed findings',()=>{for(const x of [undefined,null,'some text',{...answer,disposition:'ready'},{...answer,originalRationale:3},{...answer,affected:[3]},{...answer,reasons:undefined}])assert.equal(valid(x,affected,['dock/layout.md']),false);});
