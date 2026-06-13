import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { useBookDraftStore } from '@/stores/book-draft-store';

import LocationPickerScreen from '../location-picker';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock('react-native-maps', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  const MockMapView = ({ children, onPress, testID }: any) =>
    ReactActual.createElement(View, { testID, onPress }, children);
  const MockMarker = ({ testID }: any) => ReactActual.createElement(View, { testID });
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
  };
});

const Location = jest.requireMock('expo-location');

function press(element: any, eventData: unknown) {
  act(() => {
    element.props.onPress(eventData);
  });
}

describe('LocationPickerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useBookDraftStore.setState({ pickedLocation: null });
  });

  it('disables the confirm button until a location is picked', () => {
    const { getByTestId } = render(<LocationPickerScreen />);

    fireEvent.press(getByTestId('confirm-location-button'));

    expect(useBookDraftStore.getState().pickedLocation).toBeNull();
  });

  it('drops a marker on map press and confirms the picked location', async () => {
    const { router } = jest.requireMock('expo-router');
    const { getByTestId, findByTestId } = render(<LocationPickerScreen />);

    press(getByTestId('location-picker-map'), {
      nativeEvent: { coordinate: { latitude: 41.01, longitude: 28.98 } },
    });

    await findByTestId('location-picker-marker');

    fireEvent.press(getByTestId('confirm-location-button'));

    expect(useBookDraftStore.getState().pickedLocation).toEqual({ lat: 41.01, lng: 28.98 });
    expect(router.back).toHaveBeenCalled();
  });

  it('uses the device location when permission is granted', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 39.93, longitude: 32.86 },
    });

    const { getByTestId, findByTestId } = render(<LocationPickerScreen />);

    fireEvent.press(getByTestId('use-my-location-button'));

    await findByTestId('location-picker-marker');

    fireEvent.press(getByTestId('confirm-location-button'));

    expect(useBookDraftStore.getState().pickedLocation).toEqual({ lat: 39.93, lng: 32.86 });
  });

  it('shows an error when location permission is denied', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const { getByTestId, findByText } = render(<LocationPickerScreen />);

    fireEvent.press(getByTestId('use-my-location-button'));

    expect(await findByText('Konum izni verilmedi.')).toBeTruthy();
  });
});
