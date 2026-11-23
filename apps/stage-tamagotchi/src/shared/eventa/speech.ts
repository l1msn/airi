import { defineInvokeEventa } from '@moeru/eventa'

/**
 * Fork (custom-build, FUT-AIRISAYAPP): speak an arbitrary string with AIRI's own voice without
 * going through an agent reply, so external notifications (cron digests, monitors) are spoken
 * by the application itself instead of an external player.
 *
 * The renderer answers with the active speech store, so the fork voice pin (serena, seed 1,
 * temperature 0) applies exactly as in a normal reply. Registered in
 * `renderer/composables/use-spoken-utterance.ts`, invoked from main by
 * `main/services/airi/external-speech`.
 */
export const electronSpeechSpeakText = defineInvokeEventa<void, string>('eventa:invoke:electron:speech:speak-text')
