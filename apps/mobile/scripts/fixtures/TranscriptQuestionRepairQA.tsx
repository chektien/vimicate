// Explicit isolated QA entry. Never imported by the production App entry.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { TranscriptHistoryRepairQA } from './TranscriptHistoryRepairQA';
import { QuestionDeliveryRepairQA } from './QuestionDeliveryRepairQA';
import { setWorkspacePersistenceActive } from '../../src/storage/workspaceStore';
setWorkspacePersistenceActive(true);
import { qaButton, qaStyle } from './transcriptQuestionQAControls';
function TranscriptQuestionRepairQA() {
  const [page, setPage] = useState('home');
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: '#282828' }}>
    <Text style={qaStyle} accessibilityLabel={`TRANSCRIPT_QUESTION_QA ${process.env.EXPO_PUBLIC_VIMICATE_QA_SOURCE}`}>Synthetic Release QA {process.env.EXPO_PUBLIC_VIMICATE_QA_SOURCE}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{['history', 'async', 'broker'].map(value => qaButton(`QA ${value}`, () => setPage(value)))}</View>
    {page === 'history' ? <TranscriptHistoryRepairQA /> : page === 'async' || page === 'broker' ? <QuestionDeliveryRepairQA key={page} kind={page} /> : <Text style={qaStyle}>No live Gateway. Separate QA storage. Remote updates disabled.</Text>}
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(TranscriptQuestionRepairQA);
