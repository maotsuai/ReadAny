import ExpoModulesCore
import Foundation

private typealias NetworkResult = Result<[String: Any], Error>

private enum InsecureNetworkError: LocalizedError {
  case invalidURL(String)
  case invalidBody
  case invalidFileURL(String)
  case missingResponse
  case crossOriginRedirect

  var errorDescription: String? {
    switch self {
    case .invalidURL(let value):
      return "Invalid network URL: \(value)"
    case .invalidBody:
      return "Request body is not valid base64 data"
    case .invalidFileURL(let value):
      return "Invalid local file URL: \(value)"
    case .missingResponse:
      return "The server returned no HTTP response"
    case .crossOriginRedirect:
      return "Refused a cross-origin redirect for an insecure request"
    }
  }
}

private func responseRecord(_ response: HTTPURLResponse, body: Data? = nil) -> [String: Any] {
  var headers: [String: String] = [:]
  for (key, value) in response.allHeaderFields {
    headers[String(describing: key)] = String(describing: value)
  }

  var result: [String: Any] = [
    "status": response.statusCode,
    "statusText": HTTPURLResponse.localizedString(forStatusCode: response.statusCode),
    "headers": headers,
  ]
  if let body {
    result["bodyBase64"] = body.base64EncodedString()
  }
  return result
}

private class InsecureTaskDelegate: NSObject, URLSessionTaskDelegate {
  let allowedOrigin: String
  let completion: (NetworkResult) -> Void
  weak var session: URLSession?
  private var completed = false

  init(allowedOrigin: String, completion: @escaping (NetworkResult) -> Void) {
    self.allowedOrigin = allowedOrigin
    self.completion = completion
  }

  func finish(_ result: NetworkResult) {
    guard !completed else { return }
    completed = true
    completion(result)
    session?.finishTasksAndInvalidate()
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    handle(challenge: challenge, completionHandler: completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    handle(challenge: challenge, completionHandler: completionHandler)
  }

  private func handle(
    challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let protectionSpace = challenge.protectionSpace
    guard protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let serverTrust = protectionSpace.serverTrust,
      protectionSpace.originIdentifier == allowedOrigin
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    completionHandler(.useCredential, URLCredential(trust: serverTrust))
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard request.url?.originIdentifier == allowedOrigin else {
      // Do not forward credentials or relaxed trust to a different origin.
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }
}

private final class InsecureDataDelegate: InsecureTaskDelegate, URLSessionDataDelegate {
  private var body = Data()

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    body.append(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      finish(.failure(error))
      return
    }
    guard let response = task.response as? HTTPURLResponse else {
      finish(.failure(InsecureNetworkError.missingResponse))
      return
    }
    finish(.success(responseRecord(response, body: body)))
  }
}

private final class InsecureDownloadDelegate: InsecureTaskDelegate, URLSessionDownloadDelegate {
  private let destinationURL: URL
  private var moveError: Error?

  init(
    allowedOrigin: String,
    destinationURL: URL,
    completion: @escaping (NetworkResult) -> Void
  ) {
    self.destinationURL = destinationURL
    super.init(allowedOrigin: allowedOrigin, completion: completion)
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let response = downloadTask.response as? HTTPURLResponse,
      (200..<300).contains(response.statusCode)
    else { return }

    do {
      let fileManager = FileManager.default
      try fileManager.createDirectory(
        at: destinationURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      if fileManager.fileExists(atPath: destinationURL.path) {
        try fileManager.removeItem(at: destinationURL)
      }
      try fileManager.moveItem(at: location, to: destinationURL)
    } catch {
      moveError = error
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error {
      finish(.failure(error))
      return
    }
    if let moveError {
      finish(.failure(moveError))
      return
    }
    guard let response = task.response as? HTTPURLResponse else {
      finish(.failure(InsecureNetworkError.missingResponse))
      return
    }
    finish(.success(responseRecord(response)))
  }
}

private extension URL {
  var originIdentifier: String? {
    guard let scheme = scheme?.lowercased(), let host = host?.lowercased() else { return nil }
    let effectivePort = port ?? (scheme == "https" ? 443 : 80)
    return "\(scheme)://\(host):\(effectivePort)"
  }
}

private extension URLProtectionSpace {
  var originIdentifier: String? {
    guard let scheme = `protocol`?.lowercased() else { return nil }
    let effectivePort = port > 0 ? port : (scheme == "https" ? 443 : 80)
    return "\(scheme)://\(host.lowercased()):\(effectivePort)"
  }
}

public final class InsecureNetworkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("InsecureNetwork")

    AsyncFunction("request") {
      (
        url: String,
        method: String,
        headers: [String: String],
        bodyBase64: String?,
        timeoutMs: Double,
        promise: Promise
      ) in
      do {
        let request = try makeRequest(
          url: url,
          method: method,
          headers: headers,
          bodyBase64: bodyBase64,
          timeoutMs: timeoutMs
        )
        startDataTask(request: request, uploadFileURL: nil, promise: promise)
      } catch {
        promise.reject(error)
      }
    }

    AsyncFunction("uploadFile") {
      (
        url: String,
        filePath: String,
        method: String,
        headers: [String: String],
        timeoutMs: Double,
        promise: Promise
      ) in
      do {
        let request = try makeRequest(
          url: url,
          method: method,
          headers: headers,
          bodyBase64: nil,
          timeoutMs: timeoutMs
        )
        let fileURL = try localFileURL(filePath)
        startDataTask(request: request, uploadFileURL: fileURL, promise: promise)
      } catch {
        promise.reject(error)
      }
    }

    AsyncFunction("downloadFile") {
      (
        url: String,
        filePath: String,
        headers: [String: String],
        timeoutMs: Double,
        promise: Promise
      ) in
      do {
        let request = try makeRequest(
          url: url,
          method: "GET",
          headers: headers,
          bodyBase64: nil,
          timeoutMs: timeoutMs
        )
        let destinationURL = try localFileURL(filePath)
        startDownloadTask(request: request, destinationURL: destinationURL, promise: promise)
      } catch {
        promise.reject(error)
      }
    }
  }

  private func makeRequest(
    url: String,
    method: String,
    headers: [String: String],
    bodyBase64: String?,
    timeoutMs: Double
  ) throws -> URLRequest {
    guard let requestURL = URL(string: url), requestURL.originIdentifier != nil else {
      throw InsecureNetworkError.invalidURL(url)
    }

    var request = URLRequest(
      url: requestURL,
      cachePolicy: .reloadIgnoringLocalCacheData,
      timeoutInterval: max(1, timeoutMs / 1_000)
    )
    request.httpMethod = method.uppercased()
    for (key, value) in headers {
      request.setValue(value, forHTTPHeaderField: key)
    }
    if let bodyBase64 {
      guard let body = Data(base64Encoded: bodyBase64) else {
        throw InsecureNetworkError.invalidBody
      }
      request.httpBody = body
    }
    return request
  }

  private func localFileURL(_ value: String) throws -> URL {
    if value.hasPrefix("file://"), let fileURL = URL(string: value), fileURL.isFileURL {
      return fileURL
    }
    if value.hasPrefix("/") {
      return URL(fileURLWithPath: value)
    }
    throw InsecureNetworkError.invalidFileURL(value)
  }

  private func makeSession(delegate: URLSessionDelegate, timeoutMs: Double) -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    let timeout = max(1, timeoutMs / 1_000)
    configuration.timeoutIntervalForRequest = timeout
    configuration.timeoutIntervalForResource = timeout
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
  }

  private func resolve(_ result: NetworkResult, promise: Promise) {
    DispatchQueue.main.async {
      switch result {
      case .success(let response):
        promise.resolve(response)
      case .failure(let error):
        promise.reject(error)
      }
    }
  }

  private func startDataTask(request: URLRequest, uploadFileURL: URL?, promise: Promise) {
    guard let origin = request.url?.originIdentifier else {
      promise.reject(InsecureNetworkError.invalidURL(request.url?.absoluteString ?? ""))
      return
    }
    let delegate = InsecureDataDelegate(allowedOrigin: origin) { [weak self] result in
      self?.resolve(result, promise: promise)
    }
    let session = makeSession(delegate: delegate, timeoutMs: request.timeoutInterval * 1_000)
    delegate.session = session
    if let uploadFileURL {
      session.uploadTask(with: request, fromFile: uploadFileURL).resume()
    } else {
      session.dataTask(with: request).resume()
    }
  }

  private func startDownloadTask(request: URLRequest, destinationURL: URL, promise: Promise) {
    guard let origin = request.url?.originIdentifier else {
      promise.reject(InsecureNetworkError.invalidURL(request.url?.absoluteString ?? ""))
      return
    }
    let delegate = InsecureDownloadDelegate(allowedOrigin: origin, destinationURL: destinationURL) {
      [weak self] result in
      self?.resolve(result, promise: promise)
    }
    let session = makeSession(delegate: delegate, timeoutMs: request.timeoutInterval * 1_000)
    delegate.session = session
    session.downloadTask(with: request).resume()
  }
}
