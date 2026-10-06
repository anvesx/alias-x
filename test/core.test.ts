import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractAliases, parseCommand} from '../src/core.ts';
test('standalone aliases ignore code, links, embedded tokens, deduplicate case',()=>{
 assert.deepEqual(extractAliases('Hi !Devs !devs and !ops-team. a!no `!code` ```!fenced``` <https://x.test/!url>'),['devs','ops-team']);
});
test('command contract parses Slack mentions and deduplicates',()=>{
 assert.deepEqual(parseCommand('create !DEVS <@U123> <@U123> <@W456>'),{action:'create',name:'devs',members:['U123','W456']});
});
test('invalid command inputs fail explicitly',()=>{
 for(const value of ['create devs','create 😀 <@U123>','create devs @everyone','wat devs','delete devs extra']) assert.throws(()=>parseCommand(value));
});

test('unterminated code and token boundaries do not leak mentions',()=>{
 assert.deepEqual(extractAliases('!ok `!hidden'),['ok']);
 assert.deepEqual(extractAliases('!ok ```!hidden'),['ok']);
 assert.deepEqual(extractAliases('prefix!no ü!no !yes !!no https://example.test/!no'),['yes']);
 assert.throws(()=>parseCommand('x'.repeat(12001)),/too long/);
});
