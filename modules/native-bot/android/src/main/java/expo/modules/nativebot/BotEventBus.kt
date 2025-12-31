package expo.modules.nativebot

import java.util.concurrent.CopyOnWriteArrayList

typealias BotEventListener = (type: String, payload: String) -> Unit

object BotEventBus {
  private val listeners = CopyOnWriteArrayList<BotEventListener>()

  fun addListener(listener: BotEventListener): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun emit(type: String, payload: String) {
    listeners.forEach { it(type, payload) }
  }
}
