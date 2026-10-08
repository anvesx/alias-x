import {extractAliases,HELP,InputError,parseCommand} from './core.ts';
import {Store} from './store.ts';
import type {SlackPort} from './slack.ts';
export class Service {
 constructor(private store:Store,private slack:SlackPort,private now:()=>number,private max:number){}
 async command(team:string,channel:string,user:string,text:string):Promise<string> {
 const cmd=parseCommand(text);
 const current=await this.slack.members(channel);
 if(!current.has(user)) throw new InputError('You must be a member of this channel.');
 if(cmd.action==='help') return HELP;
 if(cmd.action==='list') {
 const rows=await this.store.list(team,channel);
 return rows.length?rows.map(row=>`*!${row.name}* — ${JSON.parse(row.members).length} members`).join('\n'):'No aliases in this channel. Use /alias-x create.';
 }
 const name=cmd.name!;
 if(cmd.members?.some(u=>!current.has(u))) throw new InputError('Every target must be a current member of this channel.');
 if(cmd.action==='create') {
 await this.store.create(team,channel,name,cmd.members!,user,this.now(),this.max);
 // Creation record is visible without @mentioning recipients and unexpectedly notifying them.
 try {await this.slack.post(channel,`Alias *!${name}* created with ${cmd.members!.length} members. Use /alias-x show !${name} to inspect it.`);}
 catch {return `Created !${name}; channel announcement failed. Alias and audit are saved. Use show to verify; do not recreate it.`;}
 return `Created !${name}.`;
 }
 const row=await this.store.get(team,channel,name);
 if(!row) throw new InputError('Alias does not exist in this channel.');
 if(cmd.action==='show') return `*!${name}*\nMembers: ${JSON.parse(row.members).map((u:string)=>`<@${u}>`).join(' ')}\nCreated: ${new Date(row.created_at).toISOString()}`;
 if(cmd.action==='delete') {await this.store.remove(row,user,this.now());return `Deleted !${name}.`;}
 const previous=JSON.parse(row.members) as string[];
 const members=cmd.action==='set'?cmd.members!:cmd.action==='add'?[...new Set([...previous,...cmd.members!])]:previous.filter(u=>!cmd.members!.includes(u));
 if(!members.length||members.length>100) throw new InputError('An alias must contain 1–100 members. Delete the alias to remove it.');
 await this.store.update(row,members,this.now(),user,cmd.action);
 return `Updated !${name}: ${members.length} members.`;
 }
 async prepareMention(team:string,channel:string,names:readonly string[]):Promise<string|null> {
 if(!names.length) return null;
 // One indexed channel query avoids a SQL request per unknown alias in a long message.
 const byName=new Map((await this.store.list(team,channel)).map(row=>[row.name,row]));
 const known=[...new Set(names)].flatMap(name=>{const row=byName.get(name);return row?[row]:[];});
 if(!known.length) return null;
 const current=await this.slack.members(channel);const already=new Set<string>();
 for(const row of known) {
 for(const member of JSON.parse(row.members) as string[]) {
 if(current.has(member)) already.add(member);
 }
 }
 return already.size?[...already].map(u=>`<@${u}>`).join(' '):null;
 }
 async mention(team:string,channel:string,text:string,thread:string):Promise<void> {
 const reply=await this.prepareMention(team,channel,extractAliases(text));
 if(reply) await this.slack.post(channel,reply,thread);
 }
}
