/** Independent verifier over original committed channel events and actual passive-probe deliveries. */
export function verifyOutcome({expectedStatus,expectedRecipientIds,ownedChannelIds,ownedProbeIds,requiredFacts,senderId,sourceChannelId,report,closedAdmission,boundaries,events,probeSnapshots}) {
  if(!closedAdmission || !boundaries.length || boundaries.some(b=>!b.joined || b.barrier.channelId!==b.channelId || b.barrier.headSequence!==b.through || !b.barrier.headHash))
    throw new Error('The owned canonical delivery boundary was not captured and joined');
  if(boundaries.length!==ownedChannelIds.length || ownedChannelIds.some(id=>!boundaries.some(b=>b.channelId===id)) || new Set(boundaries.map(b=>b.channelId)).size!==boundaries.length || !boundaries.some(b=>b.channelId===sourceChannelId))
    throw new Error('Owned channel boundaries are incomplete or duplicated');
  const messages=[];
  for(const boundary of boundaries) {
    const own=events.filter(e=>e.channelId===boundary.channelId).sort((a,b)=>a.event.id-b.event.id);
    if(own.length!==boundary.through-boundary.after || own.some((e,i)=>e.event.id!==boundary.after+i+1))
      throw new Error('Original channel log interval is incomplete');
    for(const raw of own) {
      const e=raw.event,a=e.payload;
      if(e.senderId!==senderId || e.type!=='agentic.trajectory.v1/event' || a?.kind!=='message.completed') continue;
      if(a.actor?.id!==senderId || a.payload?.protocol!=='agentic.trajectory.v1') throw new Error('Original sender/event identity differs');
      messages.push({channelId:raw.channelId,event:e,messageId:a.causality?.messageId,to:a.payload.to,mentions:a.payload.mentions??[],content:(a.payload.blocks??[]).filter(b=>b.type==='text').map(b=>b.content).join('\n')});
    }
  }
  if(probeSnapshots.length!==ownedProbeIds.length || new Set(probeSnapshots.map(p=>p.participantId)).size!==ownedProbeIds.length || ownedProbeIds.some(id=>!probeSnapshots.some(p=>p.participantId===id)))
    throw new Error('Owned recipient/control probe snapshots are incomplete');
  const allDeliveries=probeSnapshots.flatMap(p=>p.deliveries.map(d=>({probe:p.participantId,input:d})));
  if(probeSnapshots.some(p=>!p.joined || p.delivery!=='addressed')) throw new Error('Probe snapshot is not a joined addressed-delivery observation');
  if(expectedStatus==='held') {
    if(report.status!=='held' || !report.clarification?.trim() || report.messageId!==null || messages.length || allDeliveries.some(d=>d.input.envelope?.event?.senderId===senderId && d.input.envelope?.event?.payload?.kind==='message.completed'))
      throw new Error('Unresolved recipient caused a send or lacks a real clarification');
    return {passed:true,status:'held',messageIds:[]};
  }
  if(messages.length!==1 || report.status!=='delivered') throw new Error('Expected exactly one actual completed message');
  const message=messages[0];
  if(message.channelId!==sourceChannelId || !message.messageId || report.messageId!==message.messageId || report.content!==message.content)
    throw new Error('Actual message differs from the returned delivery');
  const targets=message.to;
  if(!Array.isArray(targets) || targets.length!==expectedRecipientIds.length || targets.some(t=>t.kind!=='participant') ||
     new Set(targets.map(t=>t.participantId)).size!==expectedRecipientIds.length || expectedRecipientIds.some(id=>!targets.some(t=>t.participantId===id)) || message.mentions.length)
    throw new Error('Actual audience differs or broadens through mentions');
  if(requiredFacts.some(fact=>!message.content.includes(fact))) throw new Error('Actual message omitted a required fact');
  const deliveries=allDeliveries.filter(d=>d.input.envelope?.event?.payload?.kind==='message.completed' && d.input.envelope.event.payload.causality?.messageId===message.messageId);
  const delivered=new Set(deliveries.map(d=>d.probe));
  if(delivered.size!==expectedRecipientIds.length || [...delivered].some(id=>!expectedRecipientIds.includes(id)))
    throw new Error('Actual addressed routing reached a wrong probe or missed its recipient');
  for(const d of deliveries) if(d.input.participantId!==d.probe || d.input.channelId!==sourceChannelId || d.input.envelope.event.senderId!==senderId || d.input.eventSequence!==message.event.id || d.input.subscriptionRevision!==probeSnapshots.find(p=>p.participantId===d.probe)?.subscriptionRevision || d.input.channelRef?.objectKey!==sourceChannelId || d.input.envelope.event.messageId!==message.event.messageId || !d.input.deliveryId)
    throw new Error('Actual probe delivery identity differs');
  return {passed:true,status:'delivered',messageIds:[message.messageId],recipientIds:[...delivered]};
}
