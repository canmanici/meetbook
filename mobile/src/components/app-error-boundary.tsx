import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { crashReporter } from '@/lib/crash-reporter';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Catches render-time crashes anywhere in the tree and shows an animated
 * recovery card instead of a white screen / native crash. Tapping "Tekrar dene"
 * remounts the children.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : undefined,
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Report to our crash endpoint
    crashReporter.captureError(error, 'AppErrorBoundary');
    // Keep existing console.error for dev visibility
    console.error('AppErrorBoundary caught:', error, info);
  }

  reset = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.iconCircle}>
          <Ionicons name="alert" size={40} color="#FFFFFF" />
        </Animated.View>
        <Animated.Text entering={FadeIn.delay(120)} style={styles.title}>
          Bir şeyler ters gitti
        </Animated.Text>
        <Animated.Text entering={FadeIn.delay(200)} style={styles.message}>
          Uygulama beklenmedik bir hatayla karşılaştı. Tekrar deneyebilirsin.
        </Animated.Text>
        <Animated.View entering={FadeIn.delay(300)}>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={this.reset}
          >
            <Text style={styles.buttonText}>Tekrar dene</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: '#FBF6EC',
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#E5645A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2A2722',
    marginBottom: 10,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: '#8A8378',
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#11806B',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 44,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
