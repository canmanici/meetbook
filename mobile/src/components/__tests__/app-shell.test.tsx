import React from 'react';
import { render } from '@testing-library/react-native';
import { AppTabs } from '../app-tabs';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  const { View: RNView } = require('react-native');

  function Tabs({ children }: { children: React.ReactNode }) {
    return ReactActual.createElement(RNView, null, children);
  }

  Tabs.Screen = function TabsScreen({ options }: { options?: { tabBarTestID?: string } }) {
    return ReactActual.createElement(RNView, { testID: options?.tabBarTestID });
  };

  return { Tabs };
});

describe('App Shell', () => {
  it('renders bottom tab navigation', () => {
    const { getByTestId } = render(<AppTabs />);
    expect(getByTestId('home-tab')).toBeTruthy();
    expect(getByTestId('search-tab')).toBeTruthy();
    expect(getByTestId('requests-tab')).toBeTruthy();
    expect(getByTestId('chats-tab')).toBeTruthy();
    expect(getByTestId('profile-tab')).toBeTruthy();
  });
});
