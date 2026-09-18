import { useState, useEffect } from 'react';
import { Item, Separator, Submenu } from 'react-contexify';
import { Box, Checkbox, Radio, Typography } from '@mui/material';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import {
  type EffectiveNotificationSettings,
  type PushLevel,
  type ScopeDescriptor,
  getEffectiveNotificationSettings,
  setScopeNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '../utils/qChatNotificationSettings';

export interface NotificationSettingsSubmenuProps {
  scope: ScopeDescriptor;
}

export function NotificationSettingsSubmenu({
  scope,
}: NotificationSettingsSubmenuProps) {
  const [settings, setSettings] = useState<EffectiveNotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS
  );
  const { t } = useTranslation(['group']);

  useEffect(() => {
    let cancelled = false;
    void getEffectiveNotificationSettings(
      scope.groupId,
      scope.sectionId,
      scope.channelId
    ).then((result) => {
      if (!cancelled) setSettings(result);
    });
    return () => {
      cancelled = true;
    };
  }, [scope.groupId, scope.sectionId, scope.channelId]);

  const updateSettings = (partial: Partial<EffectiveNotificationSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    void setScopeNotificationSettings(scope, partial).catch(() => {
      setSettings(settings);
    });
  };

  return (
    <Submenu
      label={
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
          <NotificationsRoundedIcon sx={{ fontSize: 18 }} />
          <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
            {t('group:context_menu.notification_settings')}
          </Typography>
        </Box>
      }
      arrow={<ChevronRightRoundedIcon sx={{ fontSize: 20 }} />}
    >
      <Item
        closeOnClick={false}
        onClick={() => updateSettings({ pushLevel: 'all' })}
      >
        <Radio
          size="small"
          checked={settings.pushLevel === 'all'}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.all_messages')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() => updateSettings({ pushLevel: 'mentions' })}
      >
        <Radio
          size="small"
          checked={settings.pushLevel === 'mentions'}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.only_mentions')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() => updateSettings({ pushLevel: 'none' })}
      >
        <Radio
          size="small"
          checked={settings.pushLevel === 'none'}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.none')}
        </Typography>
      </Item>
      <Separator />
      <Item
        closeOnClick={false}
        onClick={() =>
          updateSettings({
            suppressEveryoneHere: !settings.suppressEveryoneHere,
          })
        }
      >
        <Checkbox
          size="small"
          checked={settings.suppressEveryoneHere}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.suppress_everyone_here')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() =>
          updateSettings({ notifyOnReplies: !settings.notifyOnReplies })
        }
      >
        <Checkbox
          size="small"
          checked={settings.notifyOnReplies}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.notify_on_replies')}
        </Typography>
      </Item>
      {scope.sectionId == null && scope.channelId == null && (
        <Item
          closeOnClick={false}
          onClick={() =>
            updateSettings({
              notifyOnWelcomePosts: !settings.notifyOnWelcomePosts,
            })
          }
        >
          <Checkbox
            size="small"
            checked={settings.notifyOnWelcomePosts}
            sx={{
              mr: 1.5,
              pointerEvents: 'none',
              padding: 0,
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          />
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t('group:notification_settings.notify_on_welcome_posts')}
          </Typography>
        </Item>
      )}
    </Submenu>
  );
}
