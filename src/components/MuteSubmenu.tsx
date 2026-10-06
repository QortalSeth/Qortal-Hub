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

function activeMutedUntil(v: number | null | undefined): boolean {
  return v === null || (v !== undefined && v > Date.now());
}

/** Collect all channel mutedUntil values within a scope. */
function collectScopeMuteState(
  groupSettings: GroupNotificationSettingsData | undefined,
  sectionId?: string,
  channelId?: string
): { allMuted: boolean; sharedUntil: number | null | undefined } {
  if (!groupSettings) return { allMuted: false, sharedUntil: undefined };

  if (channelId != null) {
    const effectiveSectionId = sectionId ?? '';
    const ch =
      groupSettings.sections?.[effectiveSectionId]?.channels?.[channelId];
    const v = ch?.mutedUntil;
    return {
      allMuted: activeMutedUntil(v),
      sharedUntil: v !== undefined ? v : undefined,
    };
  }

  if (sectionId != null) {
    const section = groupSettings.sections?.[sectionId];
    if (!section?.channels) return { allMuted: false, sharedUntil: undefined };
    const vals = Object.values(section.channels).map((ch) => ch?.mutedUntil);
    const allMuted = vals.length > 0 && vals.every((v) => activeMutedUntil(v));
    const first = vals[0];
    const sharedUntil = vals.every((v) => v === first) ? first : undefined;
    return { allMuted, sharedUntil };
  }

  if (!groupSettings.sections)
    return { allMuted: false, sharedUntil: undefined };
  const vals: Array<number | null | undefined> = [];
  for (const section of Object.values(groupSettings.sections)) {
    if (!section?.channels) continue;
    for (const ch of Object.values(section.channels)) {
      vals.push(ch?.mutedUntil);
    }
  }
  if (vals.length === 0) return { allMuted: false, sharedUntil: undefined };
  const allMuted = vals.every((v) => activeMutedUntil(v));
  const first = vals[0];
  const sharedUntil = vals.every((v) => v === first) ? first : undefined;
  return { allMuted, sharedUntil };
}

export function MuteSubmenu({ scope, scopeType }: MuteSubmenuProps) {
  const { t } = useTranslation(['group']);
  const cache = useAtomValue(notificationSettingsCacheAtom);

  const groupSettings = cache[String(scope.groupId)];

  const { allMuted, sharedUntil } = collectScopeMuteState(
    groupSettings,
    scope.sectionId,
    scope.channelId
  );

  const mutedHoursLeft =
    sharedUntil != null && sharedUntil > 0
      ? Math.max(0, (sharedUntil - Date.now()) / (1000 * 60 * 60))
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
  const showTimer = mutedForLabel != null && scopeType === 'Channel';

  if (allMuted) {
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
            {showTimer && (
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
