import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('@/lib/api/client', () => ({ absoluteMediaUrl: (u: string | null) => u ?? null }));
jest.mock('@/lib/api/courses', () => ({
  ...jest.requireActual('@/lib/api/courses'),
  listCourses: jest.fn(),
  searchCourseBooks: jest.fn(),
}));

import CourseSearchScreen from '../course-search';

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CourseSearchScreen />
    </QueryClientProvider>,
  );
}

const book = {
  id: 'b1',
  owner_id: 'o1',
  owner_name: 'Ayşe',
  title: 'Calculus',
  author: 'Stewart',
  isbn: null,
  description: null,
  course_code: 'MAT101',
  instructor: 'Prof. Kaya',
  category: 'textbook',
  language: 'tr',
  condition: 'good',
  is_available: true,
  public_location: { lat: 41, lng: 29 },
  distance_km: 1.2,
  owner: { id: 'o1', name: 'Ayşe', book_count: 1, rating_count: 0 },
  photos: [],
  created_at: '2026-09-29T00:00:00Z',
  updated_at: '2026-09-29T00:00:00Z',
};

describe('CourseSearchScreen', () => {
  const api = require('@/lib/api/courses');
  const { router, useLocalSearchParams } = require('expo-router');

  beforeEach(() => {
    api.listCourses.mockReset();
    api.searchCourseBooks.mockReset();
    router.push.mockClear();
    useLocalSearchParams.mockReturnValue({});
  });

  it('lists courses by prefix and opens a course', async () => {
    api.listCourses.mockResolvedValue({
      items: [{ course_code: 'MAT101', book_count: 3, instructors: ['Prof. Kaya'] }],
    });
    api.searchCourseBooks.mockResolvedValue({ items: [book] });
    const { getByTestId, findByTestId, findByText } = renderScreen();

    fireEvent.changeText(getByTestId('course-search-input'), 'mat 1');
    await waitFor(() => expect(api.listCourses).toHaveBeenLastCalledWith('MAT1'));
    expect(await findByText('3 kitap')).toBeTruthy();

    fireEvent.press(await findByTestId('course-MAT101'));
    await waitFor(() => expect(api.searchCourseBooks).toHaveBeenCalledWith('MAT101', null));
    fireEvent.press(await findByTestId('course-book-b1'));
    expect(router.push).toHaveBeenCalledWith('/book/b1');
  });

  it('opens straight on a course when given a code, with a helpful empty state', async () => {
    useLocalSearchParams.mockReturnValue({ code: 'FIZ101' });
    api.searchCourseBooks.mockResolvedValue({ items: [] });
    const { findByText } = renderScreen();
    expect(await findByText('FIZ101 için henüz kitap yok')).toBeTruthy();
    expect(api.listCourses).not.toHaveBeenCalled();
  });

  it('uses a fresh fix when there is no last known position', async () => {
    const Location = require('expo-location');
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    Location.getLastKnownPositionAsync.mockResolvedValueOnce(null);
    Location.getCurrentPositionAsync.mockResolvedValueOnce({ coords: { latitude: 41, longitude: 29 } });
    useLocalSearchParams.mockReturnValue({ code: 'MAT101' });
    api.searchCourseBooks.mockResolvedValue({ items: [book] });
    const { findByText } = renderScreen();
    await waitFor(() =>
      expect(api.searchCourseBooks).toHaveBeenLastCalledWith('MAT101', { lat: 41, lng: 29 }),
    );
    expect(await findByText(/YAKINDAKİ KİTAPLAR/)).toBeTruthy();
  });
});
