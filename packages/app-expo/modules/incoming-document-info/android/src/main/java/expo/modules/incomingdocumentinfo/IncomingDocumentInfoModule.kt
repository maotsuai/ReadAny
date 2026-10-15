package expo.modules.incomingdocumentinfo

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URLConnection

class IncomingDocumentInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IncomingDocumentInfo")

    AsyncFunction("getInfo") { uriString: String ->
      val uri = Uri.parse(uriString)
      val resolver = appContext.reactContext?.contentResolver
        ?: throw IllegalStateException("Android content resolver is unavailable")

      var displayName: String? = null
      var size: Long? = null

      if (uri.scheme == ContentResolver.SCHEME_CONTENT) {
        resolver.query(
          uri,
          arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
          null,
          null,
          null,
        )?.use { cursor ->
          if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
              displayName = cursor.getString(nameIndex)
            }

            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
              size = cursor.getLong(sizeIndex)
            }
          }
        }
      } else if (uri.scheme == ContentResolver.SCHEME_FILE) {
        uri.path?.let { path ->
          val file = File(path)
          displayName = file.name
          if (file.exists()) size = file.length()
        }
      }

      val fallbackName = uri.lastPathSegment
        ?.let(Uri::decode)
        ?.substringAfterLast('/')
        ?.substringAfterLast(':')
        ?.takeIf { it.isNotBlank() }
      val name = displayName?.takeIf { it.isNotBlank() } ?: fallbackName
      val mimeType = resolver.getType(uri)
        ?: name?.let { URLConnection.guessContentTypeFromName(it) }

      mapOf(
        "uri" to uriString,
        "name" to name,
        "mimeType" to mimeType,
        "size" to size,
      )
    }
  }
}
