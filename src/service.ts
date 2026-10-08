import {HELP,InputError,parseCommand} from './core.ts';
import {Store} from './store.ts';
import type {SlackPort} from './slack.ts';
export class Service {
 constructor(private store:Store,private slack:SlackPort,private now:()=>number){}
 async command(team:string,channel:string,user:string,text:string):Promise<string> {
 const cmd=parseCommand(text);
 const current=await this.slack.members(channel);
 if(!current.has(user)) throw new InputError('You must be a member of this channel.');
 if(cmd.action==='help') return HELP;
 if(cmd.action==='list') {
 const rows=await this.store.listPage(team,channel,cmd.after);
 if(!rows.length) return cmd.after?'No more aliases in this channel.':'No aliases in this channel. Use /alias-x create.';
 const page=rows.slice(0,100);
 return page.map(row=>`*!${row.name}* — ${row.member_count} members`).join('\n')+(rows.length>100?`\nNext: /alias-x list !${page.at(-1)!.name}`:'');
 }
 const name=cmd.name!;
 // Removing a stored recipient must remain possible after they leave the channel.
 if(cmd.action!=='remove'&&cmd.members?.some(u=>!current.has(u))) throw new InputError('Every target must be a current member of this channel.');
 if(cmd.action==='create') {
 await this.store.create(team,channel,name,cmd.members!,user,this.now());
 // Creation record is visible without @mentioning recipients and unexpectedly notifying them.
 try {await this.slack.post(channel,`Alias *!${name}* created with ${cmd.members!.length} members. Use /alias-x show !${name} to inspect it.`);}
 catch {return `Created !${name}; channel announcement failed. Alias and audit are saved. Use show to verify; do not recreate it.`;}
 return `Created !${name}.`;
 }
 const row=await this.store.get(team,channel,name);
 if(!row) throw new InputError('Alias does not exist in this channel.');
 if(cmd.action==='show') {
 const members=JSON.parse(row.members) as string[];const page=cmd.page??1;const pages=Math.ceil(members.length/200);
 if(page>pages) throw new InputError(`Page does not exist. This alias has ${pages} member pages.`);
 return `*!${name}*\nMembers${pages>1?` (page ${page}/${pages})`:''}: ${members.slice((page-1)*200,page*200).map(u=>`<@${u}>`).join(' ')}\nCreated: ${new Date(row.created_at).toISOString()}`+(page<pages?`\nNext: /alias-x show !${name} ${page+1}`:'');
 }
 if(cmd.action==='delete') {await this.store.remove(row,user,this.now());return `Deleted !${name}.`;}
 const previous=JSON.parse(row.members) as string[];
 const removed=new Set(cmd.members);
 const members=cmd.action==='set'?cmd.members!:cmd.action==='add'?[...new Set([...previous,...cmd.members!])]:previous.filter(u=>!removed.has(u));
 if(!members.length) throw new InputError('An alias must contain at least one member. Delete the alias to remove it.');
 await this.store.update(row,members,this.now(),user,cmd.action);
 return `Updated !${name}: ${members.length} members.`;
 }
 async resolveMembers(team:string,channel:string,names:readonly string[]):Promise<string[]> {
 if(!names.length) return [];
 // Read only the selected aliases using one JSON binding, independent of alias count.
 const byName=new Map((await this.store.getMany(team,channel,[...new Set(names)])).map(row=>[row.name,row]));
 const known=[...new Set(names)].flatMap(name=>{const row=byName.get(name);return row?[row]:[];});
 if(!known.length) return [];
 const current=await this.slack.members(channel);const already=new Set<string>();
 for(const row of known) {
 for(const member of JSON.parse(row.members) as string[]) {
 if(current.has(member)) already.add(member);
 }
 }
 return [...already];
 }
}
