/** 补充选择器原生异常链与开发版原图读取证据，不修补文件或改变错误传播。 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'node_modules', 'expo-image-picker',
  'android', 'src', 'main', 'java', 'expo', 'modules', 'imagepicker', 'ImagePickerModule.kt');

const original = '    when (val pickingResult = pickerLauncher()) {';
const patched = `    // 只补原生错误证据，不改变启动线程、取消结果或错误传播。
    val pickingResult = try {
      pickerLauncher()
    } catch (error: Exception) {
      android.util.Log.e(
        "RavenCatImagePicker",
        "原生选择器调用失败；线程=\u0024{Thread.currentThread().name}；主线程=\u0024{android.os.Looper.myLooper() == android.os.Looper.getMainLooper()}",
        error
      )
      throw error
    }
    when (pickingResult) {`;

const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
if (!source.includes(patched)) {
  if (!source.includes(original)) {
    throw new Error('Expo 图片选择器启动实现已变化，请审查并移除此诊断补丁。');
  }
  fs.writeFileSync(target, source.replace(original, patched), 'utf8');
}

const utilsTarget = path.join(path.dirname(target), 'ImagePickerUtils.kt');
const originalCopy = '        inputStream.copyTo(fileOutputStream)';
const observedCopy = `        if (BuildConfig.DEBUG && targetFile.extension.equals("jpeg", ignoreCase = true)) {
          // 观察原来这一次读取，不重开源流；句柄诊断失败不能替代真实复制结果。
          val descriptorSize = runCatching {
            (inputStream as? java.io.FileInputStream)?.let { android.system.Os.fstat(it.fd).st_size }
          }.onFailure { Log.w("RavenCatImagePicker", "读取句柄大小诊断失败", it) }.getOrNull()
          val digest = java.security.MessageDigest.getInstance("SHA-256")
          val bytes = java.security.DigestInputStream(inputStream, digest).copyTo(fileOutputStream)
          val hash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
          Log.i(
            "RavenCatImagePicker",
            "原图读取；uri=\u0024sourceUri；authority=\u0024{sourceUri.authority}；句柄大小=\u0024descriptorSize；读取字节=\u0024bytes；源流SHA256=\u0024hash；缓存=\u0024{targetFile.absolutePath}；缓存字节=\u0024{targetFile.length()}"
          )
        } else {
          inputStream.copyTo(fileOutputStream)
        }`;
const utilsSource = fs.readFileSync(utilsTarget, 'utf8').replace(/\r\n/g, '\n');
if (!utilsSource.includes(observedCopy)) {
  if (!utilsSource.includes(originalCopy)) {
    throw new Error('Expo 原图复制实现已变化，请审查读取诊断补丁。');
  }
  fs.writeFileSync(utilsTarget, utilsSource.replace(originalCopy, observedCopy), 'utf8');
}

const handlerTarget = path.join(path.dirname(target), 'MediaHandler.kt');
const originalMetadata = '    val fileData = getAdditionalFileData(sourceUri)\n\n    return ImagePickerAsset(';
const observedMetadata = `    val fileData = getAdditionalFileData(sourceUri)
    if (BuildConfig.DEBUG) {
      android.util.Log.i(
        "RavenCatImagePicker",
        "选图导出；legacy=\u0024{options.legacy}；quality=\u0024{options.quality}；uri=\u0024sourceUri；提供器声明大小=\u0024{fileData?.fileSize}；缓存字节=\u0024{outputFile.length()}；缓存=\u0024{outputFile.absolutePath}"
      )
    }
    return ImagePickerAsset(`;
const handlerSource = fs.readFileSync(handlerTarget, 'utf8').replace(/\r\n/g, '\n');
if (!handlerSource.includes(observedMetadata)) {
  if (!handlerSource.includes(originalMetadata)) {
    throw new Error('Expo 图片导出实现已变化，请审查元数据诊断补丁。');
  }
  fs.writeFileSync(handlerTarget, handlerSource.replace(originalMetadata, observedMetadata), 'utf8');
}
console.log('[postinstall] 已补充 Expo 选择器异常链与开发版原图读取诊断');
