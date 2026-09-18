import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MuteSubmenu } from './MuteSubmenu';
import {
  notificationSettingsCacheAtom,
  muteExpiryTickAtom,
} from '../atoms/global';
import type { GroupNotificationSettingsData } from '../utils/qChatNotificationSettings';

vi.mock('react-contexify', () => ({
  Item: ({ children, onClick }: any) => (
    <div data-testid="contexify-item" onClick={onClick}>
      {children}
    </div>
  ),
  Submenu: ({ children, label }: any) => (
    <div data-testid="contexify-submenu">
      <div data-testid="contexify-submenu-label">{label}</div>
      {children}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderWithMuteState(
  cache: Record<string, GroupNotificationSettingsData>,
  scope: { groupId: string | number; sectionId?: string; channelId?: string },
  scopeType: 'Group' | 'Section' | 'Channel'
) {
  const store = createStore();
  store.set(notificationSettingsCacheAtom, cache);

  return render(
    <Provider store={store}>
      <MuteSubmenu scope={scope} scopeType={scopeType} />
    </Provider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MuteSubmenu', () => {
  it('renders submenu with duration options when not muted', () => {
    renderWithMuteState({}, { groupId: 123 }, 'Group');

    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    expect(
      screen.getByText('group:context_menu.mute_group')
    ).toBeInTheDocument();
  });

  it('renders unmute item when group is muted', () => {
    renderWithMuteState(
      { '123': { mutedUntil: null } },
      { groupId: 123 },
      'Group'
    );

    expect(screen.queryByTestId('contexify-submenu')).not.toBeInTheDocument();
    expect(screen.getByText('group:context_menu.unmute')).toBeInTheDocument();
  });

  it('renders unmute item when channel is muted via cascade', () => {
    renderWithMuteState(
      {
        '123': {
          mutedUntil: Date.now() + 3600_000,
          sections: {
            'sec-1': {
              channels: { 'ch-1': {} },
            },
          },
        },
      },
      { groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' },
      'Channel'
    );

    expect(screen.queryByTestId('contexify-submenu')).not.toBeInTheDocument();
    expect(screen.getByText('group:context_menu.unmute')).toBeInTheDocument();
  });

  it('renders submenu when group mute has expired', () => {
    renderWithMuteState(
      { '123': { mutedUntil: Date.now() - 60_000 } },
      { groupId: 123 },
      'Group'
    );

    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    expect(
      screen.getByText('group:context_menu.mute_group')
    ).toBeInTheDocument();
  });
});
