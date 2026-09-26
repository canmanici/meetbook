import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  useColorScheme,
  ViewStyle,
} from 'react-native';
import { palette, radius, fontSize } from './tokens';

export type AvatarSize = 'small' | 'medium' | 'large';

interface AvatarProps {
  name: string;
  imageUrl?: string;
  size?: AvatarSize;
  verified?: boolean;
  style?: ViewStyle;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  imageUrl,
  size = 'medium',
  verified = false,
  style,
}) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const sizeStyles = {
    small: { width: 32, height: 32, fontSize: fontSize.caption },
    medium: { width: 44, height: 44, fontSize: fontSize.bodySm },
    large: { width: 64, height: 64, fontSize: fontSize.body },
  };

  const currentSize = sizeStyles[size];

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.avatar, { backgroundColor: colors.primary, width: currentSize.width, height: currentSize.height }]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            testID="avatar-image"
          />
        ) : (
          <Text style={[styles.initials, { color: colors.surface, fontSize: currentSize.fontSize }]}>
            {initials}
          </Text>
        )}
      </View>
      {verified && (
        <View style={[styles.verificationBadge, { backgroundColor: colors.success, borderColor: colors.surface }]} testID="verification-badge">
          <Text style={[styles.checkmark, { color: colors.surface }]}>✓</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  avatar: {
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initials: {
    fontWeight: '600',
  },
  verificationBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderRadius: radius.pill,
    width: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  checkmark: {
    fontSize: 10,
    fontWeight: 'bold',
  },
});
