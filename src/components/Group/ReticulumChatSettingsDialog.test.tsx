import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createTheme, ThemeProvider } from '@mui/material';
import {
  memberGroupsAtom,
  reticulumChatTextScaleAtom,
  reticulumHighlightOwnMessagesAtom,
  reticulumLegacyThreadsEnabledAtom,
} from '../../atoms/global';
import { ReticulumChatSettingsDialog } from './GroupList';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

vi.mock('../../utils/qChatNotificationSettings', async () => {
  const actual = await vi.importActual('../../utils/qChatNotificationSettings');
  return {
    ...actual,
    applyNotificationSettingsToAllGroups: vi.fn(async () => {}),
  };
});

function renderDialog(memberGroups: any[] = [{ groupId: 1 }, { groupId: 2 }]) {
  const store = createStore();
  store.set(memberGroupsAtom, memberGroups);
  store.set(reticulumChatTextScaleAtom as any, 'default');
  store.set(reticulumHighlightOwnMessagesAtom as any, false);
  store.set(reticulumLegacyThreadsEnabledAtom as any, false);

  const theme = createTheme();

  return render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <ReticulumChatSettingsDialog open={true} onClose={() => {}} />
      </Provider>
    </ThemeProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReticulumChatSettingsDialog — Notifications section', () => {
  it('shows Notifications category in the left nav', () => {
    renderDialog();
    expect(
      screen.getAllByText('reticulum:settings.nav.notifications').length
    ).toBeGreaterThan(0);
  });

  it('renders notification controls with default values when navigated to', () => {
    renderDialog();

    const navButtons = screen.getAllByText(
      'reticulum:settings.nav.notifications'
    );
    fireEvent.click(navButtons[navButtons.length - 1]);

    expect(
      screen.getByText('reticulum:settings.notifications.title')
    ).toBeInTheDocument();
    expect(
      screen.getByText('reticulum:settings.notifications.description')
    ).toBeInTheDocument();

    const mentionsRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'mentions');
    expect(mentionsRadio).toBeDefined();
    expect(mentionsRadio?.checked).toBe(true);

    const allRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'all');
    expect(allRadio?.checked).toBe(false);

    const noneRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'none');
    expect(noneRadio?.checked).toBe(false);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(4);

    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(true);
    expect(checkboxes[3].checked).toBe(false);
  });

  it('renders the Apply to All Groups button', () => {
    renderDialog();

    const navButtons = screen.getAllByText(
      'reticulum:settings.nav.notifications'
    );
    fireEvent.click(navButtons[navButtons.length - 1]);

    expect(
      screen.getByText('reticulum:settings.notifications.apply_button')
    ).toBeInTheDocument();
  });

  it('calls applyNotificationSettingsToAllGroups when Apply is clicked', async () => {
    const { applyNotificationSettingsToAllGroups } =
      await import('../../utils/qChatNotificationSettings');

    renderDialog();

    const navButtons = screen.getAllByText(
      'reticulum:settings.nav.notifications'
    );
    fireEvent.click(navButtons[navButtons.length - 1]);

    const applyButton = screen.getByText(
      'reticulum:settings.notifications.apply_button'
    );
    fireEvent.click(applyButton);

    expect(applyNotificationSettingsToAllGroups).toHaveBeenCalledWith(
      [1, 2],
      expect.objectContaining({
        pushLevel: 'mentions',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnWelcomePosts: true,
        hideMutedChannels: false,
      })
    );
  });
});
