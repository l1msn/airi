import type { AudioManagerType } from '@proj-airi/stage-ui/libs/audio/manager'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { defineInvokeHandler } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { createAudioManager, playAudio } from '@proj-airi/stage-ui/libs/audio/manager'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { onScopeDispose } from 'vue'

import { electronSpeechSpeakText } from '../../shared/eventa'

/** The window's AudioContext, created on the first utterance and reused after that. */
let audioManager: AudioManagerType | undefined

async function playbackManager() {
  audioManager ??= createAudioManager()
  if (audioManager.audioContext.state === 'suspended')
    await audioManager.audioContext.resume()
  return audioManager
}

/**
 * Says `text` with the voice this window has selected, without an agent reply.
 *
 * Everything that makes it AIRI's own voice is taken from the stores: the provider instance,
 * model and voice, plus the fork pin (serena, seed 1, temperature 0) that `speech()` applies.
 */
async function speakWith(speechStore: ReturnType<typeof useSpeechStore>, providerConfigStore: ReturnType<typeof useProviderConfigStore>, providersStore: ReturnType<typeof useProviderStore>, text: string) {
  const providerId = speechStore.activeSpeechProvider
  const model = speechStore.activeSpeechModel
  const voiceId = speechStore.activeSpeechVoiceId
  const voice = speechStore.activeSpeechVoice

  if (!speechStore.enabled || !providerId || !model || !voiceId || !voice)
    throw new Error(`speech is off or has no provider, model and voice selected (provider: ${providerId || 'none'})`)

  const { input, providerConfig } = speechStore.resolveSpeechInput({
    text,
    voice,
    providerConfig: providerConfigStore.getProviderConfig(providerId),
    forceSSML: speechStore.ssmlEnabled,
    supportsSSML: speechStore.supportsSSML,
  })
  const provider = await providersStore.getProviderInstance<SpeechProviderWithExtraOptions<string, Record<string, unknown>>>(providerId)
  const audio = await speechStore.speech(provider, model, input, voiceId, providerConfig)

  await playAudio(await playbackManager(), audio)
}

/**
 * Takes this window's part in {@link electronSpeechSpeakText}: speech requested from outside the
 * app is spoken here, so notifications leave through the application's own voice.
 *
 * Fork feature (custom-build, FUT-AIRISAYAPP).
 */
export function useSpokenUtterance() {
  const speechStore = useSpeechStore()
  const providerConfigStore = useProviderConfigStore()
  const providersStore = useProviderStore()

  onScopeDispose(defineInvokeHandler(getElectronEventaContext(), electronSpeechSpeakText, text => speakWith(speechStore, providerConfigStore, providersStore, text)))
}
