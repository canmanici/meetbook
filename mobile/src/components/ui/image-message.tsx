import React, { useState } from 'react';
import {
  View,
  Image,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Modal,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, radius, shadows } from './tokens';
import type { MessageView } from '@/lib/api/chat';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_IMAGE_WIDTH = SCREEN_WIDTH * 0.65;
const MAX_IMAGE_HEIGHT = 300;

interface ImageMessageProps {
  message: MessageView;
  isMine: boolean;
}

export const ImageMessage: React.FC<ImageMessageProps> = ({ message, isMine }) => {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const colors = palette[isDark ? 'dark' : 'light'];
  const [showFull, setShowFull] = useState(false);

  const url = message.extra?.url || message.extra?.thumbnail_url;
  if (!url) return null;

  const width = message.extra?.width ? Math.min(message.extra.width, MAX_IMAGE_WIDTH) : MAX_IMAGE_WIDTH;
  const height = message.extra?.height
    ? Math.min(message.extra.height, MAX_IMAGE_HEIGHT)
    : MAX_IMAGE_WIDTH * 0.75;

  return (
    <>
      <TouchableOpacity
        onPress={() => setShowFull(true)}
        activeOpacity={0.9}
        style={[
          styles.container,
          { borderRadius: radius.card },
          isMine ? styles.myContainer : styles.otherContainer,
        ]}
      >
        <Image
          source={{ uri: url }}
          style={[styles.image, { width, height, borderRadius: radius.card }]}
          resizeMode="cover"
        />
        {/* Overlay with time */}
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.3)' }]}>
          <Ionicons name="expand-outline" size={20} color="#ffffff" />
        </View>
      </TouchableOpacity>

      {/* Full screen viewer */}
      <Modal visible={showFull} transparent animationType="fade" onRequestClose={() => setShowFull(false)}>
        <TouchableOpacity
          style={styles.fullScreen}
          activeOpacity={1}
          onPress={() => setShowFull(false)}
        >
          <Image
            source={{ uri: message.extra?.url || url }}
            style={styles.fullImage}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: colors.surface }]}
            onPress={() => setShowFull(false)}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    maxWidth: MAX_IMAGE_WIDTH + 4,
  },
  myContainer: {
    borderBottomRightRadius: radius.input,
  },
  otherContainer: {
    borderBottomLeftRadius: radius.input,
  },
  image: {
    backgroundColor: '#e0e0e0',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '80%',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
