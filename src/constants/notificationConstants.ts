export const MAX_NOTIFICATION_PREVIEW_CHARS = 200;

/**
 * How long a push notification toast/popup stays visible before being
 * auto-dismissed. The notification remains accessible in the OS notification
 * center on platforms that support it (Windows Action Center, GNOME Notifications).
 *
 * 30 seconds give the user enough time to read and act while keeping the
 * notification tray from getting cluttered.
 */
export const NOTIFICATION_DISPLAY_DURATION_MS = 10_000;
