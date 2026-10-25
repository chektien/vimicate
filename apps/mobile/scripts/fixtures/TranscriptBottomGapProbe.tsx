// Simulator-only synthetic geometry probe; never imported by the production entry.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {View, Text, Button} from 'react-native';
import {TranscriptPane, type TranscriptPaneHandle} from '../../src/transcript/TranscriptPane';
import {createTranscriptBuffer, createTranscriptVimState} from '../../src/transcript/transcriptVim';
const noop=()=>{};
export default function TranscriptBottomGapProbe(){
 const [session,setSession]=useState(0); const [height,setHeight]=useState(477);
 const pane=useRef<TranscriptPaneHandle>(null);
 const messages=useMemo(()=>Array.from({length:100},(_,i)=>({id:`row-${i}`,role:'assistant' as const,text:`${i===99?'FINAL ROW':'Answer'} ${i} — Transcript bottom gap native acceptance`})),[]);
 useEffect(()=>{ const timers=[setTimeout(()=>pane.current?.reveal(50,true,'review',49),3000),setTimeout(()=>pane.current?.reveal(99,true,'review',98),6000)]; return()=>timers.forEach(clearTimeout);},[]);
 const buffer=useMemo(()=>createTranscriptBuffer(messages),[messages]);
 return <View style={{flex:1,backgroundColor:'#222',paddingTop:60}}>
 <Text style={{color:'white'}}>CURRENT SOURCE — native gap probe</Text>
 <Button title="Tail" onPress={()=>pane.current?.reveal(99,true,'tail')}/>
 <Button title="j into final" onPress={()=>pane.current?.reveal(99,true,'review',98)}/>
 <Button title="Review row 50" onPress={()=>pane.current?.reveal(50,true,'review',49)}/>
 <Button title="Switch dataset" onPress={()=>setSession(s=>s+1)}/>
 <Button title="Resize" onPress={()=>setHeight(h=>h===477?377:477)}/>
 <View style={{height}}><TranscriptPane ref={pane} datasetKey={`probe-${session}`} messages={messages} buffer={buffer} navigation={createTranscriptVimState(buffer)} focused={false} fontScale={1} onFocus={noop} onSelect={noop} onNavigationProjection={noop} onViewportReview={noop} onApprovalDecision={noop} onRecoverMessage={noop} onOpenMedia={noop} canLoadOlder={false} loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop}/></View>
 </View>;
}
