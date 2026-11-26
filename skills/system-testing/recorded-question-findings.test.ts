import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasRecordedFindings as valid} from './recorded-question-findings.js';
test('requires the actual requested query value without an internal enum/list report',()=>{assert.equal(valid({answer:'The smaller trailer could not make the return turn.'}),true);assert.equal(valid({answer:'The record is ambiguous between two distinct proposals.'}),true);});
test('rejects absent, empty or malformed answers',()=>{for(const x of [undefined,null,[], 'text',{}, {answer:''},{answer:'  '},{answer:3},{disposition:'supported',affected:[],reasons:[]}])assert.equal(valid(x),false);});
