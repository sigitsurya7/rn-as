package expo.modules.nativebot

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NativeBotServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeBotService")

    Events("event")

    OnCreate {
      BotEventBus.addListener { type, payload ->
        sendEvent("event", mapOf("type" to type, "payload" to payload))
      }
    }

    AsyncFunction("start") { payload: String ->
      val context = appContext.reactContext ?: return@AsyncFunction
      NativeBotService.start(context, payload)
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction
      NativeBotService.stop(context)
    }

    AsyncFunction("update") { payload: String ->
      val context = appContext.reactContext ?: return@AsyncFunction
      NativeBotService.update(context, payload)
    }
  }
}
