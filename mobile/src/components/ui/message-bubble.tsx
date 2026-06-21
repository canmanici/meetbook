import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
  useColorScheme,
  Alert,
  Clipboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, shadows } from './tokens';
import { QuickReactions } from './emoji-picker';
import { ImageMessage } from './image-message';
import { VoiceMessage } from './voice-message';
import { LocationMessage } from './location-message';
import { BookCardMessage } from './book-card-message';
import { SystemMessage } from './system-message';
import type { MessageView } from '@/lib/api/chat';

interface MessageBubbleProps {
  message: MessageView;
  isMine: boolean;
  isGrouped: boolean;
  currentUserId: string;
  onReply: (msg: MessageView) => void;
  onDelete: (msg: MessageView) => void;
  onReaction: (msg: MessageView, emoji: string, action: 'add' | 'remove') => void;
  onLongPress?: (msg: MessageView) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMine,
  isGrouped,
  currentUserId,
  onReply,
  onDelete,
  onReaction,
  onLongPress,
}) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const isDeleted = !message.text && (message as any).deleted_at;
  const isSystem = message.message_type === 'system';

  // System messages render differently
  if (isSystem) {
    return <SystemMessage message={message} />;
  }

  // Swipe-to-reply gesture
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dy) < 10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0 && !isMine) {
          translateX.setValue(Math.min(gestureState.dx * 0.5, 80));
        } else if (gestureState.dx < 0 && isMine) {
          translateX.setValue(Math.max(gestureState.dx * 0.5, -80));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 50 && !isMine) {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          onReply(message);
        } else if (gestureState.dx < -50 && isMine) {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          onReply(message);
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const handleLongPress = () => {
    scale.setValue(0.95);
    setTimeout(() => scale.setValue(1), 100);
    setShowActions(true);
    onLongPress?.(message);
  };

  const handleCopy = () => {
    Clipboard.setString(message.text);
    setShowActions(false);
  };

  const handleDelete = () => {
    setShowActions(false);
    Alert.alert('Mesajı Sil', 'Bu mesaj her iki taraftan da silinecek.', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => onDelete(message) },
    ]);
  };

  const handleReactionSelect = (emoji: string) => {
    setShowReactions(false);
    const existing = message.reactions?.find((r) => r.emoji === emoji);
    const hasReacted = existing?.users.includes(currentUserId);
    onReaction(message, emoji, hasReacted ? 'remove' : 'add');
  };

  if (isDeleted) {
    return (
      <View style={[styles.row, isMine ? styles.myRow : styles.otherRow, { opacity: 0.5 }]}>
        {!isMine && <View style={styles.avatarSlot} />}
        <View style={[styles.deletedBubble, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="remove-circle-outline" size={14} color={colors.textMuted} style={{ marginRight: 4 }} />
          <Text style={[styles.deletedText, { color: colors.textMuted }]}>Mesaj silindi</Text>
        </View>
      </View>
    );
  }

  // Render content based on message type
  const renderContent = () => {
    switch (message.message_type) {
      case 'image':
        return <ImageMessage message={message} isMine={isMine} />;
      case 'voice':
        return <VoiceMessage message={message} isMine={isMine} />;
      case 'location':
        return <LocationMessage message={message} isMine={isMine} />;
      case 'book_card':
        return <BookCardMessage message={message} isMine={isMine} />;
      default:
        return null;
    }
  };

  const specialContent = renderContent();

  return (
    <Animated.View
      style={[
        styles.row,
        isMine ? styles.myRow : styles.otherRow,
        { transform: [{ translateX }, { scale }] },
        !isGrouped && { marginTop: spacing.sm },
      ]}
      {...panResponder.panHandlers}
    >
      {!isMine && (
        <View style={styles.avatarSlot}>
          {isGrouped ? null : (
            <View style={[styles.miniAvatar, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.miniAvatarText, { color: colors.primary }]}>?</Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={handleLongPress}
        onPress={() => setShowActions(false)}
        style={[styles.bubbleWrapper, isMine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}
      >
        {/* Reply preview */}
        {message.reply_to_id && message.reply_to_text && (
          <View style={[styles.replyPreview, { backgroundColor: colors.surfaceAlt, borderLeftColor: colors.primary }]}>
            <Text style={[styles.replyName, { color: colors.primary }]} numberOfLines={1}>
              {message.reply_to_sender_name}
            </Text>
            <Text style={[styles.replyText, { color: colors.textMuted }]} numberOfLines={2}>
              {message.reply_to_text}
            </Text>
          </View>
        )}

        {/* Special content OR text bubble */}
        {specialContent ? (
          specialContent
        ) : (
          <View
            style={[
              styles.bubble,
              isMine
                ? [styles.myBubble, { backgroundColor: colors.primary }]
                : [styles.otherBubble, { backgroundColor: colors.surface, ...shadows.card }],
            ]}
          >
            <Text style={[styles.messageText, { color: isMine ? '#ffffff' : colors.text }]}>
              {message.text}
            </Text>

            {/* Link detection */}
            {message.extra && typeof message.extra === 'object' && 'url' in message.extra && message.message_type === 'text' && (
              <View style={[styles.linkPreview, { borderTopColor: isMine ? 'rgba(255,255,255,0.15)' : colors.border }]}>
                <Ionicons name="link-outline" size={14} color={isMine ? 'rgba(255,255,255,0.7)' : colors.primary} />
                <Text style={[styles.linkText, { color: isMine ? 'rgba(255,255,255,0.8)' : colors.primary }]} numberOfLines={2}>
                  {(message.extra as any).title || (message.extra as any).url}
                </Text>
              </View>
            )}

            {/* Time + read receipts */}
            <View style={[styles.metaRow, isMine ? { marginRight: 2 } : { marginLeft: 2 }]}>
              <Text style={[styles.timeLabel, { color: isMine ? 'rgba(255,255,255,0.6)' : colors.textMuted }]}>
                {formatTime(message.created_at)}
              </Text>
              {isMine && (
                <Ionicons
                  name={message.read_at ? 'checkmark-done' : 'checkmark'}
                  size={13}
                  color={message.read_at ? '#90EE90' : 'rgba(255,255,255,0.4)'}
                  style={{ marginLeft: 3 }}
                />
              )}
            </View>
          </View>
        )}

        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <View style={styles.reactionsRow}>
            {message.reactions.map((reaction) => {
              const hasReacted = reaction.users.includes(currentUserId);
              return (
                <TouchableOpacity
                  key={reaction.emoji}
                  style={[
                    styles.reactionChip,
                    {
                      backgroundColor: hasReacted ? colors.primarySoft : colors.surfaceAlt,
                      borderColor: hasReacted ? colors.primary + '40' : colors.border,
                    },
                  ]}
                  onPress={() => handleReactionSelect(reaction.emoji)}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  <Text style={[styles.reactionCount, { color: hasReacted ? colors.primary : colors.textMuted }]}>
                    {reaction.count}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.addReaction, { backgroundColor: colors.surfaceAlt }]}
              onPress={() => setShowReactions(!showReactions)}
            >
              <Ionicons name="add" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>

      {/* Context menu */}
      {showActions && (
        <TouchableOpacity
          style={styles.actionOverlay}
          activeOpacity={1}
          onPress={() => setShowActions(false)}
        >
          <View
            style={[
              styles.actionMenu,
              {
                backgroundColor: colors.surface,
                ...(isMine ? styles.actionMenuRight : styles.actionMenuLeft),
                ...shadows.sheet,
              },
            ]}
          >
            <TouchableOpacity style={styles.actionItem} onPress={handleCopy}>
              <Ionicons name="copy-outline" size={18} color={colors.text} />
              <Text style={[styles.actionText, { color: colors.text }]}>Kopyala</Text>
            </TouchableOpacity>
            <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
            <TouchableOpacity style={styles.actionItem} onPress={() => { setShowActions(false); onReply(message); }}>
              <Ionicons name="arrow-undo-outline" size={18} color={colors.text} />
              <Text style={[styles.actionText, { color: colors.text }]}>Yanıtla</Text>
            </TouchableOpacity>
            {isMine && (
              <>
                <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity style={styles.actionItem} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  <Text style={[styles.actionText, { color: colors.danger }]}>Sil</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      )}

      {/* Quick reactions */}
      {showReactions && (
        <View style={[styles.quickReactionsWrapper, isMine ? { right: 0 } : { left: 32 }]}>
          <QuickReactions onSelect={handleReactionSelect} />
        </View>
      )}
    </Animated.View>
  );
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 1,
    alignItems: 'flex-end',
  },
  myRow: { justifyContent: 'flex-end', paddingRight: spacing.md },
  otherRow: { justifyContent: 'flex-start', paddingLeft: spacing.md },
  avatarSlot: { width: 28, marginRight: spacing.xs, alignItems: 'center' },
  miniAvatar: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  miniAvatarText: { fontSize: 10, fontWeight: '700' },
  bubbleWrapper: { maxWidth: '74%' },
  replyPreview: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.input,
    borderLeftWidth: 3,
    marginBottom: 3,
  },
  replyName: { fontSize: 12, fontWeight: '700' },
  replyText: { fontSize: 12, lineHeight: 16 },
  bubble: {
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  myBubble: { borderBottomRightRadius: radius.input },
  otherBubble: { borderBottomLeftRadius: radius.input },
  messageText: { fontSize: fontSize.body, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 },
  timeLabel: { fontSize: 10, fontWeight: '500' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: 3,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, fontWeight: '600' },
  addReaction: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  deletedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  deletedText: { fontSize: fontSize.bodySm, fontStyle: 'italic' },
  linkPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  linkText: { fontSize: fontSize.caption, flex: 1 },
  actionOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  actionMenu: {
    flexDirection: 'row',
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  actionMenuLeft: { position: 'absolute', left: spacing.md },
  actionMenuRight: { position: 'absolute', right: spacing.md },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  actionText: { fontSize: fontSize.bodySm, fontWeight: '500' },
  actionDivider: { width: 1, height: '70%', alignSelf: 'center' },
  quickReactionsWrapper: { position: 'absolute', bottom: -40, zIndex: 200 },
});
