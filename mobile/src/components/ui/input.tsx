import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { palette, spacing, radius, fontSize } from './tokens';

interface InputProps {
  label: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  helper?: string;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'phone-pad' | 'default';
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
  style,
}) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(!secureTextEntry);

  const togglePasswordVisibility = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const hasError = !!error;

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.label, hasError && styles.errorLabel]}>{label}</Text>
      <View style={[styles.inputContainer, hasError && styles.errorInput]}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          keyboardType={keyboardType}
          placeholderTextColor={palette.light.textMuted}
          testID="input-field"
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
        <Text style={[styles.helper, hasError && styles.errorText]}>
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
    fontWeight: '600',
    color: palette.light.text,
    marginBottom: spacing.xs,
  },
  errorLabel: {
    color: palette.light.danger,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.light.textMuted,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  errorInput: {
    borderColor: palette.light.danger,
  },
  input: {
    flex: 1,
    fontSize: fontSize.body,
    color: palette.light.text,
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
    color: palette.light.textMuted,
    marginTop: spacing.xs,
  },
  errorText: {
    color: palette.light.danger,
  },
});
