import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

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
      <View style={[styles.avatar, { width: currentSize.width, height: currentSize.height }]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            testID="avatar-image"
          />
        ) : (
          <Text style={[styles.initials, { fontSize: currentSize.fontSize }]}>
            {initials}
          </Text>
        )}
      </View>
      {verified && (
        <View style={styles.verificationBadge} testID="verification-badge">
          <Text style={styles.checkmark}>✓</Text>
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
    backgroundColor: palette.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initials: {
    color: palette.light.surface,
    fontWeight: '600',
  },
  verificationBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: palette.light.success,
    borderRadius: radius.pill,
    width: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: palette.light.surface,
  },
  checkmark: {
    color: palette.light.surface,
    fontSize: 10,
    fontWeight: 'bold',
  },
});
