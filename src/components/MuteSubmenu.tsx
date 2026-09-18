import { Item, Submenu, contextMenu } from 'react-contexify';
import { Box, Typography } from '@mui/material';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { notificationSettingsCacheAtom } from '../atoms/global';
import {
  type ScopeDescriptor,
  isScopeMuted,
  getScopeMutedUntil,
  setScopeMuted,
  unmuteScope,
} from '../utils/qChatNotificationSettings';

export type MuteScopeType = 'Group' | 'Section' | 'Channel';

export interface MuteSubmenuProps {
  scope: ScopeDescriptor;
  scopeType: MuteScopeType;
}

const DURATIONS = [
  { key: 'mute.for_15_minutes', ms: 15 * 60 * 1000 },
  { key: 'mute.for_1_hour', ms: 60 * 60 * 1000 },
  { key: 'mute.for_3_hours', ms: 3 * 60 * 60 * 1000 },
  { key: 'mute.for_8_hours', ms: 8 * 60 * 60 * 1000 },
  { key: 'mute.for_24_hours', ms: 24 * 60 * 60 * 1000 },
  { key: 'mute.until_i_turn_it_back_on', ms: null as number | null },
];

export function MuteSubmenu({ scope, scopeType }: MuteSubmenuProps) {
  const { t } = useTranslation(['group']);
  const cache = useAtomValue(notificationSettingsCacheAtom);

  const groupSettings = cache[String(scope.groupId)];
  const muted = groupSettings
    ? isScopeMuted(groupSettings, scope.sectionId, scope.channelId)
    : false;
  const mutedUntil = groupSettings
    ? getScopeMutedUntil(groupSettings, scope.sectionId, scope.channelId)
    : undefined;
  const mutedHoursLeft =
    mutedUntil != null && mutedUntil > 0
      ? Math.max(0, (mutedUntil - Date.now()) / (1000 * 60 * 60))
      : null;

  function formatHours(h: number): string {
    const rounded = Math.round(h * 100) / 100;
    if (Number.isInteger(rounded)) return String(rounded);
    return String(parseFloat(rounded.toFixed(2)));
  }

  const mutedForLabel =
    mutedHoursLeft != null
      ? (() => {
          const rounded = Math.round(mutedHoursLeft * 100) / 100;
          return `${formatHours(mutedHoursLeft)} ${rounded === 1 ? 'hour' : 'hours'}`;
        })()
      : null;

  const labelKey = `group:context_menu.mute_${scopeType.toLowerCase()}`;

  if (muted) {
    return (
      <Item
        onClick={() => {
          void unmuteScope(scope).catch(console.error);
          contextMenu.hideAll();
        }}
      >
        <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.5 }}>
          <NotificationsOffIcon sx={{ fontSize: 18, mt: 0.25 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography
              component="span"
              sx={{ fontSize: '14px', fontWeight: 600 }}
            >
              {t('group:context_menu.unmute')}
            </Typography>
            {mutedForLabel != null && (
              <Typography
                component="span"
                sx={{ color: 'text.secondary', fontSize: '12px' }}
              >
                {t('group:context_menu.muted_for', {
                  hours: mutedForLabel,
                })}
              </Typography>
            )}
          </Box>
        </Box>
      </Item>
    );
  }

  return (
    <Submenu
      label={
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
          <NotificationsOffIcon sx={{ fontSize: 18 }} />
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t(labelKey)}
          </Typography>
        </Box>
      }
      arrow={<ChevronRightRoundedIcon sx={{ fontSize: 20 }} />}
    >
      {DURATIONS.map(({ key, ms }) => (
        <Item
          key={key}
          onClick={() => {
            const until = ms === null ? null : Date.now() + ms;
            void setScopeMuted(scope, until).catch(console.error);
            contextMenu.hideAll();
          }}
        >
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t(`group:${key}`)}
          </Typography>
        </Item>
      ))}
    </Submenu>
  );
}
