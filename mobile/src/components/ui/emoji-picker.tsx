import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, shadows } from './tokens';

const EMOJI_CATEGORIES = [
  {
    name: 'Sık Kullanılan',
    emojis: ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🔥', '✅', '❌', '⭐', '💪'],
  },
  {
    name: 'İfadeler',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩'],
  },
  {
    name: 'Nesneler',
    emojis: ['📚', '📖', '📕', '📗', '📘', '📙', '📓', '📔', '📒', '📃', '📜', '📰', '🗞️', '🔖', '📎', '📌', '📍', '📏', '📐', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '✏️', '🔍', '🔎', '📝', '✏️', '📁', '📂', '🗂️', '📅', '📆', '📈', '📉', '📊', '📋', '📌', '📍'],
  },
  {
    name: 'Mekanlar',
    emojis: ['🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍', '⛩️', '🕋', '⛲', '⛺', '🌁', '🌃', '🏙️', '🌄', '🌅', '🌆', '🌇', '🌉', '🎠', '🛝', '🎡', '🎢'],
  },
];

interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ visible, onClose, onSelect }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [activeCategory, setActiveCategory] = useState(0);

  const currentEmojis = EMOJI_CATEGORIES[activeCategory].emojis;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View
          style={[styles.container, { backgroundColor: colors.surface, ...shadows.sheet }]}
          onStartShouldSetResponder={() => true}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Category tabs */}
          <View style={styles.categoryTabs}>
            {EMOJI_CATEGORIES.map((cat, i) => (
              <TouchableOpacity
                key={cat.name}
                style={[styles.categoryTab, activeCategory === i && { borderBottomColor: colors.primary }]}
                onPress={() => setActiveCategory(i)}
              >
                <Text
                  style={[
                    styles.categoryText,
                    { color: activeCategory === i ? colors.primary : colors.textMuted },
                    activeCategory === i && { fontWeight: '700' },
                  ]}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Emoji grid */}
          <FlatList
            data={currentEmojis}
            numColumns={8}
            keyExtractor={(item, index) => `${item}-${index}`}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.emojiButton}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Text style={styles.emoji}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

// Quick emoji row for inline reactions
interface QuickReactionsProps {
  onSelect: (emoji: string) => void;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const QuickReactions: React.FC<QuickReactionsProps> = ({ onSelect }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];

  return (
    <View style={styles.quickRow}>
      {QUICK_EMOJIS.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={[styles.quickButton, { backgroundColor: colors.surfaceAlt }]}
          onPress={() => onSelect(emoji)}
        >
          <Text style={styles.quickEmoji}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  container: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: '50%',
    paddingBottom: 34,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  categoryTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: spacing.sm,
  },
  categoryTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  categoryText: {
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
  grid: {
    padding: spacing.sm,
  },
  emojiButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
    aspectRatio: 1,
  },
  emoji: {
    fontSize: 28,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  quickButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickEmoji: {
    fontSize: 18,
  },
});
