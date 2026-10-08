import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractAliases, parseCommand} from '../src/core.ts';
test('standalone aliases ignore code, links, embedded tokens, deduplicate case',()=>{
 assert.deepEqual(extractAliases('Hi !Devs !devs and !ops-team. a!no `!code` ```!fenced``` <https://x.test/!url>'),['devs','ops-team']);
});
test('command contract parses Slack mentions and deduplicates',()=>{
 assert.deepEqual(parseCommand('create !DEVS <@U123> <@U123> <@W456>'),{action:'create',name:'devs',members:['U123','W456']});
});
test('commands accept more than 100 members and paged inspection',()=>{
 const members=Array.from({length:150},(_,i)=>'U'+String(i).padStart(5,'0'));
 assert.deepEqual(parseCommand('create large '+members.map(u=>`<@${u}>`).join(' ')).members,members);
 assert.deepEqual(parseCommand('list !after'),{action:'list',after:'after'});
 assert.deepEqual(parseCommand('show large 2'),{action:'show',name:'large',page:2});
 for(const text of ['show large 0','show large -1','show large 1.5','show large 9007199254740992']) assert.throws(()=>parseCommand(text));
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
