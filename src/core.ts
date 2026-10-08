export class InputError extends Error { readonly code='invalid_input'; }
export type Action='help'|'list'|'show'|'create'|'set'|'add'|'remove'|'delete';
export interface Command {action:Action; name?:string; members?:string[]; after?:string; page?:number}
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
 if(action==='help') {if(raw) throw new InputError('This action takes no arguments.'); return {action};}
 if(action==='list') {if(rest.length) throw new InputError('Use list or list !AFTER_ALIAS.');return raw?{action,after:aliasName(raw)}:{action};}
 if(!raw) throw new InputError('Specify an alias.');
 const name=aliasName(raw);
 if(action==='show') {
 if(!rest.length) return {action,name};
 const page=Number(rest[0]);
 if(rest.length!==1||!/^\d+$/.test(rest[0]!)||!Number.isSafeInteger(page)||page<1) throw new InputError('Page must be a positive integer.');
 return {action,name,page};
 }
 if(action==='delete') {if(rest.length) throw new InputError('Unexpected arguments.'); return {action,name};}
 if(!rest.length||rest.some(v=>!/^<@[UW][A-Z0-9]+(?:\|[^>]+)?>$/.test(v))) throw new InputError('Select one or more Slack members using @mentions.');
 const members=[...new Set(rest.map(v=>v.slice(2,-1).split('|')[0]!))];
 return {action,name,members};
}
export function extractAliases(text:string):string[] {
 const plain=text.replace(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|<[^>]*>|https?:\/\/\S+/g,' ');
 return [...new Set([...plain.matchAll(/(?:^|[^\p{L}\p{N}_!])!([a-z0-9][a-z0-9_-]{0,63})(?![\p{L}\p{N}_-])/giu)].map(m=>m[1]!.toLowerCase()))];
}
export const HELP='*alias-x* — channel-specific group mentions\n/alias-x create !devs @members\n/alias-x set !devs @members\n/alias-x add !devs @members\n/alias-x remove !devs @members\n/alias-x show !devs [PAGE]\n/alias-x list [!AFTER_ALIAS]\n/alias-x delete !devs\nUse !devs in a message to mention current members in its thread. Members must belong to this channel. No alias-count or member-count quotas. For large groups, add members in multiple commands; list/show include the next-page command.';
export function escapeSlack(s:string):string {return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
