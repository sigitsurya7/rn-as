package expo.modules.stockitywebsocket

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class StockityWebSocketModule : Module() {
  private val client = OkHttpClient.Builder().build()
  private val sockets = ConcurrentHashMap<String, WebSocket>()

  override fun definition() = ModuleDefinition {
    Name("StockityWebSocket")

    Events("open", "message", "error", "close")

    AsyncFunction("connect") { url: String, headers: Map<String, String> ->
      val socketId = UUID.randomUUID().toString()
      val requestBuilder = Request.Builder().url(url)
      headers.forEach { (key, value) ->
        requestBuilder.addHeader(key, value)
      }
      val request = requestBuilder.build()
      val socket = client.newWebSocket(
        request,
        object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) {
            sendEvent(
              "open",
              mapOf(
                "id" to socketId,
                "responseCode" to response.code,
                "responseMessage" to response.message,
                "responseHeaders" to response.headers.toString()
              )
            )
          }

          override fun onMessage(webSocket: WebSocket, text: String) {
            sendEvent("message", mapOf("id" to socketId, "data" to text))
          }

          override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            sendEvent(
              "error",
              mapOf(
                "id" to socketId,
                "message" to (t.message ?: "WebSocket failure"),
                "responseCode" to response?.code,
                "responseMessage" to response?.message,
                "responseHeaders" to response?.headers?.toString()
              )
            )
            sockets.remove(socketId)
          }

          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            sendEvent("close", mapOf("id" to socketId, "code" to code, "reason" to reason))
            sockets.remove(socketId)
          }
        }
      )
      sockets[socketId] = socket
      socketId
    }

    AsyncFunction("send") { socketId: String, message: String ->
      val socket = sockets[socketId]
      socket?.send(message) ?: false
    }

    AsyncFunction("close") { socketId: String, code: Int?, reason: String? ->
      val socket = sockets.remove(socketId) ?: return@AsyncFunction
      val closeCode = code ?: 1000
      socket.close(closeCode, reason ?: "")
    }
  }
}
