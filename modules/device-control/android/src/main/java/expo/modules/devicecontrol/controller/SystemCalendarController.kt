package expo.modules.devicecontrol.controller

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import java.util.TimeZone

/** 仅管理当前安装包用稳定 key 标记的事件，不接管用户的其他日历内容。 */
class SystemCalendarController(private val context: Context) {
  private val resolver get() = context.contentResolver
  private val ownerSelection = "${Events.CUSTOM_APP_PACKAGE} = ? AND ${Events.DELETED} = 0"

  fun prepare(): String {
    if (context.checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
      return "permission_required"
    }
    return if (writableCalendarId() == null) "no_writable_calendar" else "ready"
  }

  fun listKeys(): List<String> = resolver.query(
    Events.CONTENT_URI, arrayOf(Events.CUSTOM_APP_URI), ownerSelection,
    arrayOf(context.packageName), null,
  )!!.use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.getString(0)) } }

  fun upsert(key: String, title: String, description: String, startAtEpochMs: Long) {
    synchronized(MUTATION_LOCK) { upsertLocked(key, title, description, startAtEpochMs) }
  }

  private fun upsertLocked(key: String, title: String, description: String, startAtEpochMs: Long) {
    require(key.isNotBlank() && title.isNotBlank() && startAtEpochMs > 0) { "日历事件参数无效" }
    val existingId = findEventId(key)
    val values = ContentValues().apply {
      put(Events.TITLE, title)
      put(Events.DESCRIPTION, description)
      put(Events.DTSTART, startAtEpochMs)
      // 时间点提醒以一分钟事件承载，提醒仍在开始时间触发。
      put(Events.DTEND, startAtEpochMs + 60_000)
      put(Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
      put(Events.CUSTOM_APP_PACKAGE, context.packageName)
      put(Events.CUSTOM_APP_URI, key)
      put(Events.HAS_ALARM, 1)
    }
    val operations = arrayListOf<ContentProviderOperation>()
    if (existingId == null) {
      val calendarId = checkNotNull(writableCalendarId()) { "没有支持提醒的可写日历" }
      values.put(Events.CALENDAR_ID, calendarId)
      operations.add(ContentProviderOperation.newInsert(Events.CONTENT_URI).withValues(values).build())
      operations.add(ContentProviderOperation.newInsert(Reminders.CONTENT_URI)
        .withValueBackReference(Reminders.EVENT_ID, 0)
        .withValue(Reminders.MINUTES, 0).withValue(Reminders.METHOD, Reminders.METHOD_ALERT).build())
    } else {
      operations.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(Events.CONTENT_URI, existingId))
        .withValues(values).withExpectedCount(1).build())
      operations.add(ContentProviderOperation.newDelete(Reminders.CONTENT_URI)
        .withSelection("${Reminders.EVENT_ID} = ?", arrayOf(existingId.toString())).build())
      operations.add(ContentProviderOperation.newInsert(Reminders.CONTENT_URI)
        .withValue(Reminders.EVENT_ID, existingId)
        .withValue(Reminders.MINUTES, 0).withValue(Reminders.METHOD, Reminders.METHOD_ALERT).build())
    }
    // 事件与提醒在 Calendar Provider 的同一个 batch 中提交，失败直接暴露给应用层。
    resolver.applyBatch(CalendarContract.AUTHORITY, operations)
  }

  fun remove(key: String) {
    synchronized(MUTATION_LOCK) {
      resolver.delete(Events.CONTENT_URI, "$ownerSelection AND ${Events.CUSTOM_APP_URI} = ?",
        arrayOf(context.packageName, key))
    }
  }

  private fun findEventId(key: String): Long? = resolver.query(
    Events.CONTENT_URI, arrayOf(Events._ID), "$ownerSelection AND ${Events.CUSTOM_APP_URI} = ?",
    arrayOf(context.packageName, key), null,
  )!!.use { if (it.moveToFirst()) it.getLong(0) else null }

  private fun writableCalendarId(): Long? = resolver.query(
    Calendars.CONTENT_URI,
    arrayOf(Calendars._ID, Calendars.ACCOUNT_TYPE, Calendars.ALLOWED_REMINDERS),
    "${Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${Calendars.VISIBLE} = 1 AND ${Calendars.MAX_REMINDERS} > 0",
    arrayOf(Calendars.CAL_ACCESS_CONTRIBUTOR.toString()), "${Calendars._ID} ASC",
  )!!.use { cursor ->
    var first: Long? = null
    while (cursor.moveToNext()) {
      if (!cursor.getString(2).split(',').contains(Reminders.METHOD_ALERT.toString())) continue
      val id = cursor.getLong(0)
      if (cursor.getString(1) == CalendarContract.ACCOUNT_TYPE_LOCAL) return@use id
      if (first == null) first = id
    }
    first
  }

  companion object {
    // 不同 JS runtime 的桥接实例共享一次查找与 batch 写入，保证稳定 key 不重复创建。
    private val MUTATION_LOCK = Any()
  }
}
