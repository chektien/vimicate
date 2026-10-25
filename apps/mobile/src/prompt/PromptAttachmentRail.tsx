import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/tokens';
import { formattedAttachmentSize, type PromptAttachment } from './promptAttachments';

export const ATTACHMENT_SLOT_WIDTH = 34;
export const COMPACT_ATTACHMENT_SLOT_WIDTH = 30;
type Props = { attachments: PromptAttachment[]; compact: boolean; visibleSlots: number; onPreviewAttachment: (id: string) => void; onRemoveAttachment: (id: string) => void };

// The measured toolbar grants whole slots; overflow remains directly swipeable.
export function PromptAttachmentRail({ attachments, compact, visibleSlots, onPreviewAttachment, onRemoveAttachment }: Props) {
  if (!attachments.length) return null;
  const slot = compact ? styles.compactSlot : styles.slot;
  const slotWidth = compact ? COMPACT_ATTACHMENT_SLOT_WIDTH : ATTACHMENT_SLOT_WIDTH;
  return <ScrollView accessibilityLabel="Prompt attachments" horizontal snapToInterval={slotWidth} decelerationRate="fast"
    showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
    style={[styles.rail, { width: visibleSlots * slotWidth, height: slot.height }]} contentContainerStyle={styles.railContent}>
    {attachments.map((attachment, index) => <View key={attachment.id} style={[styles.chip, slot]}>
      {attachment.kind === 'image'
        ? <Pressable accessibilityRole="button" accessibilityLabel={`Preview attachment ${index + 1}: ${attachment.filename}`}
            accessibilityHint={`${index + 1} of ${attachments.length}.${attachments.length > visibleSlots ? ' Swipe horizontally for other attachments.' : ''}`}
            onPress={() => onPreviewAttachment(attachment.id)} style={styles.preview}>
            <Image source={{ uri: attachment.uri }} style={styles.thumbnail} />
          </Pressable>
        : <View accessible accessibilityLabel={`Attachment ${index + 1} of ${attachments.length}: ${attachment.filename}, ${formattedAttachmentSize(attachment.byteCount)}`} style={styles.preview}>
            <Text style={styles.fileIcon}>▧</Text>
          </View>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove attachment ${index + 1}: ${attachment.filename}`}
        onPress={() => onRemoveAttachment(attachment.id)} style={styles.removeButton}>
        <Text style={styles.remove}>×</Text>
      </Pressable>
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  rail: { flexGrow: 0, flexShrink: 0 }, railContent: { alignItems: 'center' },
  slot: { width: ATTACHMENT_SLOT_WIDTH, height: 32 }, compactSlot: { width: COMPACT_ATTACHMENT_SLOT_WIDTH, height: 29 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.raised },
  preview: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbnail: { width: 22, height: 22, borderRadius: 3, backgroundColor: colors.canvas },
  fileIcon: { color: colors.blue, fontFamily: type.mono, fontSize: 18 },
  removeButton: { position: 'absolute', top: 0, right: 0, width: 14, height: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: colors.surface },
  remove: { color: colors.red, fontFamily: type.mono, fontSize: 12, lineHeight: 14 },
});
