import ExpoModulesCore

public class StockityWebSocketModule: Module {
  private var sockets: [String: URLSessionWebSocketTask] = [:]
  private var sessions: [String: URLSession] = [:]
  private var delegates: [String: StockityWebSocketDelegate] = [:]

  public func definition() -> ModuleDefinition {
    Name("StockityWebSocket")

    Events("open", "message", "error", "close")

    AsyncFunction("connect") { (url: String, headers: [String: String]) -> String in
      guard let wsUrl = URL(string: url) else {
        throw NSError(domain: "StockityWebSocket", code: 0, userInfo: [
          NSLocalizedDescriptionKey: "Invalid URL"
        ])
      }
      let socketId = UUID().uuidString
      var request = URLRequest(url: wsUrl)
      headers.forEach { key, value in
        request.setValue(value, forHTTPHeaderField: key)
      }
      let delegate = StockityWebSocketDelegate(socketId: socketId, module: self)
      let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
      let task = session.webSocketTask(with: request)
      sockets[socketId] = task
      sessions[socketId] = session
      delegates[socketId] = delegate
      task.resume()
      listen(socketId)
      return socketId
    }

    AsyncFunction("send") { (socketId: String, message: String) -> Bool in
      guard let task = sockets[socketId] else { return false }
      task.send(.string(message)) { error in
        if let error = error {
          self.sendEvent("error", ["id": socketId, "message": error.localizedDescription])
        }
      }
      return true
    }

    AsyncFunction("close") { (socketId: String, code: Int?, reason: String?) in
      guard let task = sockets.removeValue(forKey: socketId) else { return }
      let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code ?? 1000) ?? .normalClosure
      let reasonData = reason?.data(using: .utf8)
      task.cancel(with: closeCode, reason: reasonData)
      sessions[socketId]?.invalidateAndCancel()
      sessions.removeValue(forKey: socketId)
      delegates.removeValue(forKey: socketId)
    }
  }

  private func listen(_ socketId: String) {
    guard let task = sockets[socketId] else { return }
    task.receive { result in
      switch result {
      case .failure(let error):
        self.sendEvent("error", ["id": socketId, "message": error.localizedDescription])
      case .success(let message):
        switch message {
        case .string(let text):
          self.sendEvent("message", ["id": socketId, "data": text])
        case .data(let data):
          let text = String(data: data, encoding: .utf8) ?? ""
          self.sendEvent("message", ["id": socketId, "data": text])
        @unknown default:
          break
        }
      }
      self.listen(socketId)
    }
  }
}

public class StockityWebSocketDelegate: NSObject, URLSessionWebSocketDelegate, URLSessionTaskDelegate {
  private let socketId: String
  private weak var module: StockityWebSocketModule?

  init(socketId: String, module: StockityWebSocketModule) {
    self.socketId = socketId
    self.module = module
  }

  public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    var payload: [String: Any] = ["id": socketId]
    if let response = webSocketTask.response as? HTTPURLResponse {
      payload["responseCode"] = response.statusCode
      payload["responseHeaders"] = response.allHeaderFields.description
    }
    module?.sendEvent("open", payload)
  }

  public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    module?.sendEvent("close", ["id": socketId, "code": closeCode.rawValue, "reason": reasonText])
  }

  public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error = error {
      var payload: [String: Any] = [
        "id": socketId,
        "message": error.localizedDescription
      ]
      if let response = task.response as? HTTPURLResponse {
        payload["responseCode"] = response.statusCode
        payload["responseHeaders"] = response.allHeaderFields.description
      }
      module?.sendEvent("error", payload)
    }
  }
}
