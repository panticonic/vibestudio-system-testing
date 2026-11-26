/** Actual sender methods/SQLite plus canonical owned messaging helper, controlled notification and committed read ports. */
import {afterEach,expect,it} from 'vitest';
import {createTestDO} from '@vibestudio/durable/test-utils';
import {createLocalMessaging,type OwnedMessagingLease,type Receipt} from '@workspace-skills/messaging/local-workflow';
import {LocalMessagingSenderDO} from './index.js';
class Sender extends LocalMessagingSenderDO {
 notifyCount=0;
 finishNotify:()=>Promise<void>=async()=>{};
 committed:string|null=null;
 protected override localMessagingBindings(options:{lease:OwnedMessagingLease;assertOwnedFixture:()=>Promise<OwnedMessagingLease>;inspectCommitted:Parameters<typeof createLocalMessaging>[0]['inspectCommitted']}){
  return createLocalMessaging({...options,addressees:async()=>[{ref:'@mira',kind:'agent',note:'Owned reviewer Mira'}],notify:async(input)=>{this.notifyCount++;await this.finishNotify();this.committed=input.content;return {messageId:'actual-message',channelId:options.lease.channelId};},inspectCommitted:async(receipt)=>({channelId:options.lease.channelId,messageId:receipt?.messageId??null,committed:this.committed!==null,recipientRefs:this.committed===null?[]:['@mira'],content:this.committed,evidence:['Controlled committed Native port']})});
 }
}
const databases:Array<{close():void}>=[];afterEach(()=>{for(const db of databases.splice(0))db.close();});
async function sender(){const image={WORKER_SOURCE:'workers/local-messaging-fixture',WORKER_CLASS_NAME:'LocalMessagingSenderDO',WORKER_EXECUTION_DIGEST:'e'.repeat(64)};const probe=await createTestDO(Sender,{...image,VIBESTUDIO_SCHEMA_PROBE:true},{initialize:false});databases.push(probe.db);const descriptor=await probe.instance.fetch(new Request('http://test/test-key/__vibestudio_schema_descriptor'));expect(descriptor.ok).toBe(true);const native=await createTestDO(Sender,{...image,VIBESTUDIO_SCHEMA_DESCRIPTOR:await descriptor.json()});databases.push(native.db);const configuration={contextId:'owned-context',fixtureId:'owned-fixture',channelId:'owned-channel',channelTargetId:'owned-channel-target',channelRef:{source:'workers/local-messaging-fixture',className:'LocalMessagingChannelDO',objectKey:'owned-channel'},handle:'sender',name:'Owned sender',lease:{fixtureId:'owned-fixture',channelId:'owned-channel',senderParticipantId:'owned-sender',operationId:'owned-operation',active:true,recipients:[{ref:'@mira',participantId:'owned-mira',kind:'agent'}]}};native.sql.exec('INSERT INTO messaging_configuration(id,json) VALUES(1,?)',JSON.stringify(configuration));return{...native,configuration};}
it('closes durable send admission without releasing exact read custody or committed-byte inspection',async()=>{
 const n=await sender(),snapshot=await n.instance.inspect('@mira');const receipt=await n.instance.send(snapshot.revision,'@mira','@mira','The actual authorized follow-up');await n.instance.closeAdmission();
 const retained=JSON.parse(String(n.sql.exec('SELECT json FROM messaging_configuration WHERE id=1').one()['json']));expect(retained.sendAdmissionClosed).toBe(true);expect(retained.lease.active).toBe(true);expect(await n.instance.inspectDelivery(receipt)).toMatchObject({committed:true,messageId:receipt.messageId,content:'The actual authorized follow-up',recipientRefs:['@mira']});expect((await n.instance.inspect('@mira')).fixtureId).toBe('owned-fixture');
 await expect(n.instance.send(snapshot.revision,'@mira','@mira','A forbidden late send')).rejects.toThrow('admission is closed');expect(n.instance.notifyCount).toBe(1);
 await expect(n.instance.configure(n.configuration as never)).rejects.toThrow('configuration is immutable');
});
it('joins the original admitted pending send while refusing new sends, then permits its independent readback',async()=>{
 const n=await sender(),snapshot=await n.instance.inspect('@mira');let release!:()=>void;n.instance.finishNotify=()=>new Promise<void>(resolve=>{release=resolve;});const sending=n.instance.send(snapshot.revision,'@mira','@mira','Original in-flight exact bytes');for(let i=0;i<20&&!release;i++)await Promise.resolve();expect(n.instance.notifyCount).toBe(1);let closed=false;const closing=n.instance.closeAdmission().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);await expect(n.instance.send(snapshot.revision,'@mira','@mira','Late duplicate')).rejects.toThrow('admission is closed');release();const receipt=await sending;await closing;expect(closed).toBe(true);expect((await n.instance.inspectDelivery(receipt)).content).toBe('Original in-flight exact bytes');expect(n.instance.notifyCount).toBe(1);
});
it('does not weaken actual released-lease or foreign receipt checks after send closure',async()=>{
 const n=await sender();await n.instance.closeAdmission();await expect(n.instance.inspectDelivery({messageId:'foreign',channelId:'other-channel',to:'@mira',alert:'none'} as Receipt)).rejects.toThrow('outside the owned');
 const retained=JSON.parse(String(n.sql.exec('SELECT json FROM messaging_configuration WHERE id=1').one()['json']));retained.lease.active=false;n.sql.exec('UPDATE messaging_configuration SET json=? WHERE id=1',JSON.stringify(retained));await expect(n.instance.inspectDelivery(null)).rejects.toThrow('changed or was released');await expect(n.instance.inspect('@mira')).rejects.toThrow('changed or was released');
});
