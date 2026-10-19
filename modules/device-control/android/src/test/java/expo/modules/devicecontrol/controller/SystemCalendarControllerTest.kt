package expo.modules.devicecontrol.controller

import android.Manifest
import android.content.ContentProvider
import android.content.ContentProviderOperation
import android.content.ContentProviderResult
import android.content.ContentUris
import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class SystemCalendarControllerTest {
  private val context get() = RuntimeEnvironment.getApplication()
  private lateinit var provider: CalendarTestProvider
  private lateinit var controller: SystemCalendarController

  @Before fun setup() {
    provider = CalendarTestProvider()
    provider.onCreate()
    ShadowContentResolver.registerProviderInternal(CalendarContract.AUTHORITY, provider)
    shadowOf(context).grantPermissions(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
    controller = SystemCalendarController(context)
  }

  @Test fun permissionAndReminderCapabilityAreRequired() {
    assertEquals("ready", controller.prepare())
    shadowOf(context).denyPermissions(Manifest.permission.WRITE_CALENDAR)
    assertEquals("permission_required", controller.prepare())
    shadowOf(context).grantPermissions(Manifest.permission.WRITE_CALENDAR)
    provider.db.execSQL("UPDATE calendars SET allowedReminders='0'")
    assertEquals("no_writable_calendar", controller.prepare())
    assertEquals(0, count("events"))
  }

  @Test fun stableKeyUpdatesOneEventAndOneAtTimeReminder() {
    controller.upsert("schedule-a", "吃药", "晚饭后", 1_800_000_000_000)
    controller.upsert("schedule-a", "改期", "午饭后", 1_800_000_600_000)
    assertEquals(listOf("schedule-a"), controller.listKeys())
    assertEquals(1, count("events"))
    assertEquals(1, count("reminders"))
    provider.db.rawQuery("SELECT title,dtstart,dtend,calendar_id FROM events", null).use {
      assertTrue(it.moveToFirst())
      assertEquals("改期", it.getString(0))
      assertEquals(1_800_000_600_000, it.getLong(1))
      assertEquals(1_800_000_660_000, it.getLong(2))
      assertEquals(2L, it.getLong(3))
    }
    provider.db.rawQuery("SELECT minutes,method FROM reminders", null).use {
      assertTrue(it.moveToFirst())
      assertEquals(0, it.getInt(0))
      assertEquals(Reminders.METHOD_ALERT, it.getInt(1))
    }
    controller.remove("schedule-a")
    assertEquals(0, count("events"))
    assertEquals(0, count("reminders"))
  }

  @Test fun anotherApplicationsEventIsNeverChangedOrRemoved() {
    provider.db.execSQL("INSERT INTO events(title,customAppPackage,customAppUri) VALUES ('其他应用','other.app','schedule-a')")
    controller.upsert("schedule-a", "自己的", "", 1_800_000_000_000)
    assertEquals(2, count("events"))
    controller.remove("schedule-a")
    controller.remove("schedule-a")
    assertEquals(1, count("events"))
    assertEquals(emptyList<String>(), controller.listKeys())
  }

  @Test fun reminderFailureRollsBackEventInSameProviderBatch() {
    provider.failReminder = true
    assertThrows(IllegalStateException::class.java) {
      controller.upsert("schedule-a", "测试", "", 1_800_000_000_000)
    }
    assertEquals(0, count("events"))
    assertEquals(0, count("reminders"))
  }

  private fun count(table: String): Int = provider.db.rawQuery("SELECT COUNT(*) FROM $table", null).use {
    it.moveToFirst(); it.getInt(0)
  }
}

/** 用事务型 Provider 验证事件、提醒和所有权行为，不依赖具体 batch 操作写法。 */
class CalendarTestProvider : ContentProvider() {
  lateinit var db: SQLiteDatabase
  var failReminder = false
  override fun onCreate(): Boolean {
    db = SQLiteDatabase.create(null)
    db.execSQL("CREATE TABLE calendars (_id INTEGER PRIMARY KEY,account_type TEXT,calendar_access_level INTEGER,visible INTEGER,maxReminders INTEGER,allowedReminders TEXT)")
    db.execSQL("INSERT INTO calendars VALUES (1,'cloud',700,1,5,'0,1'),(2,'LOCAL',700,1,5,'0,1')")
    db.execSQL("CREATE TABLE events (_id INTEGER PRIMARY KEY,calendar_id INTEGER,title TEXT,description TEXT,dtstart INTEGER,dtend INTEGER,eventTimezone TEXT,customAppPackage TEXT,customAppUri TEXT,hasAlarm INTEGER,deleted INTEGER DEFAULT 0)")
    db.execSQL("CREATE TABLE reminders (_id INTEGER PRIMARY KEY,event_id INTEGER,minutes INTEGER,method INTEGER)")
    db.execSQL("CREATE TRIGGER remove_reminders AFTER DELETE ON events BEGIN DELETE FROM reminders WHERE event_id=old._id; END")
    return true
  }
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
    db.query(uri.pathSegments[0], projection, selection, selectionArgs, null, null, sortOrder)
  override fun insert(uri: Uri, values: ContentValues?): Uri {
    if (uri.pathSegments[0] == "reminders" && failReminder) error("提醒写入失败")
    return ContentUris.withAppendedId(uri, db.insertOrThrow(uri.pathSegments[0], null, values))
  }
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int =
    db.update(uri.pathSegments[0], values, if (uri.pathSegments.size == 2) "_id=${uri.lastPathSegment}" else selection, selectionArgs)
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int =
    db.delete(uri.pathSegments[0], selection, selectionArgs)
  override fun getType(uri: Uri): String? = null
  override fun applyBatch(operations: ArrayList<ContentProviderOperation>): Array<ContentProviderResult> {
    db.beginTransaction()
    try {
      val results = super.applyBatch(operations)
      db.setTransactionSuccessful()
      return results
    } finally { db.endTransaction() }
  }
}
