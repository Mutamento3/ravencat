package expo.modules.backupstorage

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Test

class BackupMediaFilesTest {
  @Test fun excludesSnapshotsWithoutExcludingBackgroundsOrSiblingDirectories() {
    val root = Files.createTempDirectory("backup-media-test").toFile()
    try {
      val paths = listOf("calls/snapshots/frame.jpg", "calls/snapshots/nested/frame.jpg", "calls/snapshots-other/keep.jpg", "backgrounds/calls/image.jpg", "catalog/images/asset.jpg")
      paths.forEach { path -> root.resolve(path).apply { parentFile!!.mkdirs(); writeText("image") } }
      assertEquals(paths.drop(2).toSet(), backupMediaFiles(root, listOf("calls/snapshots/")).map { it.relativeTo(root).invariantSeparatorsPath }.toSet())
      assertEquals(paths.toSet(), backupMediaFiles(root, emptyList()).map { it.relativeTo(root).invariantSeparatorsPath }.toSet())
    } finally { root.deleteRecursively() }
  }
}
