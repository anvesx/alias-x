export class InputError extends Error { readonly code='invalid_input'; }
export type Action='help'|'list'|'show'|'create'|'set'|'add'|'remove'|'delete';
export interface Command {action:Action; name?:string; members?:string[]}
export function aliasName(raw:string):string {
 const name=raw.replace(/^!/, '').toLowerCase();
 if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new InputError('Alias must be 1–64 letters, digits, underscores or hyphens.');
 return name;
}
export function parseCommand(text:string):Command {
 if(typeof text!=='string'||text.length>12000) throw new InputError('Command too long.');
 const [verb='help',raw,...rest]=text.trim().split(/\s+/).filter(Boolean);
 if(!['help','list','show','create','set','add','remove','delete'].includes(verb)) throw new InputError('Unknown action. Use /alias-x help.');
 const action=verb as Action;
 if(action==='help'||action==='list') {if(raw) throw new InputError('This action takes no arguments.'); return {action};}
 if(!raw) throw new InputError('Specify an alias.');
 const name=aliasName(raw);
 if(action==='show'||action==='delete') {if(rest.length) throw new InputError('Unexpected arguments.'); return {action,name};}
 if(!rest.length||rest.some(v=>!/^<@[UW][A-Z0-9]+(?:\|[^>]+)?>$/.test(v))) throw new InputError('Select one or more Slack members using @mentions.');
 const members=[...new Set(rest.map(v=>v.slice(2,-1).split('|')[0]!))];
 if(members.length>100) throw new InputError('Maximum 100 members per alias.');
 return {action,name,members};
}
export function extractAliases(text:string):string[] {
 const plain=text.replace(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|<[^>]*>|https?:\/\/\S+/g,' ');
 return [...new Set([...plain.matchAll(/(?:^|[^\p{L}\p{N}_!])!([a-z0-9][a-z0-9_-]{0,63})(?![\p{L}\p{N}_-])/giu)].map(m=>m[1]!.toLowerCase()))];
}
export const HELP='*alias-x* — channel-specific group mentions\n/alias-x create !devs @members\n/alias-x set !devs @members\n/alias-x add !devs @members\n/alias-x remove !devs @members\n/alias-x show !devs\n/alias-x list\n/alias-x delete !devs\nUse !devs in a message to mention current members in its thread. Members must belong to this channel.';
export function escapeSlack(s:string):string {return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
