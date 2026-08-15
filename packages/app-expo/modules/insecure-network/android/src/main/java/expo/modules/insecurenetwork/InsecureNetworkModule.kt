package expo.modules.insecurenetwork

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException
import java.net.URI
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

class InsecureNetworkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InsecureNetwork")

    AsyncFunction("request") {
        url: String,
        method: String,
        headers: Map<String, String>,
        bodyBase64: String?,
        timeoutMs: Double,
        promise: Promise,
      ->
      try {
        val body = bodyBase64?.let { Base64.decode(it, Base64.DEFAULT) }
        val request = buildRequest(url, method, headers, body)
        enqueue(request, timeoutMs, promise) { response ->
          val responseBytes = response.body?.bytes() ?: ByteArray(0)
          responseRecord(response, Base64.encodeToString(responseBytes, Base64.NO_WRAP))
        }
      } catch (error: Exception) {
        promise.rejectNetworkError(error)
      }
    }

    AsyncFunction("uploadFile") {
        url: String,
        filePath: String,
        method: String,
        headers: Map<String, String>,
        timeoutMs: Double,
        promise: Promise,
      ->
      try {
        val file = localFile(filePath)
        if (!file.isFile) throw CodedException("Upload file does not exist: $filePath")
        val contentType = headers.entries
          .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
          ?.value
          ?.toMediaTypeOrNull()
        val requestBody = file.asRequestBody(contentType)
        val request = buildRequest(url, method, headers, requestBody)
        enqueue(request, timeoutMs, promise) { response -> responseRecord(response) }
      } catch (error: Exception) {
        promise.rejectNetworkError(error)
      }
    }

    AsyncFunction("downloadFile") {
        url: String,
        filePath: String,
        headers: Map<String, String>,
        timeoutMs: Double,
        promise: Promise,
      ->
      try {
        val destination = localFile(filePath)
        val request = buildRequest(url, "GET", headers, bodyBytes = null)
        enqueue(request, timeoutMs, promise) { response ->
          if (response.isSuccessful) {
            writeDownload(response, destination)
          }
          responseRecord(response)
        }
      } catch (error: Exception) {
        promise.rejectNetworkError(error)
      }
    }
  }

  private fun buildRequest(
    url: String,
    method: String,
    headers: Map<String, String>,
    bodyBytes: ByteArray?,
  ): Request {
    val contentType = headers.entries
      .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
      ?.value
      ?.toMediaTypeOrNull()
    val body = bodyBytes?.toRequestBody(contentType)
    return buildRequest(url, method, headers, body)
  }

  private fun buildRequest(
    url: String,
    method: String,
    headers: Map<String, String>,
    body: okhttp3.RequestBody?,
  ): Request {
    val builder = Request.Builder().url(url)
    for ((key, value) in headers) {
      builder.header(key, value)
    }
    return builder.method(method.uppercase(), body).build()
  }

  private fun enqueue(
    request: Request,
    timeoutMs: Double,
    promise: Promise,
    transform: (Response) -> Map<String, Any>,
  ) {
    val client = insecureClient(request.url.host, request.url.originIdentifier, timeoutMs)
    client.newCall(request).enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) {
        promise.rejectNetworkError(error)
      }

      override fun onResponse(call: Call, response: Response) {
        response.use {
          try {
            promise.resolve(transform(it))
          } catch (error: Exception) {
            promise.rejectNetworkError(error)
          }
        }
      }
    })
  }

  private fun insecureClient(host: String, allowedOrigin: String, timeoutMs: Double): OkHttpClient {
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) = Unit
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
    val timeout = timeoutMs.coerceAtLeast(1.0).toLong()

    return OkHttpClient.Builder()
      .sslSocketFactory(sslContext.socketFactory, trustManager)
      .hostnameVerifier { challengeHost, _ -> challengeHost.equals(host, ignoreCase = true) }
      .addNetworkInterceptor { chain ->
        if (chain.request().url.originIdentifier != allowedOrigin) {
          throw IOException("Refused a cross-origin redirect for an insecure request")
        }
        chain.proceed(chain.request())
      }
      .connectTimeout(timeout, TimeUnit.MILLISECONDS)
      .readTimeout(timeout, TimeUnit.MILLISECONDS)
      .writeTimeout(timeout, TimeUnit.MILLISECONDS)
      .callTimeout(timeout, TimeUnit.MILLISECONDS)
      .build()
  }

  private fun responseRecord(response: Response, bodyBase64: String? = null): Map<String, Any> {
    val result = mutableMapOf<String, Any>(
      "status" to response.code,
      "statusText" to response.message,
      "headers" to response.headers.toMultimap().mapValues { (_, values) -> values.joinToString(", ") },
    )
    if (bodyBase64 != null) result["bodyBase64"] = bodyBase64
    return result
  }

  private fun localFile(path: String): File {
    return if (path.startsWith("file://")) File(URI(path)) else File(path)
  }

  private fun writeDownload(response: Response, destination: File) {
    val parent = destination.parentFile
      ?: throw IOException("Download destination has no parent directory")
    if (!parent.exists() && !parent.mkdirs()) {
      throw IOException("Could not create download directory: ${parent.absolutePath}")
    }

    val temporary = File(parent, ".${destination.name}.${UUID.randomUUID()}.download")
    try {
      response.body?.byteStream()?.use { input ->
        temporary.outputStream().use { output -> input.copyTo(output) }
      } ?: temporary.createNewFile()
      if (destination.exists() && !destination.delete()) {
        throw IOException("Could not replace download destination: ${destination.absolutePath}")
      }
      if (!temporary.renameTo(destination)) {
        temporary.copyTo(destination, overwrite = true)
        temporary.delete()
      }
    } catch (error: Exception) {
      temporary.delete()
      throw error
    }
  }
}

private fun Promise.rejectNetworkError(error: Throwable) {
  reject(
    error as? CodedException
      ?: CodedException(error.message ?: "Insecure network request failed", error),
  )
}

private val okhttp3.HttpUrl.originIdentifier: String
  get() {
    val effectivePort = if (port > 0) port else if (scheme == "https") 443 else 80
    return "$scheme://${host.lowercase()}:$effectivePort"
  }
