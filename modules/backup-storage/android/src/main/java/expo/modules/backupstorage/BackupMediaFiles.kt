package expo.modules.backupstorage

import java.io.File

/** 排除目录在进入时裁剪，临时 Calls 帧不会被读取、Hash 或写入 archive。 */
internal fun backupMediaFiles(root: File, excludedPrefixes: List<String>): List<File> =
  root.walkTopDown()
    .onEnter { directory ->
      val path = directory.relativeTo(root).invariantSeparatorsPath
      path.isEmpty() || excludedPrefixes.none { prefix -> "$path/".startsWith(prefix) }
    }
    .filter(File::isFile)
    .toList()
