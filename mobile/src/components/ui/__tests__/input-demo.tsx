/**
 * Input Component Demo
 * This file demonstrates the Input component usage and can be used for manual testing
 * Run with: npx expo start --demo
 */

import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Input } from '../input';

export const InputDemo = () => {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Input
          label="Email"
          placeholder="Enter your email"
          helper="We'll never share your email"
        />

        <Input
          label="Password"
          placeholder="Enter your password"
          secureTextEntry
          helper="Must be at least 8 characters"
        />

        <Input
          label="Email"
          placeholder="Enter your email"
          error="Invalid email format"
        />

        <Input
          label="Phone"
          placeholder="Enter your phone number"
          keyboardType="phone-pad"
          helper="We'll only use this for important updates"
        />

        <Input
          label="Full Name"
          placeholder="Enter your full name"
          value="John Doe"
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F5F0',
  },
  section: {
    padding: 16,
  },
});
