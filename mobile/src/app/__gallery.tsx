import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, BookCard } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/emptystate';
import { Skeleton } from '@/components/ui/skeleton';
import { Toast, InlineError } from '@/components/ui/toast';
import { spacing, palette, fontSize } from '@/components/ui/tokens';

/**
 * Component Gallery — dev-only design review screen.
 *
 * Renders every component from `src/components/ui` so designers and
 * engineers can review the design system in one place. This file is
 * intentionally prefixed with `__` so it reads as a non-production,
 * internal-tooling file; it is not linked from any in-app navigation.
 */
export default function ComponentGallery() {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Component Gallery</Text>
          <Text style={styles.subtitle}>Design system v1.0</Text>
        </View>

        {/* Buttons */}
        <View style={styles.section} testID="gallery-button">
          <Text style={styles.sectionTitle}>Buttons</Text>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary" style={styles.spacedTop}>
            Secondary
          </Button>
          <Button variant="ghost" style={styles.spacedTop}>
            Ghost
          </Button>
          <Button variant="danger" style={styles.spacedTop}>
            Danger
          </Button>
          <Button loading style={styles.spacedTop}>
            Loading
          </Button>
          <Button disabled style={styles.spacedTop}>
            Disabled
          </Button>
        </View>

        {/* Inputs */}
        <View style={styles.section} testID="gallery-input">
          <Text style={styles.sectionTitle}>Inputs</Text>
          <Input label="Email" placeholder="Enter email" keyboardType="email-address" />
          <Input
            label="Password"
            placeholder="Enter password"
            secureTextEntry
            helper="Must be at least 8 characters"
          />
          <Input
            label="Phone"
            placeholder="+90 (555) 555 55 55"
            keyboardType="phone-pad"
            error="Invalid phone format"
          />
        </View>

        {/* Cards */}
        <View style={styles.section} testID="gallery-card">
          <Text style={styles.sectionTitle}>Cards</Text>
          <Card style={styles.spacedBottom}>
            <Text style={styles.cardText}>Plain card content</Text>
          </Card>
          <BookCard
            title="The Great Gatsby"
            author="F. Scott Fitzgerald"
            condition="good"
            distance="3 km"
            coverImageUrl="https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=200"
          />
          <BookCard
            title="No cover available for this book"
            author="Unknown Author"
            condition="fair"
            distance="1.2 km"
          />
        </View>

        {/* Avatars */}
        <View style={styles.section} testID="gallery-avatar">
          <Text style={styles.sectionTitle}>Avatars</Text>
          <View style={styles.row}>
            <Avatar name="John Doe" size="small" />
            <Avatar name="Jane Smith" size="medium" style={styles.spacedLeft} />
            <Avatar name="Bob Johnson" size="large" verified style={styles.spacedLeft} />
          </View>
        </View>

        {/* Badges */}
        <View style={styles.section} testID="gallery-badge">
          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.row}>
            <Badge text="Primary" variant="primary" />
            <Badge text="Success" variant="success" style={styles.spacedLeft} />
            <Badge text="Warning" variant="warning" style={styles.spacedLeft} />
            <Badge text="Danger" variant="danger" style={styles.spacedLeft} />
            <Badge text="Info" variant="info" style={styles.spacedLeft} />
          </View>
        </View>

        {/* Sheet */}
        <View style={styles.section} testID="gallery-sheet">
          <Text style={styles.sectionTitle}>Sheet</Text>
          <Button variant="secondary" onPress={() => setSheetVisible(true)}>
            Open Sheet
          </Button>
          <Sheet visible={sheetVisible} onClose={() => setSheetVisible(false)} title="Bottom Sheet">
            <Text style={styles.cardText}>This is a bottom sheet component.</Text>
            <Button onPress={() => setSheetVisible(false)} style={styles.spacedTop}>
              Close
            </Button>
          </Sheet>
        </View>

        {/* Empty State */}
        <View style={styles.section} testID="gallery-emptystate">
          <Text style={styles.sectionTitle}>Empty State</Text>
          <EmptyState
            message="No books nearby yet"
            description="Try expanding your search radius"
            illustration={<Text style={styles.illustrationEmoji}>📚</Text>}
            actionLabel="Add first book"
            onAction={() => {}}
          />
        </View>

        {/* Skeleton */}
        <View style={styles.section} testID="gallery-skeleton">
          <Text style={styles.sectionTitle}>Skeleton</Text>
          <Skeleton variant="card" />
          <Skeleton variant="list-item" />
        </View>

        {/* Toast & InlineError */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Toast & InlineError</Text>
          <View style={styles.row}>
            <Button variant="secondary" onPress={() => setToastVisible(true)}>
              Show Toast
            </Button>
            <Button variant="ghost" style={styles.spacedLeft} onPress={() => setToastVisible(false)}>
              Hide Toast
            </Button>
          </View>
          <InlineError
            message="Couldn't reach the server — pull to retry"
            style={styles.spacedTop}
          />
        </View>

        <View style={styles.spacer} />
      </ScrollView>

      <Toast
        message="Success! This is a toast notification."
        visible={toastVisible}
        variant="success"
        testID="gallery-toast"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.light.background,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  header: {
    padding: spacing.xl,
    backgroundColor: palette.light.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.light.background,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: palette.light.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: palette.light.textMuted,
    marginTop: spacing.xs,
  },
  section: {
    padding: spacing.lg,
    backgroundColor: palette.light.surface,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.heading,
    fontWeight: '600',
    color: palette.light.text,
    marginBottom: spacing.md,
  },
  cardText: {
    fontSize: fontSize.body,
    color: palette.light.text,
  },
  illustrationEmoji: {
    fontSize: 48,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spacedTop: {
    marginTop: spacing.sm,
  },
  spacedBottom: {
    marginBottom: spacing.sm,
  },
  spacedLeft: {
    marginLeft: spacing.md,
  },
  spacer: {
    height: spacing.xxl,
  },
});
