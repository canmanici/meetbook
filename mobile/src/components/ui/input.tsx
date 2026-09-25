import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  helper?: string;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'phone-pad' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  testID?: string;
  style?: ViewStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  placeholder,
  value,
  onChangeText,
  helper,
  error,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize,
  testID = 'input-field',
  style,
}) => {
  const scheme = useColorScheme();
  const colors = palette[scheme === 'dark' ? 'dark' : 'light'];
  const [isPasswordVisible, setIsPasswordVisible] = useState(!secureTextEntry);

  const togglePasswordVisibility = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const hasError = !!error;

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={[styles.label, { color: colors.text }, hasError && { color: colors.danger }]}>{label}</Text> : null}
      <View style={[styles.inputContainer, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }, hasError && { borderColor: colors.danger }]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          placeholder={placeholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          keyboardType={keyboardType}
          // Emails must never be auto-capitalised ("Can@..." ≠ "can@...").
          autoCapitalize={
            autoCapitalize ?? (keyboardType === 'email-address' || secureTextEntry ? 'none' : 'sentences')
          }
          autoCorrect={keyboardType === 'email-address' ? false : undefined}
          placeholderTextColor={colors.textMuted}
          testID={testID}
        />
        {secureTextEntry && (
          <TouchableOpacity
            onPress={togglePasswordVisibility}
            testID="input-password-toggle"
            style={styles.eyeIcon}
          >
            <Text style={styles.eyeText}>{isPasswordVisible ? '👁️' : '👁️‍🗨️'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {(helper || error) && (
        <Text style={[styles.helper, { color: colors.textMuted }, hasError && { color: colors.danger }]}>
          {error || helper}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '500',
    paddingVertical: spacing.sm,
  },
  eyeIcon: {
    padding: spacing.sm,
  },
  eyeText: {
    fontSize: 20,
  },
  helper: {
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
  },
});
