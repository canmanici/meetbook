import React from 'react';
import { render } from '@testing-library/react-native';
import { AppTabs } from '../app-tabs';

jest.mock('expo-router', () => {
  const ReactActual = require('react');
  const { View: RNView, Text: RNText } = require('react-native');

  function Tabs({ children }: { children: React.ReactNode }) {
    return ReactActual.createElement(RNView, null, children);
  }

  Tabs.Screen = function TabsScreen({
    name,
    options,
  }: {
    name: string;
    options?: { tabBarButtonTestID?: string; title?: string; tabBarIcon?: (props: { color: string }) => React.ReactNode };
  }) {
    return ReactActual.createElement(
      RNView,
      { testID: options?.tabBarButtonTestID },
      ReactActual.createElement(RNText, null, name),
      ReactActual.createElement(RNText, null, options?.title),
      options?.tabBarIcon?.({ color: '#000' })
    );
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

  it('maps each tab to its route name', () => {
    const { getByTestId, getByText } = render(<AppTabs />);
    expect(getByTestId('home-tab')).toHaveTextContent('home', { exact: false });
    expect(getByTestId('search-tab')).toHaveTextContent('search', { exact: false });
    expect(getByTestId('requests-tab')).toHaveTextContent('requests', { exact: false });
    expect(getByTestId('chats-tab')).toHaveTextContent('chats', { exact: false });
    expect(getByTestId('profile-tab')).toHaveTextContent('profile', { exact: false });

    expect(getByText('Home')).toBeTruthy();
    expect(getByText('Search')).toBeTruthy();
    expect(getByText('Requests')).toBeTruthy();
    expect(getByText('Chats')).toBeTruthy();
    expect(getByText('Profile')).toBeTruthy();
  });
});
