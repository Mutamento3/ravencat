package expo.modules.devicecontrol.service

import android.service.notification.NotificationListenerService

/** 仅作为 MediaSessionManager 授权身份；不读取、存储或转发通知。 */
class RavenCatMediaNotificationListenerService : NotificationListenerService()
