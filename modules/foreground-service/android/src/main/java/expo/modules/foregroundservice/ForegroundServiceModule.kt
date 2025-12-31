package expo.modules.foregroundservice

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForegroundService")

    AsyncFunction("start") { title: String, body: String ->
      val context = appContext.reactContext ?: return@AsyncFunction
      ForegroundBotService.start(context, title, body)
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: return@AsyncFunction
      ForegroundBotService.stop(context)
    }
  }
}
